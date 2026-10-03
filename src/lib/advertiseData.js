// Advertiser intake data layer — talks to the checker's /advertise/* endpoints
// (3speakchecks/routes/advertise.js). The inventory numbers are the cleaned
// forecast written by services/adInventory.js, not raw view counts: sessions too
// short to be a viewer, traffic from accounts that behave like autoplay bots, and
// videos whose creator opted out are all removed before anything is offered here.
//
// Admin endpoints are deliberately NOT reachable from this file. They are gated by
// a server-only secret precisely because every VITE_ variable ends up in the
// browser bundle, so an approval queue driven from the frontend would not be a gate.
import {
  signMessageWithAioha,
  getCurrentProvider,
  isManteAuthLogin,
  establishWalletSession,
  KeyTypes,
  Providers,
} from '../hive-api/aioha';
import { CHECKER_URL, EMBED_API_KEY, EMBED_API_URL } from '../utils/config';
import { uploadThumbnail } from '../utils/uploadThumbnail';
import { t } from '../i18n';

// preview-3speak's own backend — same base aioha and the chat client use.
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

const BASE = `${CHECKER_URL}/advertise`;

// The categories the backend accepts (utils/config.js AD_CATEGORIES). Kept in the
// same order so the select reads sensibly rather than alphabetically.
// `labelKey` is an i18n key; translate at render.
export const AD_CATEGORIES = [
  { id: 'defi', labelKey: 'ads.categories.defi' },
  { id: 'dapp', labelKey: 'ads.categories.dapp' },
  { id: 'exchange', labelKey: 'ads.categories.exchange' },
  { id: 'gaming', labelKey: 'ads.categories.gaming' },
  { id: 'nft', labelKey: 'ads.categories.nft' },
  { id: 'infrastructure', labelKey: 'ads.categories.infrastructure' },
  { id: 'dao', labelKey: 'ads.categories.dao' },
  { id: 'media', labelKey: 'ads.categories.media' },
  { id: 'education', labelKey: 'ads.categories.education' },
  { id: 'event', labelKey: 'ads.categories.event' },
  { id: 'tooling', labelKey: 'ads.categories.tooling' },
  { id: 'other', labelKey: 'ads.categories.other' },
];

async function readJson(res) {
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || t('ads.errors.requestFailed', { status: res.status }));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Live inventory forecast. Throws with status 503 before the job has ever run. */
export async function fetchInventory() {
  return readJson(await fetch(`${BASE}/inventory`));
}

export async function submitApplication(payload) {
  return readJson(await fetch(`${BASE}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function fetchApplication(reference) {
  return readJson(await fetch(`${BASE}/application/${encodeURIComponent(reference)}`));
}

/**
 * Whether this account may actually use the ad surfaces, straight from the gate
 * that enforces it (checker `ADS_STAGE` + `ADS_BETA_USERS`).
 *
 * Returns `null` when the question could not be answered — an older checker with
 * no /access route, or the network. That is NOT "no": the caller has to decide
 * for itself, and the decision differs by surface.
 */
/**
 * The delegated signer signs for whoever the SESSION says you are, not for the account
 * the page thinks you are. Those can disagree: an API session cookie outlives a
 * front-end login, so a browser that has switched accounts keeps the old one until it
 * signs in again.
 *
 * When they disagree the signature is over a different username, the checker rebuilds
 * the message with the account we sent, the two do not match, and it comes back as
 * "Invalid signature" — which reads as a broken key and is really a stale cookie. It
 * cost a session to find, because the signature itself was perfectly valid: it just
 * named somebody else.
 *
 * Refuse rather than send the mismatched pair. Sending `data.username` instead would be
 * worse: it would quietly save the setting onto the wrong account.
 */
function assertSignedForUs(data, account) {
  const signedFor = String(data?.username || '').toLowerCase();
  const want = String(account || '').toLowerCase();
  if (signedFor && want && signedFor !== want) {
    throw new Error(
      t('ads.errors.signedInAsOther', { signedFor, want }),
    );
  }
}

export async function fetchAdAccess(account) {
  try {
    const res = await fetch(`${BASE}/access/${encodeURIComponent(account)}`);
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body.allowed !== 'boolean') return null;
    return { allowed: body.allowed, stage: body.stage || null };
  } catch {
    return null;
  }
}

export async function fetchCreatorAdPrefs(account) {
  return readJson(await fetch(`${BASE}/creator/prefs/${encodeURIComponent(account)}`));
}

/**
 * Mirror one post's per-video ad choice into the checker.
 *
 * Carries no signature and needs none: the checker reads the post off the chain
 * and copies the `3speak.ads` flag its author signed into it. A fresh broadcast is
 * not readable for a block or two, so a 404 is retried rather than reported.
 */
const VIDEO_ADS_SYNC_DELAYS_MS = [2000, 4000, 8000];
export async function syncVideoAdOptOut(author, permlink) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readJson(await fetch(`${BASE}/creator/video-ads/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, permlink }),
      }));
    } catch (err) {
      if (err?.status !== 404 || attempt >= VIDEO_ADS_SYNC_DELAYS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, VIDEO_ADS_SYNC_DELAYS_MS[attempt]));
    }
  }
}

