/**
 * Saving an author's corrections to the automatic captions of their own video.
 *
 * The checker (3speakchecks/routes/subtitleEdit.js) rebuilds the SRT from the
 * lines we send, hashes it, and only stores it with a signature over a message
 * that contains that hash. So the SRT is built here with the SAME rules, byte for
 * byte: if the two ever differ, every save fails with "Invalid signature".
 *
 * Signing follows the ad preferences (lib/advertiseData.js): @threespeak signs
 * under the grant most authors already gave it (the only option at all for
 * HiveSigner and Butter Auth), and a wallet that can sign does it itself when
 * that grant is missing.
 */
import {
  signMessageWithAioha,
  getCurrentProvider,
  isManteAuthLogin,
  establishWalletSession,
  KeyTypes,
  Providers,
} from '../hive-api/aioha';
import { CHECKER_URL } from '../utils/config';
import { t } from '../i18n';

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

// ── SRT, identical to the checker ──────────────────────────────────────────
const MAX_LINE_CHARS = 500;
const pad = (n, w = 2) => String(n).padStart(w, '0');
function srtTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}
export function cleanCaptionText(text) {
  return String(text)
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2)
    .join('\n')
    .slice(0, MAX_LINE_CHARS);
}
/** The lines as the checker will store them: cleaned, emptied lines dropped. */
export function normaliseCues(cues) {
  return cues
    .map((c) => ({ start: Number(c.start), end: Number(c.end), text: cleanCaptionText(c.text ?? '') }))
    .filter((c) => c.text);
}
function cuesToSrt(cues) {
  // Every block ends with a blank line, the last one too: the generator's exact
  // layout, so saving unchanged captions yields the same file (same CID).
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n\n`).join('');
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Must match editMessage() in 3speakchecks/routes/subtitleEdit.js exactly.
const editMessage = (author, permlink, lang, srtSha256, timestamp) =>
  ['3speak-captions', 'edit', author, permlink, lang, srtSha256, String(timestamp)].join('|');

// ── signing ────────────────────────────────────────────────────────────────
const SIGN_CAPABLE_PROVIDERS = new Set([Providers.Keychain, Providers.HiveAuth, Providers.PeakVault, Providers.Ledger]);
const canSignLocally = () => !isManteAuthLogin() && SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider());

async function signViaThreespeak(account, permlink, lang, srtSha256) {
  const provider = getCurrentProvider();
  const isWallet = !!provider && provider !== Providers.HiveSigner && !isManteAuthLogin();
  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(`${THREESPEAK_API}/captions/edit-signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ permlink, lang, srtSha256 }),
    });
    return { r, d: await r.json().catch(() => ({})) };
  };
  let { r, d } = await doPost();
  // A wallet login without a session cookie (or with one for the account it was on
  // before switching) mints one for whoever is logged in now, then asks again.
  const forSomeoneElse = () => !!d?.username && String(d.username).toLowerCase() !== String(account).toLowerCase();
  if (isWallet && (r.status === 401 || forSomeoneElse()) && await establishWalletSession(account)) {
    ({ r, d } = await doPost());
  }
  if (!r.ok || !d.signature) throw new Error(d.error || t('comments.transcript.edit.saveFailed'));
  if (forSomeoneElse()) {
    throw new Error(t('comments.transcript.edit.signedInAsOther', { signedFor: d.username, want: account }));
  }
  return { signature: d.signature, timestamp: d.timestamp };
}

async function signLocally(account, permlink, lang, srtSha256) {
  const timestamp = Date.now();
  const res = await signMessageWithAioha(
    editMessage(account, permlink, lang, srtSha256, timestamp),
    KeyTypes.Posting,
    t('comments.transcript.edit.walletPrompt'),
  );
  if (!res?.success || !res.result) throw new Error(t('comments.transcript.edit.signatureRejected'));
  return { signature: res.result, timestamp };
}

/**
 * Sign and store corrected captions for one language of the author's own video.
 * Resolves to { cid, cues } with the lines exactly as stored.
 */
export async function saveCaptionEdit({ author, permlink, lang, cues }) {
  const clean = normaliseCues(cues);
  if (!clean.length) throw new Error(t('comments.transcript.edit.empty'));
  const srtSha256 = await sha256Hex(cuesToSrt(clean));

  let signed;
  try {
    signed = await signViaThreespeak(author, permlink, lang, srtSha256);
  } catch (err) {
    if (!canSignLocally()) throw err;
    signed = await signLocally(author, permlink, lang, srtSha256);
  }

  const r = await fetch(`${CHECKER_URL}/subtitles/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, permlink, lang, cues: clean, ...signed }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) throw new Error(d.error || t('comments.transcript.edit.saveFailed'));
  return { cid: d.cid, cues: clean };
}
