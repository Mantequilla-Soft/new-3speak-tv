import { getAccounts } from '../hive-api/hiveApi';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';
import { fetchCreatorAdPrefs, setCreatorAdPrefs } from '../lib/advertiseData';
import { t } from '../i18n';

// The creator's ad settings, mirrored onto their own Hive account.
//
// The checker (Mongo `ad_creator_prefs`) is still what the ad server reads at
// serve time — it has to be, since a decision that gates a request cannot cost an
// RPC round trip. This file adds the second copy the setting always should have
// had: the creator's own posting_json_metadata, where it is theirs rather than
// ours, survives us entirely, and can be read by any other Hive app that wants to
// honour the same choice.
//
// Namespaced under `3speak` alongside `interests` — NOT on top of the standard
// `profile` object other Hive apps read and write. Same read/merge/broadcast shape
// as utils/interests.js on purpose; if you change one, look at the other.
const META_NS = '3speak';
const META_KEY = 'ads';

const clean = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

function parsePostingMeta(account) {
  if (!account) return {};
  const raw = account.posting_json_metadata;
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return raw;
  } catch { /* malformed metadata — treat as empty */ }
  return {};
}

/**
 * Pull the ad settings out of an already-fetched account object.
 *
 * Returns null when the creator has never written them, which is a different
 * answer from "ads off" and must stay distinguishable: the onboarding prompt asks
 * precisely when nothing has been chosen, and a missing key read as `false` would
 * turn every unasked creator into an opt-out.
 */
export function readAdSettingsFromAccount(account) {
  const meta = parsePostingMeta(account);
  const ads = meta && meta[META_NS] && meta[META_NS][META_KEY];
  if (!ads || typeof ads !== 'object') return null;

  const pct = Number(ads.communityPct);
  return {
    // Only a literal `false` is off. Anything else — including a malformed value
    // written by some future version of this — falls back to the platform default.
    enabled: ads.enabled !== false,
    communityPct: Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : null,
    updatedAt: typeof ads.updatedAt === 'string' ? ads.updatedAt : null,
  };
}

/**
 * Read a creator's on-chain ad settings. Returns null both when the account has
 * none and when the lookup failed — callers here only ever use this to decide
 * whether to ASK, and asking twice is a far better failure than silently writing
 * over a choice we could not read.
 */
export async function fetchAdSettingsFromHive(username) {
  const u = clean(username);
  if (!u) return null;
  try {
    const [account] = await getAccounts([u]);
    if (!account) return null;
    return readAdSettingsFromAccount(account);
  } catch {
    return null;
  }
}

/**
 * Write the settings into the creator's posting_json_metadata via account_update2.
 *
 * Merges into the metadata as it stands right now — fetched fresh rather than
 * from anything cached — so `profile`, `interests` and every key some other Hive
 * app put there survive. Broadcast with posting authority, which for a HiveSigner
 * or Butter Auth session is routed through @threespeak under the authority the
 * creator already granted it, and costs no wallet prompt at all.
 */
export async function saveAdSettingsToHive(username, { adsEnabled, communitySharePct }) {
  const u = clean(username);
  if (!u) throw new Error(t('ads.errors.notLoggedIn'));

  const [account] = await getAccounts([u]);
  const meta = parsePostingMeta(account);
  const ads = { enabled: adsEnabled !== false, updatedAt: new Date().toISOString() };
  // Omitted rather than nulled when the caller has no number to write: an absent
  // key means "whatever the platform default is", and writing null would make the
  // read path above fall back anyway while looking like a deliberate choice.
  if (Number.isInteger(communitySharePct)) ads.communityPct = communitySharePct;

  meta[META_NS] = { ...(meta[META_NS] || {}), [META_KEY]: ads };

  // json_metadata must be a string for dhive to serialize the op; an empty string
  // means "leave json_metadata unchanged" on-chain, so only posting_json_metadata
  // is actually written (and posting auth suffices).
  const op = ['account_update2', {
    account: u,
    json_metadata: '',
    posting_json_metadata: JSON.stringify(meta),
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error(t('ads.errors.saveSettingsHive'));
  return ads;
}

/**
 * Has this creator ever chosen? Checks both stores, because either one alone gets
 * the answer wrong: the chain is the record the creator owns but is not what the
 * ad server reads, and the checker row can exist for an account that has never
 * seen the question.
 *
 * Returns `{ chosen, split, adsEnabled }`, or `chosen: null` when NEITHER store
 * could be read — the caller must not prompt on that, or an RPC blip turns into a
 * modal in front of someone who already answered.
 */
export async function readCreatorAdChoice(username) {
  const u = clean(username);
  if (!u) return { chosen: null, split: null, adsEnabled: true };

  const [server, chain] = await Promise.all([
    fetchCreatorAdPrefs(u).catch(() => null),
    fetchAdSettingsFromHive(u),
  ]);

  // `updatedAt` is only ever set by a write, so it — not the presence of a
  // default-filled `split` — is what says a human touched this.
  const serverChosen = !!(server && server.updatedAt);
  const chainChosen = !!chain;

  return {
    chosen: (server === null && chain === null) ? null : (serverChosen || chainChosen),
    // The split, including poolPct and the platform's own default community share,
    // comes from the server rather than being duplicated here. A second copy of the
    // default in the browser is a copy that drifts out of step with the number the
    // signed message is actually checked against.
    split: (server && server.split) || null,
    adsEnabled: server ? server.adsEnabled !== false : (chain ? chain.enabled : true),
  };
}

/**
 * Save both copies: the checker first, the chain second.
 *
 * Order matters. The checker row is what decides whether an ad plays on the next
 * request, so it goes first and its failure fails the whole save. The chain write
 * is the creator's own durable record; if the wallet rejects it the setting has
 * still taken effect, and reporting that honestly beats rolling back a preference
 * the creator asked for.
 */
export async function saveCreatorAdSettings(username, { adsEnabled, communitySharePct }) {
  const res = await setCreatorAdPrefs(username, { adsEnabled, communitySharePct });

  let chainSaved = false;
  let chainError = null;
  try {
    // Write the number the server settled on, not the draft — if the server
    // clamped or defaulted anything, the two copies must not disagree.
    const pct = res && res.split ? res.split.communityPct : communitySharePct;
    await saveAdSettingsToHive(username, { adsEnabled, communitySharePct: pct });
    chainSaved = true;
  } catch (err) {
    chainError = (err && err.message) || t('ads.errors.saveToHiveAccount');
  }

  return { ...res, chainSaved, chainError };
}
