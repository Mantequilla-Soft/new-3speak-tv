// PeakD-style Hive profile badges.
//
// The convention is chain-level, not app-level: a badge is a normal Hive
// account named `badge-<digits>` (e.g. @badge-012345), and an account HOLDS
// that badge when the badge account FOLLOWS it. The badge's artwork and
// display name live in the badge account's own profile metadata, and its page
// is /b/<account> -- the same path PeakD uses, which we now serve ourselves
// (see components/Badges/BadgePage.jsx).
//
// Reading them back cheaply relies on hivemind returning followers sorted
// alphabetically: we seek straight to the `badge-` block instead of walking a
// creator's full follower list, which for a popular account is tens of
// thousands of rows. That makes the whole lookup one RPC call for a typical
// profile.

import axios from 'axios';
import { getHiveUrl } from './hiveNode';
import { hiveAvatarUrl } from './avatarCache';
import { hiveProxyRefuses } from './fixThumbnails';
import { getAccounts } from '../hive-api/hiveApi';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';

const BADGE_PREFIX = 'badge-';

// A creator's preferred badge order lives ON-CHAIN in their own
// posting_json_metadata, under the shared `3speak` namespace that interests and
// spotlight already use — no database, and it travels with the account.
const META_NS = '3speak';

const clean = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

// `start` on get_followers is EXCLUSIVE and must be an account that actually
// exists, so we can't just seek to the literal string "badge-". @badge is a
// real account that sorts immediately before @badge-000000, which makes it the
// exact anchor we need: the first row back is the first badge the account
// holds. Hive accounts can never be deleted or renamed, so this stays valid.
const SEEK_ANCHOR = 'badge';

// Badges we don't show. @badge-100421 is the retired "3Speak User" badge from
// the old 3Speak.Online platform, which sits right next to the current
// "3Speak Users" badge (@badge-181335) and reads as a duplicate.
const HIDDEN_BADGES = new Set(['badge-100421']);

const PAGE_SIZE = 100;
// Backstop only. Nobody holds 500 badges; this just keeps a malformed response
// from paging forever.
const MAX_PAGES = 5;
// get_accounts returns the full account object (~3KB each), so ask in chunks
// rather than one giant response.
const META_CHUNK = 30;

async function rpc(method, params) {
  const { data } = await axios.post(getHiveUrl(), {
    jsonrpc: '2.0', method, params, id: 1,
  });
  if (data?.error) throw new Error(data.error.message || method);
  return data?.result;
}

/**
 * The badge accounts following `username`, in chain order.
 *
 * Walks forward from the anchor and stops at the first follower that isn't a
 * `badge-` account — everything after it sorts past the badge block, so
 * there's nothing left to find.
 */
async function badgeAccountNames(username) {
  const names = [];
  let start = SEEK_ANCHOR;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await rpc('condenser_api.get_followers', [username, start, 'blog', PAGE_SIZE]);
    if (!rows?.length) break;

    let leftBadgeBlock = false;
    for (const row of rows) {
      if (!row?.follower?.startsWith(BADGE_PREFIX)) { leftBadgeBlock = true; break; }
      names.push(row.follower);
    }

    // Out of the badge range, or the follower list simply ended here.
    if (leftBadgeBlock || rows.length < PAGE_SIZE) break;
    start = rows[rows.length - 1].follower;
  }

  return names;
}

// Older badge accounts kept their profile in `json_metadata`; newer ones use
// `posting_json_metadata`. Take whichever actually carries a profile, and
// tolerate malformed JSON — a broken badge shouldn't drop the whole row.
function readProfile(account) {
  for (const raw of [account?.posting_json_metadata, account?.json_metadata]) {
    if (!raw) continue;
    try {
      const profile = JSON.parse(raw)?.profile;
      if (profile && (profile.name || profile.about || profile.profile_image)) return profile;
    } catch { /* try the other field */ }
  }
  return {};
}

/**
 * 3Speak's own badges lead the row, and stay there — they're the one part of
 * the order a creator can't drag. The set will grow, so this matches the word
 * anywhere in the badge name rather than pinning specific accounts:
 * punctuation and case are stripped first so "3Speak", "3speak" and "3-Speak"
 * all count.
 */
export function isThreeSpeakBadge(badge) {
  return String(badge?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes('3speak');
}

// Only posting_json_metadata here — the `3speak` namespace lives there, unlike
// the badge profiles above which still have to fall back to json_metadata.
function parsePostingMeta(account) {
  const raw = account?.posting_json_metadata;
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return raw;
  } catch { /* malformed metadata → empty */ }
  return {};
}

