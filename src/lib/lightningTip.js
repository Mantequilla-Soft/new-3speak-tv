// ⚡ Lightning tips: the viewer pays a Lightning invoice to the creator's v4v.app
// Lightning address, which pays out as HIVE on Hive (or keeps tips smaller than its
// conversion fee as sats in the creator's v4v.app account). Our API asks v4v.app
// for the invoice (server/lightning-tip.cjs); the browser can't call it directly.

// v4v.app takes about 50 sats + 3% to convert a tip to HIVE, so the presets start
// where most of the tip still reaches the creator. TipModal preselects the second.
export const LIGHTNING_PRESETS = [500, 1000, 2500, 5000];

// → { pr, sats, hash }. Throws an Error whose `code` is the API's error name
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