/* ─── turning ads off ─────────────────────────────────────────────────── */

// Wallets that can sign an arbitrary message in the browser. HiveSigner cannot
// sign buffers, and Butter Auth / ManteAuth sessions hold no client-side key at
// all — they publish through @threespeak. Same set the chat login uses.
const SIGN_CAPABLE_PROVIDERS = new Set([
  Providers.Keychain,
  Providers.HiveAuth,
  Providers.PeakVault,
  Providers.Ledger,
]);

function canSignLocally() {
  if (isManteAuthLogin()) return false;
  return SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider());
}

// Must match prefsMessage() in 3speakchecks/routes/advertise.js exactly. The
// community share is part of it because that field decides where money goes — a
// signature made for one split must not be reusable on another.
const prefsMessage = (account, adsEnabled, communitySharePct, timestamp) =>
  ['3speak-ads', 'creator-prefs', account, adsEnabled ? 'on' : 'off',
    String(communitySharePct), String(timestamp)].join('|');

/**
 * Ask our own backend to sign the preference with @threespeak's posting key,
 * under the authority the creator already granted it.
 *
 * This is the path nearly every creator takes. Most have already granted
 * @threespeak posting authority, and a login that has done so should not be asked
 * to approve a preference toggle in a wallet popup — the grant is what it is for.
 * It also happens to be the only path that works at all for HiveSigner and Butter
 * Auth, which hold no key in the browser.
 *
 * We send only a boolean; the backend builds and signs the message itself, so it
 * can never be talked into signing arbitrary bytes. It refuses with a 403 when the
 * account has not granted the authority, which is what makes the wallet fallback
 * in setCreatorAdPrefs reachable.
 */
async function signViaThreespeak(adsEnabled, communitySharePct, account) {
  const provider = getCurrentProvider();
  const isWallet = !!provider && provider !== Providers.HiveSigner && !isManteAuthLogin();

  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    const body = { adsEnabled, communitySharePct };

    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (!token) throw new Error(t('ads.errors.hivesignerExpired'));
      headers.Authorization = `Bearer ${token}`;
    } else if (!isManteAuthLogin()) {
      headers['X-API-Key'] = EMBED_API_KEY;
      body.username = account;
    }

    const r = await fetch(`${THREESPEAK_API}/ads/opt-out-signature`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    return { r, d: await r.json().catch(() => ({})) };
  };

  let { r: res, d: data } = await doPost();
  // Same 401 recovery /api/broadcast does before it will post a video: mint the
  // SIWH session cookie, then ask again. The cookie is a real credential (the user
  // signed a challenge with their posting key at login) and the server checks it
  // ahead of the claimed-username path, so this is what keeps delegated signing
  // working for wallet logins if ALLOW_APPKEY_AUTH is ever turned off.
  /* Re-mint the session and retry, for a refusal AND for a signature made in somebody
   * else's name.
   *
   * The API session cookie outlives a front-end account switch: the page is on the new
   * account while the cookie still names the old one, so the signer signs for the old
   * one and the checker rejects it. Switching accounts should just work, so the mismatch
   * is treated exactly like the 401 it resembles — establishWalletSession() re-mints for
   * whoever is logged in NOW, and the second attempt is signed for them.
   *
   * assertSignedForUs() below is still the backstop, for when re-minting cannot fix it. */
  const signedForSomeoneElse = () => {
    const got = String(data?.username || '').toLowerCase();
    return !!got && got !== String(account || '').toLowerCase();
  };
  if (isWallet && (res.status === 401 || signedForSomeoneElse()) && await establishWalletSession(account)) {
    ({ r: res, d: data } = await doPost());
  }
  if (!res.ok || !data.signature) {
    // A 403 here means exactly one thing: @threespeak holds no posting authority on
    // this account, so it cannot sign for them. The message the server sends back
    // already says so in words, and is what a login that cannot sign locally shows.
    throw new Error(data.error || t('ads.errors.saveSettingFailed'));
  }
  assertSignedForUs(data, account);
  return { signature: data.signature, timestamp: data.timestamp };
}

