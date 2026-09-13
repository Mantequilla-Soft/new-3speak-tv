import { getAccounts } from '../hive-api/hiveApi';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';
import { getTagLabel as getTagLabelV2, isKnownTag as isKnownTagV2 } from './tagsV2';

// The selectable interest taxonomy — mirrors the tags the transcription/subtitles
// pipeline assigns to videos (the distinct set in the checker's `subtitles-tags`
// collection, minus the `general` catch-all). Used later to bias the content a
// user is served. Keep the ids in sync with the transcription taxonomy.
export const INTERESTS = [
  { id: 'news', label: 'News', emoji: '📰' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'health', label: 'Health', emoji: '🩺' },
  { id: 'technology', label: 'Technology', emoji: '💻' },
  { id: 'art', label: 'Art', emoji: '🎨' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'tutorial', label: 'Tutorial', emoji: '🛠️' },
  { id: 'nature', label: 'Nature', emoji: '🌿' },
  { id: 'education', label: 'Education', emoji: '🎓' },
  { id: 'vlog', label: 'Vlog', emoji: '🎥' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  // id stays 'cryptocurrency' (the tagger emits it + the checker matches on it);
  // only the user-facing label is shortened to "Crypto".
  { id: 'cryptocurrency', label: 'Crypto', emoji: '🪙' },
  { id: 'finance', label: 'Finance', emoji: '💰' },
  { id: 'food', label: 'Food', emoji: '🍔' },
  { id: 'sports', label: 'Sports', emoji: '⚽' },
  { id: 'science', label: 'Science', emoji: '🔬' },
];

export const INTEREST_IDS = INTERESTS.map((i) => i.id);
const INTEREST_ID_SET = new Set(INTEREST_IDS);

// Short display names for raw tag ids (e.g. the watch-page topic row shows the
// bare tag, not the INTERESTS label). Keeps display in sync with the labels.
const TAG_DISPLAY = { cryptocurrency: 'crypto' };
export const displayTag = (id) => {
  const t = String(id || '').toLowerCase();
  // v1 display names first (curated), then the v2 taxonomy so its slugs render
  // as proper labels ("food-outdoor" → "Food & Outdoors", "story-time" → "Story
  // Time") instead of leaking raw slugs into the UI, then the raw value.
  if (TAG_DISPLAY[t]) return TAG_DISPLAY[t];
  if (isKnownTagV2(t)) return getTagLabelV2(t);
  return t;
};

// Where interests live inside the account's posting_json_metadata. Namespaced
// under `3speak` so it sits alongside — not on top of — the standard `profile`
// object other Hive apps read/write.
export const META_NS = '3speak';

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

// v1 slugs that v2 dropped, mapped to their nearest surviving topic so an old
// pick keeps expressing something. `tutorial` was v1-only and the v2 auto-tagger
// never emits it, so it matches literally zero videos site-wide; education is the
// closest thing the taxonomy still has.
const LEGACY_TAG_MIGRATIONS = { tutorial: 'education' };

/**
 * Canonicalise an interest list: migrate retired slugs, drop unknowns, dedupe.
 *
 * Both ends of this file used to filter against INTEREST_ID_SET, the RETIRED v1
 * vocabulary of 16 tags, while the picker had long since moved to v2. So every
 * one of the 7 categories AND every v2-only topic (programming, business,
 * film-tv, lifestyle, comedy, story-time, commercial, diy-crafts, photography,
 * pets, gardening, fitness, spirituality, politics) was silently discarded — on
 * SAVE before broadcasting, and again on READ. Picking "Programming" appeared to
 * work and stored nothing. Accept the full v2 vocabulary, keeping v1 ids valid so
 * accounts saved by the old prod picker still load.
 */
export function normalizeInterestList(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const t = String(raw || '').trim().toLowerCase().replace(/^#/, '');
    if (!t) continue;
    const slug = LEGACY_TAG_MIGRATIONS[t] || t;
    if (!isKnownTagV2(slug) && !INTEREST_ID_SET.has(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

// Pull the saved interests out of an already-fetched account object.
export function readInterestsFromAccount(account) {
  const meta = parsePostingMeta(account);
  const arr = meta && meta[META_NS] && meta[META_NS].interests;
  return Array.isArray(arr) ? normalizeInterestList(arr) : [];
}

// Fetch a user's saved interests from Hive. Returns an array, or null on a
// lookup failure (so callers can distinguish "no interests" from "couldn't read").
export async function fetchUserInterests(username) {
  const u = clean(username);
  if (!u) return null;
  try {
    const [account] = await getAccounts([u]);
    if (!account) return null;
    return readInterestsFromAccount(account);
  } catch {
    return null;
  }
}

// Persist a user's interests into their Hive posting_json_metadata via an
// account_update2. Merges into the existing metadata so the `profile` object and
// any other keys are preserved. Broadcasts with posting authority — routed
// through @threespeak for delegated logins, or the user's wallet otherwise.
export async function saveInterestsToHive(username, interests) {
  const u = clean(username);
  if (!u) throw new Error('Not logged in');
  // Same canonicalisation as the read path — this used to filter to the retired
  // v1 vocabulary, which quietly dropped categories and v2-only topics on the way
  // to the chain.
  const list = normalizeInterestList(interests);

  // Merge into current metadata (fetch fresh so we don't clobber the profile).
  const [account] = await getAccounts([u]);
  const meta = parsePostingMeta(account);
  meta[META_NS] = { ...(meta[META_NS] || {}), interests: list };

  // json_metadata must be a string for dhive to serialize the op; an empty
  // string means "leave json_metadata unchanged" on-chain, so only
  // posting_json_metadata is actually written (and posting auth suffices).
  const op = ['account_update2', {
    account: u,
    json_metadata: '',
    posting_json_metadata: JSON.stringify(meta),
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error('Could not save interests to Hive');
  return list;
}