/** The badge order a creator saved, as account names. Empty when unset. */
export function readBadgeOrderFromAccount(account) {
  const saved = parsePostingMeta(account)?.[META_NS]?.badgeOrder;
  if (!Array.isArray(saved)) return [];
  return saved.filter((n) => typeof n === 'string' && n.startsWith(BADGE_PREFIX));
}

/**
 * Apply a creator's saved order: 3Speak badges first (always), then the badges
 * they arranged, then anything they've earned since — new badges land at the
 * end rather than shuffling into a position nobody chose.
 */
function applyBadgeOrder(badges, order) {
  const rank = new Map(order.map((account, i) => [account, i]));
  const pinned = [];
  const movable = [];
  for (const badge of badges) (isThreeSpeakBadge(badge) ? pinned : movable).push(badge);

  // Unranked badges all compare equal, and sort is stable, so they keep chain
  // order among themselves and stay behind everything the creator ranked.
  movable.sort((a, b) => (
    (rank.has(a.account) ? rank.get(a.account) : Infinity)
    - (rank.has(b.account) ? rank.get(b.account) : Infinity)
  ));

  return [...pinned, ...movable];
}

/**
 * Every PeakD badge held by `username`.
 *
 * @returns {Promise<Array<{account, name, about, image, url}>>} `url` is the
 *   in-app badge page. 3Speak badges
 *   first, then the creator's saved order, then the rest in chain order. Empty
 *   array when the account holds none — which is most accounts.
 */
export async function fetchHiveBadges(username) {
  const user = clean(username);
  if (!user) return [];

  // Drop hidden badges before the metadata fetch, so they cost nothing.
  const names = (await badgeAccountNames(user)).filter((n) => !HIDDEN_BADGES.has(n));
  if (!names.length) return [];

  // The profile owner rides along in the metadata batch: their
  // posting_json_metadata carries the saved order, so reading it costs no
  // extra round trip.
  const wanted = [user, ...names];
  const accounts = [];
  for (let i = 0; i < wanted.length; i += META_CHUNK) {
    const chunk = await rpc('condenser_api.get_accounts', [wanted.slice(i, i + META_CHUNK)]);
    if (Array.isArray(chunk)) accounts.push(...chunk);
  }

  const order = readBadgeOrderFromAccount(accounts.find((a) => a.name === user));

  const badges = accounts.filter((a) => a.name !== user).map((account) => {
    const profile = readProfile(account);
    return {
      account: account.name,
      // A handful of badge accounts never set a display name; the account
      // itself is a poor label but better than an unlabelled chip.
      name: profile.name?.trim() || account.name,
      about: profile.about?.trim() || '',
      // The image proxy resolves profile_image server-side, which is why it is
      // still the fallback: it works even for accounts whose metadata we could
      // not parse. But it cannot fetch images.3speak.tv, and for those it
      // answers with its own grey placeholder rather than an error — so a badge
      // whose art was uploaded here appeared blank next to badges that worked.
      // We already have the metadata, so use the real URL when the proxy would
      // refuse it.
      image: hiveProxyRefuses(profile.profile_image)
        ? profile.profile_image
        : hiveAvatarUrl(account.name, 'small'),
      // In-app, not peakd.com: a badge chip used to send the reader off the
      // site to read what is on our own /b/ page.
      url: `/b/${account.name}`,
    };
  });

  return applyBadgeOrder(badges, order);
}

/**
 * Persist the creator's badge order into their posting_json_metadata via an
 * account_update2.
 *
 * Merges into the metadata fetched fresh, so `profile`, `3speak.interests`,
 * spotlight and every other app's keys survive — this op REPLACES the whole
 * field, so anything not copied through is destroyed. json_metadata is sent as
 * '' which means "leave unchanged" on-chain, so posting authority is enough and
 * delegated logins never see a wallet prompt.
 *
 * Only the movable badges belong in the list; 3Speak's are pinned by rule, not
 * by position.
 */
export async function saveBadgeOrder(username, accountNames) {
  const user = clean(username);
  if (!user) throw new Error('Not logged in');

  const list = [...new Set(
    (accountNames || [])
      .map((n) => clean(n))
      .filter((n) => n.startsWith(BADGE_PREFIX)),
  )];

  const [account] = await getAccounts([user]);
  const meta = parsePostingMeta(account);
  meta[META_NS] = { ...(meta[META_NS] || {}), badgeOrder: list };

  const op = ['account_update2', {
    account: user,
    json_metadata: '',
    posting_json_metadata: JSON.stringify(meta),
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error('Could not save your badge order to Hive');
  return list;
}

export default fetchHiveBadges;
