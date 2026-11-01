// ⚡ Lightning tips: the viewer pays a Lightning invoice to the creator's v4v.app
// Lightning address, which pays out as HIVE on Hive (or keeps tips smaller than its
// conversion fee as sats in the creator's v4v.app account). Our API asks v4v.app
// for the invoice (server/lightning-tip.cjs); the browser can't call it directly.
//
// A creator can set a Lightning address of their own instead (Settings > General),
// kept in their Hive posting_json_metadata as `3speak.lightning.address`. The server
// reads it there and asks that address for the invoice, so v4v.app is left out.
import { getAccounts } from '../hive-api/hiveApi';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';

// v4v.app takes about 50 sats + 3% to convert a tip to HIVE, so the presets start
// where most of the tip still reaches the creator. TipModal preselects the second.
export const LIGHTNING_PRESETS = [500, 1000, 2500, 5000];

// → { pr, sats, hash, via, address, verifiable }. `via` is 'address' when the
// creator set their own Lightning address, else 'v4v'. `verifiable` false = no way
// to see the payment arrive (the address offers no LUD-21 verify URL). Throws an Error whose `code` is the API's error name
// (bad_amount, amount_out_of_range, no_account, invoice_failed, ...).
export async function requestLightningInvoice({ to, sats, comment }) {
  const qs = new URLSearchParams({ to, sats: String(sats) });
  if (comment) qs.set('comment', comment);
  const res = await fetch(`/api/lightning/invoice?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.pr) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.error || 'invoice_failed';
    err.max = data.max;
    throw err;
  }
  return data;
}

// True once the invoice with this payment hash has been paid. The server learns
// it from @v4vapp's credit on Hive, so it lags the wallet by a few seconds.
export async function isLightningInvoicePaid(hash) {
  const res = await fetch(`/api/lightning/status/${encodeURIComponent(hash)}`);
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return data.paid === true;
}

// A Lightning wallet in the browser (Alby and the like, or a wallet app's own
// browser) exposes WebLN on window.
export const hasWebln = () => typeof window !== 'undefined' && !!window.webln;

// Pays through WebLN. Resolves when the wallet reports the payment as done;
// rejects when the viewer cancels or the wallet fails.
export async function payWithWebln(pr) {
  await window.webln.enable();
  return window.webln.sendPayment(pr);
}

export const LIGHTNING_ADDRESS_RE = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

// Where a creator's Lightning tips go: { via: 'v4v' } or { via: 'address', address }.
// null when it can't be told (the tip window then keeps its v4v.app wording).
export async function fetchLightningReceiver(to) {
  try {
    const res = await fetch(`/api/lightning/receiver?to=${encodeURIComponent(to)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Asks the address for its payment details before it is saved. → { ok, min, max };
// throws with `code` bad_address or unreachable.
export async function checkLightningAddress(address) {
  const res = await fetch(`/api/lightning/check-address?address=${encodeURIComponent(address)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.error || 'unreachable';
    throw err;
  }
  return data;
}

function postingMeta(account) {
  const raw = account?.posting_json_metadata;
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return { ...raw };
  } catch { /* malformed metadata: start over */ }
  return {};
}

// The address saved on the account, or '' for the v4v.app default.
export async function readOwnLightningAddress(username) {
  const [account] = await getAccounts([username]);
  if (!account) throw new Error('no_account');
  const address = String(postingMeta(account)['3speak']?.lightning?.address || '');
  return LIGHTNING_ADDRESS_RE.test(address) ? address.toLowerCase() : '';
}

// Saves (or, with '', removes) the creator's own Lightning address in their
// posting_json_metadata. Merges into the current metadata so `profile` and every
// other app's keys stay as they are; posting authority is enough.
export async function saveOwnLightningAddress(username, address) {
  const [account] = await getAccounts([username]);
  if (!account) throw new Error('no_account');
  const meta = postingMeta(account);
  const ns = { ...(meta['3speak'] && typeof meta['3speak'] === 'object' ? meta['3speak'] : {}) };
  if (address) ns.lightning = { address: address.toLowerCase(), updatedAt: new Date().toISOString() };
  else delete ns.lightning;
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
