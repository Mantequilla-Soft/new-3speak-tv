// The `3speak` object in an account's posting_json_metadata: settings a creator
// keeps on their Hive account so anyone (our server, other apps) can read them.
// Holds `lightning` (lib/lightningTip.js) and `supportLinks` (lib/supportLinks.js).
import { getAccounts } from '../hive-api/hiveApi';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';

export function postingMeta(account) {
  const raw = account?.posting_json_metadata;
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return { ...raw };
  } catch { /* malformed metadata: start over */ }
  return {};
}

// The account's `3speak` object ({} when there is none). Throws `no_account`.
export async function readThreespeakMeta(username) {
  const [account] = await getAccounts([username]);
  if (!account) throw new Error('no_account');
  const ns = postingMeta(account)['3speak'];
  return ns && typeof ns === 'object' ? ns : {};
}

// The `3speak` keys our own recent saves set, per account: a node can still answer
// with the metadata from before them for a few seconds. Only these keys are laid
// over a fresh read, so whatever else changed meanwhile (profile, interests, other
// apps' keys, other `3speak` settings) is kept.
const recentChanges = new Map();
const CHANGES_FRESH_MS = 60 * 1000;
// One save at a time per account, so each reads after the one before it landed.
const queues = new Map();

// `change(ns)` edits a copy of the `3speak` object; everything else in the
// metadata (`profile`, other apps' keys) is written back as it was. Saves run one
// after the other per account, and keys this app saved in the last minute win
// over a node that may not have them yet, so two settings saved close together
// don't undo each other. Posting authority is enough.
export function saveThreespeakMeta(username, change) {
  const run = (queues.get(username) || Promise.resolve())
    .catch(() => {})
    .then(() => writeThreespeakMeta(username, change));
  queues.set(username, run);
  run.finally(() => { if (queues.get(username) === run) queues.delete(username); }).catch(() => {});
  return run;
}

async function writeThreespeakMeta(username, change) {
  const [account] = await getAccounts([username]);
  if (!account) throw new Error('no_account');
  const meta = postingMeta(account);
  const ns = { ...(meta['3speak'] && typeof meta['3speak'] === 'object' ? meta['3speak'] : {}) };
  const recent = recentChanges.get(username);
  const ours = recent && Date.now() - recent.at < CHANGES_FRESH_MS ? recent.keys : {};
  for (const [key, value] of Object.entries(ours)) {
    if (value === undefined) delete ns[key];
    else ns[key] = JSON.parse(value);
  }
  const before = JSON.stringify(ns);
  const was = JSON.parse(before);
  change(ns);
  meta['3speak'] = ns;
  const op = ['account_update2', {
    account: username,
    json_metadata: '',
    posting_json_metadata: JSON.stringify(meta),
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error(result?.error || 'broadcast_failed');
  // Remember what this save changed (as JSON, undefined = removed) on top of the
  // keys still fresh from earlier saves.
  const keys = { ...ours };
  for (const key of new Set([...Object.keys(was), ...Object.keys(ns)])) {
    const now = ns[key] === undefined ? undefined : JSON.stringify(ns[key]);
    if (now !== (was[key] === undefined ? undefined : JSON.stringify(was[key]))) keys[key] = now;
  }
  recentChanges.set(username, { keys, at: Date.now() });
}
