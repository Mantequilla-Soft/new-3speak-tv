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

// What we last broadcast per account: a node can still answer with the metadata
// from before it for a few seconds.
const lastWritten = new Map();
const WRITTEN_FRESH_MS = 60 * 1000;
// One save at a time per account, so each reads after the one before it landed.
const queues = new Map();

// `change(ns)` edits a copy of the `3speak` object; everything else in the
// metadata (`profile`, other apps' keys) is written back as it was. Saves run one
// after the other per account and start from our own last write while the node
// may not have it yet, so two settings saved close together don't undo each
// other. Posting authority is enough.
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
  const written = lastWritten.get(username);
  const fresh = written && Date.now() - written.at < WRITTEN_FRESH_MS;
  const meta = fresh ? JSON.parse(written.json) : postingMeta(account);
  const ns = { ...(meta['3speak'] && typeof meta['3speak'] === 'object' ? meta['3speak'] : {}) };
  change(ns);
  meta['3speak'] = ns;
  const json = JSON.stringify(meta);
  const op = ['account_update2', {
    account: username,
    json_metadata: '',
    posting_json_metadata: json,
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error(result?.error || 'broadcast_failed');
  lastWritten.set(username, { json, at: Date.now() });
}
