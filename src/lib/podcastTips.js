/**
 * ⚡ Tipping an outside podcast through the value block in its own RSS feed
 * (Podcasting 2.0 `podcast:value`, kept by the checker as { method, suggested,
 * recipients: [{ name, type: 'node' | 'lnaddress', address, split, customKey?,
 * customValue?, fee? }] }).
 *
 * A tip is split the way the feed asks: `fee` recipients take their split as a
 * percentage off the top, everyone else shares the rest in proportion to their
 * splits. How it reaches them depends on the recipient:
 * - a Lightning ADDRESS: our API runs LNURL-pay for an invoice
 *   (/api/lightning/address-invoice), paid with WebLN or, when it is the only
 *   recipient, by scanning a QR code with any wallet;
 * - a NODE (keysend): only a WebLN wallet in the browser can send a keysend
 *   payment, so those need Alby or similar.
 * Each payment carries the standard boostagram record (TLV 7629169), so the
 * podcaster sees the message, show and episode in their app.
 */

const BOOSTAGRAM_TLV = '7629169';
const HIVE_NAME_RE = /^[a-z][a-z0-9.-]{2,15}$/;

export const PODCAST_PRESETS = [100, 500, 1000, 2100];

/** The amounts each recipient gets for `total` sats; zero-sat shares are dropped. */
export function splitSats(recipients, total) {
  const list = (recipients || []).filter((r) => r.split > 0);
  const fees = list.filter((r) => r.fee);
  const rest = list.filter((r) => !r.fee);
  const out = [];
  let left = total;
  for (const r of fees) {
    const sats = Math.floor((total * Math.min(r.split, 100)) / 100);
    left -= sats;
    out.push({ ...r, sats });
  }
  const shares = rest.reduce((n, r) => n + r.split, 0);
  for (const r of rest) out.push({ ...r, sats: shares ? Math.floor((left * r.split) / shares) : 0 });
  // Rounding leaves a few sats over: they go to the largest non-fee share.
  const given = out.reduce((n, r) => n + r.sats, 0);
  const main = out.filter((r) => !r.fee).sort((a, b) => b.sats - a.sats)[0];
  if (main && given < total) main.sats += total - given;
  return out.filter((r) => r.sats >= 1);
}

/** The Hive account a value block names (v4v.app's customKey 818818), if any. */
export function hiveAccountOf(value) {
  const r = (value?.recipients || []).find((x) => String(x.customKey) === '818818' && HIVE_NAME_RE.test(String(x.customValue || '').toLowerCase()));
  return r ? String(r.customValue).toLowerCase() : null;
}

/** Who a value block pays, and the one Lightning address a QR code can pay when it is the only recipient. */
export function tipOptions(value) {
  const recipients = (value?.recipients || []).filter((r) => r.split > 0);
  const single = recipients.length === 1 && recipients[0].type === 'lnaddress' ? recipients[0] : null;
  return { recipients, single, payable: recipients.length > 0 };
}

/** True when an episode has any way to be supported: value block, Hive account or funding link. */
export const canTipEpisode = (track) => !!(track && (tipOptions(track.value).payable || hiveAccountOf(track.value) || track.funding?.length));

export const hasWebln = () => typeof window !== 'undefined' && !!window.webln;

export async function requestAddressInvoice({ address, sats, comment }) {
  const qs = new URLSearchParams({ address, sats: String(sats) });
  if (comment) qs.set('comment', comment);
  const res = await fetch(`/api/lightning/address-invoice?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.pr) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.error || 'invoice_failed';
    err.max = data.max;
    err.min = data.min;
    throw err;
  }
  return data;
}

function boostagram({ show, episode, feedUrl, message, sender, total, recipientName, sats }) {
  return JSON.stringify({
    podcast: show || undefined,
    episode: episode || undefined,
    url: feedUrl || undefined,
    action: 'boost',
    app_name: '3Speak',
    app_version: '1',
    message: message || undefined,
    sender_name: sender || undefined,
    name: recipientName || undefined,
    value_msat: sats * 1000,
    value_msat_total: total * 1000,
  });
}

/**
 * Send a tip to every recipient through WebLN.
 * @returns {Promise<Array<{ name, sats, ok, error? }>>} one row per recipient
 */
export async function payValueWithWebln({ value, total, message, show, episode, feedUrl, sender }) {
  await window.webln.enable();
  const results = [];
  for (const r of splitSats(value.recipients, total)) {
    try {
      if (r.type === 'lnaddress') {
        const { pr } = await requestAddressInvoice({ address: r.address, sats: r.sats, comment: message });
        await window.webln.sendPayment(pr);
      } else {
        if (typeof window.webln.keysend !== 'function') throw new Error('keysend_unsupported');
        const customRecords = { [BOOSTAGRAM_TLV]: boostagram({ show, episode, feedUrl, message, sender, total, recipientName: r.name, sats: r.sats }) };
        if (r.customKey && r.customValue) customRecords[String(r.customKey)] = String(r.customValue);
        await window.webln.keysend({ destination: r.address, amount: String(r.sats), customRecords });
      }
      results.push({ name: r.name || r.address, sats: r.sats, ok: true });
    } catch (err) {
      results.push({ name: r.name || r.address, sats: r.sats, ok: false, error: err?.code || err?.message || 'failed' });
      // The person cancelled in their wallet: don't keep popping it up for the rest.
      if (/reject|cancel|denied/i.test(String(err?.message))) break;
    }
  }
  return results;
}