async function signLocally(account, adsEnabled, communitySharePct) {
  const timestamp = Date.now();
  const res = await signMessageWithAioha(
    prefsMessage(account, adsEnabled, communitySharePct, timestamp),
    KeyTypes.Posting,
    adsEnabled ? t('ads.wallet.saveAdSettings') : t('ads.wallet.turnAdsOff'),
  );
  if (!res?.success || !res.result) throw new Error(t('ads.errors.signatureRejected'));
  return { signature: res.result, timestamp };
}

/**
 * Save this creator's ad settings: whether their videos carry ads, and how much of
 * the creator pool goes to the community they posted in. Signed by @threespeak
 * under the posting authority the creator already granted it, falling back to the
 * creator's own wallet only when that authority is not there.
 *
 * Both fields go in one signed message, so saving is one signature rather than one
 * per field — which matters when the wallet shows a prompt for each.
 */
export async function setCreatorAdPrefs(account, { adsEnabled, communitySharePct }) {
  // No default here on purpose: the platform default lives on the server, and a
  // second copy in the browser is a copy that can drift out of step with the
  // message being signed. Omitting the field lets the server decide; passing 0
  // means the creator chose zero.
  //
  // 🚨 Delegated FIRST, wallet second — the reverse of what this used to do.
  // Most creators here have already granted @threespeak posting authority, and
  // preferring the local signature meant every one of them got a wallet popup for
  // a preference toggle when the grant they already gave us could cover it. The
  // client-side signature is now the fallback for the accounts that have NOT set
  // up that authority, which is the only case where it is actually needed.
  let signed;
  try {
    signed = await signViaThreespeak(adsEnabled, communitySharePct, account);
  } catch (err) {
    // A 403 is "no @threespeak grant". Anything else is a session or server
    // problem. Either way, a wallet that can sign should just sign rather than
    // hand the creator an error about authority they may not want to grant.
    if (!canSignLocally()) throw err;
    signed = await signLocally(account, adsEnabled, communitySharePct);
  }
  const { signature, timestamp } = signed;

  return readJson(await fetch(`${BASE}/creator/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, adsEnabled, communitySharePct, signature, timestamp }),
  }));
}

/* ─── viewer rewards: consent to be identified ────────────────────────── */

// Must match viewerPrefsMessage() in 3speakchecks/routes/advertise.js exactly.
// A distinct action string from creator-prefs, so a signature taken for one can
// never be replayed into the other.
const viewerPrefsMessage = (account, rewardsEnabled, timestamp) =>
  ['3speak-ads', 'viewer-prefs', account, rewardsEnabled ? 'on' : 'off',
    String(timestamp)].join('|');

/**
 * Has this viewer answered the question yet, and what did they say?
 *
 * `decided` is the field the prompt keys off. Without it "said no" and "never
 * asked" both look like `rewardsEnabled: false`, and we would nag someone who has
 * already declined every time they open the app.
 */
export async function fetchViewerAdPrefs(account) {
  return readJson(await fetch(`${BASE}/viewer/prefs/${encodeURIComponent(account)}`));
}

/**
 * A short-lived token proving WHO IS WATCHING, for the player service.
 *
 * The player records watch time against a Hive account and that ledger pays out, so
 * the name has to be proved rather than claimed. A browser cannot hold a signing key,
 * so our server signs for the session it can already see and hands back a token bound
 * to one video for a few minutes.
 *
 * 🚨 The server accepts ONLY logins it can actually verify: a Butter Auth session, a
 * SIWH wallet cookie, or a HiveSigner token it checks with HiveSigner. It deliberately
 * refuses the app-key-plus-claimed-name path the signing routes above still allow,
 * because that path would let anyone mint a token naming anyone.
 *
 * Returns null on any failure, and that is not an error worth surfacing: the watch is
 * simply unattributed, exactly as it is for a signed-out viewer.
 */
export async function fetchWatchToken(owner, permlink) {
  try {
    if (!owner || !permlink) return null;
    const headers = { 'Content-Type': 'application/json' };
    if (getCurrentProvider() === Providers.HiveSigner) {
      const tok = localStorage.getItem('hivesignerToken');
      if (tok) headers.Authorization = `Bearer ${tok}`;
    }
    const r = await fetch(`${THREESPEAK_API}/watch/token`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ owner, permlink }),
    });
    if (!r.ok) return null;                       // 401 simply means "not provable here"
    const d = await r.json().catch(() => null);
    return d?.token || null;
  } catch {
    return null;
  }
}

async function signViewerViaThreespeak(rewardsEnabled, account) {
  const provider = getCurrentProvider();
  const isWallet = !!provider && provider !== Providers.HiveSigner && !isManteAuthLogin();

  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    const body = { rewardsEnabled };
    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (!token) throw new Error(t('ads.errors.hivesignerExpired'));
      headers.Authorization = `Bearer ${token}`;
    } else if (!isManteAuthLogin()) {
      headers['X-API-Key'] = EMBED_API_KEY;
      body.username = account;
    }
    const r = await fetch(`${THREESPEAK_API}/ads/viewer-signature`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(body),
    });
    return { r, d: await r.json().catch(() => ({})) };
  };

  let { r: res, d: data } = await doPost();
  /* Re-mint the session and retry, for a refusal AND for a signature made in somebody
   * else's name.
   *
   * The API session cookie outlives a front-end account switch: the page is on the new
   * account while the cookie still names the old one, so the signer signs for the old
   * one and the checker rejects it. Switching accounts should just work, so the mismatch
   * is treated exactly like the 401 it resembles — establishWalletSession() re-mints for
   * whoever is logged in NOW, and the second attempt is signed for them.
   *
   * assertSignedForUs() below is still the backstop, for when re-minting cannot fix it. */
  const signedForSomeoneElse = () => {
    const got = String(data?.username || '').toLowerCase();
    return !!got && got !== String(account || '').toLowerCase();
  };
  if (isWallet && (res.status === 401 || signedForSomeoneElse()) && await establishWalletSession(account)) {
    ({ r: res, d: data } = await doPost());
  }
  if (!res.ok || !data.signature) {
    throw new Error(data.error || t('ads.errors.saveSettingFailed'));
  }
  assertSignedForUs(data, account);
  return { signature: data.signature, timestamp: data.timestamp };
}

/**
 * Record whether this viewer wants to be identified so they can earn a share of ad
 * revenue. Delegated signature first, wallet second — same order and same reasoning
 * as the creator settings: most accounts have already granted @threespeak posting
 * authority, and a preference toggle should not summon a wallet popup when it has.
 *
 * ⚠️ Turning this OFF also deletes the identified watch rows already collected.
 * The server does that, not the client, but it is the reason the copy says the
 * data is removed rather than merely that collection stops.
 */
export async function setViewerAdPrefs(account, { rewardsEnabled }) {
  let signed;
  try {
    signed = await signViewerViaThreespeak(rewardsEnabled, account);
  } catch (err) {
    if (!canSignLocally()) throw err;
    const timestamp = Date.now();
    const res = await signMessageWithAioha(
      viewerPrefsMessage(account, rewardsEnabled, timestamp),
      KeyTypes.Posting,
      rewardsEnabled ? t('ads.wallet.rewardsOn') : t('ads.wallet.rewardsOff'),
    );
    // `cause` carries the delegated-signing failure that sent us down the wallet
    // path, so a rejected prompt does not erase why we asked for one.
    if (!res?.success || !res.result) throw new Error(t('ads.errors.signatureRejected'), { cause: err });
    signed = { signature: res.result, timestamp };
  }
  const { signature, timestamp } = signed;

  return readJson(await fetch(`${BASE}/viewer/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, rewardsEnabled, signature, timestamp }),
  }));
}

