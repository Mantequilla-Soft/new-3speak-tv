import { getAccounts } from '../hive-api/hiveApi';
import { META_NS, normalizeInterestList } from './interests';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';

// Read/write the standard Hive `profile` block (display name, bio, location,
// avatar) that every Hive app renders. It lives inside the account's
// posting_json_metadata, so a plain posting-authority signature is enough —
// which is what lets @threespeak write it on behalf of delegated logins
// (ButrAuth / HiveSigner) with no wallet prompt.

const clean = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

function parseMeta(raw) {
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return raw;
  } catch { /* malformed metadata — treat as empty */ }
  return {};
}

// The fields the welcome flow is allowed to write. Anything else already in the
// profile (cover_image, website, …) is copied through untouched.
export const EDITABLE_PROFILE_FIELDS = ['name', 'about', 'location', 'profile_image', 'cover_image'];

// Fields that count as "this account has been set up already".
const PRESENCE_FIELDS = ['name', 'about', 'location', 'profile_image', 'cover_image'];

/**
 * Pull the profile object out of an already-fetched account. Prefers
 * posting_json_metadata (where profiles live today) and falls back to the
 * legacy json_metadata so older accounts don't look empty.
 */
export function readProfileFromAccount(account) {
  if (!account) return {};
  const posting = parseMeta(account.posting_json_metadata);
  if (posting.profile && typeof posting.profile === 'object') return posting.profile;
  const legacy = parseMeta(account.json_metadata);
  if (legacy.profile && typeof legacy.profile === 'object') return legacy.profile;
  return {};
}

/**
 * Fetch a user's Hive profile. Returns the profile object, or null when the
 * lookup itself failed — so callers can tell "no profile" from "couldn't read".
 */
export async function fetchProfile(username) {
  const u = clean(username);
  if (!u) return null;
  try {
    const [account] = await getAccounts([u]);
    if (!account) return null;
    return readProfileFromAccount(account);
  } catch {
    return null;
  }
}

/** True when nothing a human would recognise as "their profile" is filled in. */
export function isProfileEmpty(profile) {
  if (!profile) return true;
  return !PRESENCE_FIELDS.some((k) => String(profile[k] || '').trim());
}

/**
 * Persist profile fields into the account's posting_json_metadata via an
 * account_update2, merging so `3speak.interests`, spotlight data and any other
 * app's keys survive. An empty value clears that field.
 *
 * json_metadata is sent as '' which means "leave unchanged" on-chain, so only
 * posting_json_metadata is written and posting authority suffices.
 */
export async function saveProfileToHive(username, fields, { interests } = {}) {
  const u = clean(username);
  if (!u) throw new Error('Not logged in');

  // Fetch fresh so a concurrent edit elsewhere isn't clobbered.
  const [account] = await getAccounts([u]);
  if (!account) throw new Error(`Hive account @${u} not found`);

  const meta = parseMeta(account.posting_json_metadata);
  const profile = { ...readProfileFromAccount(account) };

  for (const key of EDITABLE_PROFILE_FIELDS) {
    if (!(key in (fields || {}))) continue;
    const value = String(fields[key] ?? '').trim();
    if (value) profile[key] = value;
    else delete profile[key];
  }
  // Condenser stamps version 2 on profiles; keep it so other apps parse ours
  // the same way they parse everyone else's.
  if (!profile.version) profile.version = 2;

  meta.profile = profile;

  // Interests ride along in the SAME operation when the caller has them.
  // They live in the same posting_json_metadata under the 3speak namespace, so
  // writing them separately would cost a second broadcast and a second wallet
  // prompt for what is, on chain, one edit to one document.
  if (Array.isArray(interests)) {
    meta[META_NS] = { ...(meta[META_NS] || {}), interests: normalizeInterestList(interests) };
  }

  const op = ['account_update2', {
    account: u,
    json_metadata: '',
    posting_json_metadata: JSON.stringify(meta),
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error('Could not save your profile to Hive');
  return profile;
}
