// What a QR code scanned in the Send window (components/Wallet/TransferModal)
// means for the transfer. Understands what Hive wallets put in their "receive"
// codes:
//
//   badadib / @badadib                      a plain account name (3Speak's own
//                                           Receive code, most wallets)
//   https://3speak.tv/@badadib              a profile or wallet link on 3Speak
//   https://3speak.tv/wallet/badadib        or any Hive front end (peakd,
//   https://peakd.com/@badadib/wallet       hive.blog, ecency, ...)
//   hive://sign/op/<base64url>              a Hive transfer request (Keychain,
//   hive://sign/tx/<base64url>              HiveSigner, HiveAuth): the
//                                           recipient, and the amount, coin and
//                                           memo when it asks for them
//
// Returns { to, amount?, coin?, memo? } or null when the code holds no Hive
// account (a web page, a Wi-Fi code, ...).

// Hive account names: 3 to 16 characters, dot-separated parts that each start
// with a letter and hold letters, digits and hyphens.
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,}(?:\.[a-z][a-z0-9-]{2,})*$/;
export const isAccountName = (name) => typeof name === 'string' && name.length <= 16 && ACCOUNT_RE.test(name);

const account = (raw) => {
  const name = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  return isAccountName(name) ? name : null;
};

function decodeBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// hive://sign/op/<op> or hive://sign/tx/<tx>: the first transfer in it.
function fromSignUri(text) {
  const m = /^hive:\/\/sign\/(op|tx)\/([A-Za-z0-9_\-+/=]+)/.exec(text);
  if (!m) return null;
  let data;
  try { data = JSON.parse(decodeBase64Url(m[2])); } catch { return null; }
  const ops = m[1] === 'op' ? [data] : (Array.isArray(data?.operations) ? data.operations : []);
  const transfer = ops.find((op) => Array.isArray(op) && op[0] === 'transfer' && op[1]);
  if (!transfer) return null;
  const to = account(transfer[1].to);
  if (!to) return null;
  const out = { to };
  const amount = /^(\d+(?:\.\d+)?)\s+(HIVE|HBD)$/i.exec(String(transfer[1].amount || '').trim());
  if (amount && parseFloat(amount[1]) > 0) {
    out.amount = amount[1];
    out.coin = amount[2].toUpperCase();
  }
  if (transfer[1].memo) out.memo = String(transfer[1].memo);
  return out;
}

// A web link to a profile or a wallet: /@name..., /wallet/name, /user/name.
function fromLink(text) {
  let url;
  try { url = new URL(text); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.find((p) => p.startsWith('@'));
  if (at) return account(at) ? { to: account(at) } : null;
  if ((parts[0] === 'wallet' || parts[0] === 'user') && parts[1]) return account(parts[1]) ? { to: account(parts[1]) } : null;
  return null;
}

export function parseScannedRecipient(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^hive:\/\//i.test(text)) return fromSignUri(text);
  if (/^https?:\/\//i.test(text)) return fromLink(text);
  const to = account(text);
  return to ? { to } : null;
}

// ── The other way round: what the wallet's Receive code holds (Wallet page) ──

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The text of a Receive QR code for `to` (owner 2026-11-12). With neither an
 * amount nor a memo, just the account name: every Hive wallet reads that. With
 * either, a Hive transfer request (hive://sign/op/…, `__signer` = whoever scans
 * it) asking for that amount of HIVE or HBD (0.000 when only a memo is set: the
 * sender types the amount) with that memo. parseScannedRecipient above reads it
 * back, as do Hive wallets that understand Hive payment codes.
 */
export function receiveCode(to, amount, coin = 'HIVE', memo = '') {
  const n = Number(amount);
  const note = String(memo || '').trim();
  if ((!(n > 0) && !note) || !['HIVE', 'HBD'].includes(coin)) return to || '';
  const op = ['transfer', { from: '__signer', to, amount: `${(n > 0 ? n : 0).toFixed(3)} ${coin}`, memo: note }];
  return `hive://sign/op/${encodeBase64Url(JSON.stringify(op))}`;
}