/* ─── finding your own applications ───────────────────────────────────── */

// Remembering the references we have already proved ownership of. The reference IS
// the credential the rest of this file uses, so once it is on this device the next
// visit costs no signature at all — which is the difference between a wallet prompt
// on every page load and one prompt, ever.
const MINE_KEY = (account) => `3speak-ads-refs:${String(account).toLowerCase()}`;

/**
 * The enrollment in progress, so a refresh resumes where it left off.
 *
 * Kept separately from the remembered-reference list: that one is "products I can
 * open", this one is "the product I am part way through enrolling", which is a
 * different question and has a step attached to it.
 */
const WIZARD_KEY = (account) => `3speak-ads-wizard:${String(account).toLowerCase()}`;

export function readWizard(account) {
  if (!account) return null;
  try {
    const v = JSON.parse(localStorage.getItem(WIZARD_KEY(account)) || 'null');
    return v && typeof v.reference === 'string' ? v : null;
  } catch { return null; }
}

export function rememberWizard(account, reference, step, adType) {
  if (!account || !reference) return;
  try {
    // The ad type belongs here with the step. It decides the file types, the copy
    // and which format step 3 books, so losing it on a refresh silently reverted a
    // banner enrollment to a video one.
    const prev = readWizard(account) || {};
    localStorage.setItem(WIZARD_KEY(account), JSON.stringify({
      reference,
      step,
      adType: adType || prev.adType || 'video',
    }));
  } catch { /* private mode, quota — never worth an error */ }
}


