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

// `change(ns)` edits a copy of the `3speak` object; everything else in the
// metadata (`profile`, other apps' keys) is written back as it was. Re-reads the
// account first, so two settings saved one after the other don't undo each other.
// Posting authority is enough.
export async function saveThreespeakMeta(username, change) {
  const [account] = await getAccounts([username]);
  if (!account) throw new Error('no_account');
  const meta = postingMeta(account);
  const ns = { ...(meta['3speak'] && typeof meta['3speak'] === 'object' ? meta['3speak'] : {}) };
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
}