export function clearWizard(account) {
  try { localStorage.removeItem(WIZARD_KEY(account)); } catch { /* nothing to undo */ }
}

export function rememberReference(account, reference) {
  if (!account || !reference) return;
  try {
    const key = MINE_KEY(account);
    const held = JSON.parse(localStorage.getItem(key) || '[]');
    if (!held.includes(reference)) {
      localStorage.setItem(key, JSON.stringify([reference, ...held].slice(0, 25)));
    }
  } catch { /* private mode, quota, cleared storage — never worth an error */ }
}

export function rememberedReferences(account) {
  if (!account) return [];
  try {
    const held = JSON.parse(localStorage.getItem(MINE_KEY(account)) || '[]');
    return Array.isArray(held) ? held.filter((r) => typeof r === 'string') : [];
  } catch { return []; }
}

export function forgetReferences(account) {
  try { localStorage.removeItem(MINE_KEY(account)); } catch { /* nothing to undo */ }
}

// Must match mineMessage() in 3speakchecks/routes/advertise.js exactly.
const mineMessage = (account, timestamp) => ['3speak-ads', 'mine', account, String(timestamp)].join('|');

/**
 * Ask our own backend to vouch for who is logged in.
 *
 * Works for every session the server can verify: a Butter Auth cookie, a HiveSigner
 * token, or the wallet-login session a Keychain/HiveAuth/PeakVault/Ledger login sets
 * up when it logs in. The answer is a 'mine-vouch' signature the checker accepts
 * without a posting grant (`vouched: true`).
 */
async function identityViaThreespeak(account) {
  const headers = { 'Content-Type': 'application/json' };
  if (getCurrentProvider() === Providers.HiveSigner) {
    const token = localStorage.getItem('hivesignerToken');
    if (!token) throw new Error(t('ads.errors.hivesignerExpired'));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${THREESPEAK_API}/ads/identity-signature`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signature) {
    throw new Error(data.error || t('ads.errors.confirmIdentity'));
  }
  // The server signed for the account ITS session resolves to, which is the only
  // one it can vouch for. If that is not who the page thinks is logged in, the
  // honest thing is to stop rather than ask the checker about somebody else.
  if (account && data.username && data.username !== String(account).toLowerCase()) {
    throw new Error(t('ads.errors.sessionOtherAccount'));
  }
  return {
    signature: data.signature,
    timestamp: data.timestamp,
    account: data.username,
    vouched: data.vouched === true,
  };
}

/**
 * Every application belonging to the logged-in account.
 *
 * Silent first: our backend vouches for the session (see identityViaThreespeak), so
 * nobody is asked for anything on arrival. Only a wallet login with no session yet
 * (cookies cleared, or it predates sessions) needs a signature, and only with
 * `prompt` (the user pressed "Show my products"): it sets up the 30-day login
 * session, which also serves comments and votes, and asks again. Signing the
 * 'mine' message by hand is the last resort, if that session cannot be made.
 */
export async function fetchMyApplications(account, { prompt = false } = {}) {
  const name = String(account || '').toLowerCase();
  if (!name) return [];

  let proof;
  try {
    proof = await identityViaThreespeak(name);
  } catch (err) {
    if (!canSignLocally()) throw err;
    if (!prompt) throw new Error(t('ads.errors.confirmLoginToList'), { cause: err });
    if (await establishWalletSession(name).catch(() => false)) {
      proof = await identityViaThreespeak(name).catch(() => null);
    }
    if (!proof) {
      const timestamp = Date.now();
      const res = await signMessageWithAioha(
        mineMessage(name, timestamp),
        KeyTypes.Posting,
        t('ads.wallet.showApplications'),
      );
      if (!res?.success || !res.result) throw new Error(t('ads.errors.signatureRejected'), { cause: err });
      proof = { signature: res.result, timestamp, vouched: false };
    }
  }

  const body = await readJson(await fetch(`${BASE}/mine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: name,
      signature: proof.signature,
      timestamp: proof.timestamp,
      vouched: proof.vouched === true,
    }),
  }));

  const applications = body.applications || [];
  applications.forEach((a) => rememberReference(name, a.reference));
  return applications;
}

/** Abandon an enrollment and delete what it created. Pending products only. */
export async function discardProduct(reference) {
  return readJson(await fetch(`${BASE}/product/discard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  }));
}

/* ─── formatting ──────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/**
 * Counts, rounded to whole numbers — except below 10, where a decimal is kept.
 * Rounding 0.2 to "0" reads as a broken page rather than a small number, and the
 * difference between "none" and "a fifth of one a day" is exactly what a small
 * slot's figures need to convey.
 */
export const formatCount = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n > 0 && n < 10 && !Number.isInteger(n)) return String(Math.round(n * 10) / 10);
  return nf.format(Math.round(n));
};

/**
 * "A quarter of the way in" / "Before the video" — how a slot reads to someone
 * buying it.
 *
 * Slots are a percentage of the video, not a number of seconds, so the same
 * placement means the same relative moment on a 90-second clip and a half-hour
 * talk. Takes `{ percent }`; `{ position }` is still understood so a campaign
 * booked before the change keeps describing itself in the seconds it was sold as.
 */
export function slotLabel(slot) {
  // A banner is burned INTO the picture, so it never precedes anything: at 0% it
  // starts with the video rather than playing before it. Calling that "before the
  // video" describes a roll, and would have an advertiser expecting their banner to
  // show while the video had not started.
  const zeroLabel = slot && slot.banner ? t('ads.slot.atBeginning') : t('ads.slot.beforeVideo');
  if (!slot) return zeroLabel;

  if (slot.percent != null) {
    if (slot.percent === 0) return zeroLabel;
    if (slot.percent === 25) return t('ads.slot.quarter');
    if (slot.percent === 50) return t('ads.slot.half');
    if (slot.percent === 75) return t('ads.slot.threeQuarters');
    return t('ads.slot.percentIn', { percent: slot.percent });
  }

  // Legacy, in seconds.
  if (slot.position === 0 || slot.position == null) return zeroLabel;
  if (slot.position < 60) return t('ads.slot.secondsIn', { count: slot.position });
  const mins = slot.position / 60;
  const shown = Number.isInteger(mins) ? mins : mins.toFixed(1);
  return String(shown) === '1' ? t('ads.slot.oneMinuteIn') : t('ads.slot.minutesIn', { minutes: shown });
}

// Region names from the browser, falling back to the raw code. Avoids shipping a
// country-name table for the fifteen codes we actually show.
const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames
  ? new Intl.DisplayNames(undefined, { type: 'region' })
  : null;

export function countryName(code) {
  if (!code || code === 'unknown') return t('ads.market.unplaced');
  try { return (regionNames && regionNames.of(code)) || code; } catch { return code; }
}

/* ─── the spot itself ─────────────────────────────────────────────────── */

/**
 * Read a video's duration in the browser, before uploading it.
 *
 * Worth the extra step: a spot that is too long is rejected by the backend anyway,
 * and finding that out after waiting for an upload is a much worse way to learn it.
 */
export function readVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration) : 0);
    v.onerror = () => done(0);          // unreadable → let the backend decide
    v.src = url;
  });
}

/**
 * Upload a spot and register it for review.
 *
 * Goes through the ordinary embed upload pipeline, so the spot is encoded to the
 * same HLS ladder as every other video on the platform — a creative encoded any
 * other way would stall the splice on a codec or resolution change.
 *
 * `frontend_app: '3speak-ads'` is what keeps it out of the site: the embed backend
 * only sets `listed_on_3speak` for uploads from '3speak-tv', and nothing here
 * broadcasts to Hive, so the spot has no post, earns no rewards and appears in no
 * feed. It exists only to be reviewed and then played inside a break.
 */
/**
 * Upload a still (logo, frame, key art) and register it as an asset.
 *
 * Goes through the same image host everything else on 3Speak uses. It is NOT a
 * playable spot — the stitcher splices HLS and a still is not something HLS can
 * express — so it is stored for a human to build a spot around, and the server
 * refuses to serve it. The UI says so rather than letting an advertiser assume.
 */
export async function uploadImageAsset({ file, reference }) {
  // Reuses the thumbnail uploader's fallback chain rather than calling one host
  // directly: @threespeak signs first, then the 3Speak image server. That matters
  // right now — the @threespeak path has been returning `quota_exceeded` from
  // images.hive.blog, and going straight at it meant every ad image upload failed
  // when the platform already had a working second route.
  //
  // `preferStatic` skips the middle, user-signed step on purpose: it would put a
  // wallet-signing prompt in front of someone uploading a logo, and it cannot run
  // at all for the logins that have no client-side key.
  const url = await uploadThumbnail(file, null, { preferStatic: true });
  if (!url) throw new Error(t('ads.errors.imageUploadFailed'));

  return readJson(await fetch(`${BASE}/creatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, imageUrl: url }),
  }));
}

/** The most a slogan may be. Mirrors SLOGAN_MAX in 3speakchecks/routes/advertise.js. */
export const SLOGAN_MAX = 50;

/**
 * Save the logo and slogan the disclosure overlay draws while the ad plays.
 *
 * Fields left `undefined` are not touched, so saving a slogan cannot wipe a logo
 * nobody mentioned. Pass an empty string to clear one deliberately.
 */
export async function saveBranding({ reference, logoUrl, slogan }) {
  const body = { reference };
  if (logoUrl !== undefined) body.logoUrl = logoUrl;
  if (slogan !== undefined) body.slogan = slogan;
  return readJson(await fetch(`${BASE}/branding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/**
 * Upload a logo and attach it to the product.
 *
 * Same host and the same fallback chain as a thumbnail (`preferStatic` skips the
 * user-signed step, which would otherwise put a wallet prompt in front of somebody
 * uploading a logo and cannot run at all for logins with no client-side key).
 * Unlike an image asset this is NOT registered as a creative: it identifies the
 * advertiser rather than being something that could ever play.
 */
export async function uploadLogo({ file, reference }) {
  const url = await uploadThumbnail(file, null, { preferStatic: true });
  if (!url) throw new Error(t('ads.errors.logoUploadFailed'));
  return saveBranding({ reference, logoUrl: url });
}

export async function uploadCreative({ file, account, reference, durationSeconds }) {
  const form = new FormData();
  form.append('owner', account);
  form.append('frontend_app', '3speak-ads');
  form.append('filename', file.name || 'spot.mp4');
  if (durationSeconds) form.append('duration', String(durationSeconds));
  form.append('file', file, file.name || 'spot.mp4');

  const up = await fetch(`${EMBED_API_URL}/upload/simple`, {
    method: 'POST',
    headers: { 'X-API-Key': EMBED_API_KEY },
    body: form,
  });
  const upJson = await up.json().catch(() => ({}));
  if (!up.ok || !upJson.permlink) {
    throw new Error(upJson.error || t('ads.errors.uploadFailedStatus', { status: up.status }));
  }

  // Claim the upload as an ad creative. Separate call on purpose: the upload
  // endpoint belongs to the embed service and knows nothing about advertising.
  return readJson(await fetch(`${BASE}/creatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, embedId: upJson.permlink }),
  }));
}

/** Save a ticker's message and link as a creative. It goes to review like any other. */
export async function saveTickerCreative({ reference, message, clickUrl, style = 'crawl' }) {
  return readJson(await fetch(`${BASE}/creatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, message, clickUrl, style }),
  }));
}

export async function fetchCreatives(reference) {
  return readJson(await fetch(`${BASE}/creatives?reference=${encodeURIComponent(reference)}`));
}

/**
 * Rate card + where to send payment.
 *
 * With a reference it returns THAT advertiser's daily rate, which can be negotiated
 * away from the platform default. Without one it is the public rate card. Passing it
 * matters: the total shown before booking has to be the total that gets charged.
 */
export async function fetchPricing(reference, { beta = false } = {}) {
  const q = new URLSearchParams();
  if (reference) q.set('reference', reference);
  // Asks to SEE beta formats (the ticker). The checker still decides who may book one.
  if (beta) q.set('beta', '1');
  const qs = q.toString();
  return readJson(await fetch(qs ? `${BASE}/pricing?${qs}` : `${BASE}/pricing`));
}

/* ─── campaigns ───────────────────────────────────────────────────────── */

export async function createCampaign({
  reference, format, name, days, slotPercent, spotSeconds,
  minVideoSeconds, maxVideoSeconds, markets, startAt, production,
}) {
  return readJson(await fetch(`${BASE}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference, format, name, days, slotPercent, spotSeconds,
      minVideoSeconds, maxVideoSeconds, markets, startAt, production,
    }),
  }));
}

/**
 * Which positions are actually for sale for a window.
 *
 * A position is sold exclusively across every format, so the form has to ask before
 * it offers: showing all five and then refusing one at submit is a worse experience
 * than only ever offering what can be bought. Never cached — availability moves as
 * holds lapse and flights end, and a stale "free" is a booking that fails.
 */
export async function fetchSlots({ days, startAt, format }) {
  const q = new URLSearchParams({ days: String(days) });
  if (startAt) q.set('startAt', String(startAt));
  // Availability is per surface: a banner at 25% does not consume the roll at 25%.
  if (format) q.set('format', String(format));
  return readJson(await fetch(`${BASE}/slots?${q.toString()}`));
}

export async function fetchCampaigns(reference) {
  return readJson(await fetch(`${BASE}/campaigns?reference=${encodeURIComponent(reference)}`));
}

/**
 * Ask the server to look for the on-chain payment.
 *
 * Nothing about the money is asserted from here — the backend reads the payment
 * account's own transfer history and matches the memo. The button is a nudge to go
 * and check, not a claim that anything was paid.
 */
export async function claimCampaign(campaignId) {
  return readJson(await fetch(`${BASE}/campaigns/${encodeURIComponent(campaignId)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }));
}

/**
 * Attach a creative to a flight. A video spot is attached by `embedId`; a banner is
 * an image and is attached by `imageUrl` — the campaign's format decides which, and
 * the server refuses the mismatch with an answer rather than failing later.
 */
export async function attachCreative({ reference, campaignId, embedId, imageUrl }) {
  return readJson(await fetch(`${BASE}/campaigns/${encodeURIComponent(campaignId)}/creative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(imageUrl ? { reference, imageUrl } : { reference, embedId }),
  }));
}

/** Plain-English answer to "why isn't my campaign running". Values are i18n keys. */
export const BLOCKED_REASON = {
  unpaid: 'ads.blocked.unpaid',
  no_creative: 'ads.blocked.no_creative',
  creative_pending: 'ads.blocked.creative_pending',
  creative_review: 'ads.blocked.creative_review',
  creative_rejected: 'ads.blocked.creative_rejected',
  creative_not_encoded: 'ads.blocked.creative_not_encoded',
  not_started: 'ads.blocked.not_started',
  ended: 'ads.blocked.ended',
  paused: 'ads.blocked.paused',
  cancelled: 'ads.blocked.cancelled',
  complete: 'ads.blocked.complete',
  not_submitted: 'ads.blocked.not_submitted',
};
