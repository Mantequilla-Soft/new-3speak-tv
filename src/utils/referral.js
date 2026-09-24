/**
 * Referral links: `https://3speak.tv/?ref=alice`
 *
 * Somebody shares a link, a new person follows it, signs up through Butter Auth
 * days later, and the referrer gets the credit. The two ends of that are a long
 * way apart -- a link click and an OAuth popup, with any amount of browsing in
 * between -- so the name is captured the moment it arrives and kept until it is
 * needed.
 *
 * FIRST TOUCH WINS. A stored referral is never overwritten by a later link.
 * That matches what the server does with the answer (Butter Auth records a
 * referrer write-once), and it is the honest reading: the person who got you
 * here is the one who got you here, not whoever's link you happened to open
 * last. Without this, any creator could re-credit somebody else's signups just
 * by getting their link in front of them again before they registered.
 *
 * It EXPIRES. An unbounded referral in localStorage means a link clicked in
 * January credits a stranger for an account created in September, which is not
 * attribution, it is a trap for whoever has to explain the payout.
 */

const KEY = 'threespeak_referral';

// 30 days, the ordinary window for this kind of attribution.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Hive's own account-name shape, loosely: this is a courtesy check that keeps
// junk out of storage, not a gate. Butter Auth validates the name properly and
// drops a bad one quietly, so being slightly permissive here costs nothing and
// being too strict would silently lose real referrals.
const NAME_RE = /^[a-z0-9][a-z0-9.-]{1,15}$/;

function normalise(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/^@/, '');
  return NAME_RE.test(v) ? v : null;
}

/**
 * Read `?ref=` off the current URL and remember it. Safe to call on every mount.
 * @returns {string|null} the name now stored, if any.
 */
export function captureReferralFromUrl(search = window.location.search) {
  let name = null;
  try {
    name = normalise(new URLSearchParams(search).get('ref'));
  } catch {
    return getStoredReferral();
  }
  if (!name) return getStoredReferral();

  const existing = getStoredReferral();
  // First touch wins, as above. Deliberately NOT an overwrite.
  if (existing) return existing;

  try {
    localStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() }));
  } catch {
    // Private mode, or storage full. The referral is lost, which is a missed
    // credit and not an error worth showing anybody.
  }
  return name;
}

/** The remembered referrer, or null if there is none or it has expired. */
export function getStoredReferral() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { name, at } = JSON.parse(raw);
    if (!name || !at || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return normalise(name);
  } catch {
    return null;
  }
}

export function clearStoredReferral() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/**
 * Add the remembered referrer to a Butter Auth authorize URL.
 *
 * Here rather than at each call site because there are two of them -- the login
 * modal and the shared popup helper -- and a referral that rides along on only
 * one is the kind of bug that shows up as "attribution works sometimes".
 *
 * Appended client-side rather than asked for from our own /api/manteauth/start:
 * the value is something the visitor's own URL supplied, Butter Auth validates
 * it itself, and routing it through the server would buy no more trust than the
 * link already had.
 */
export function withReferrer(url) {
  const name = getStoredReferral();
  if (!name || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    // Never clobber one butrauth was already given.
    if (!u.searchParams.get('referrer')) u.searchParams.set('referrer', name);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Invite links: `https://3speak.tv/invite/<code>`
 *
 * Different from `?ref=` above, and stronger. A `?ref=` name is only a claim;
 * an invite code was issued by 3Speak (on Butter Auth's Referrals tab) to a
 * referrer it trusts, and a new user who signs up with it can get a real Hive
 * account straight away instead of the warm-up. The code is kept here from the
 * moment the invite page opens until sign-up, then handed to Butter Auth by
 * /api/manteauth/start, which puts it on the authorize URL through the SDK.
 *
 * FIRST TOUCH WINS, like the referral name: Butter Auth binds an invite to a
 * person write-once, so a second link could never take over anyway, and
 * keeping the first here keeps the two sides in agreement.
 */
const INVITE_KEY = 'threespeak_invite';
const INVITE_RE = /^[a-z0-9]{10}$/;

export function rememberInvite(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!INVITE_RE.test(c)) return getStoredInvite();
  const existing = getStoredInvite();
  if (existing) return existing;
  try {
    localStorage.setItem(INVITE_KEY, JSON.stringify({ code: c, at: Date.now() }));
  } catch {
    // Private mode: the invite still works if they sign up in this visit,
    // because the landing page passes it along directly as well.
  }
  return c;
}

/** The remembered invite code, or null if none or expired (30 days, as above). */
export function getStoredInvite() {
  try {
    const raw = localStorage.getItem(INVITE_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw);
    if (!code || !at || Date.now() - at > MAX_AGE_MS || !INVITE_RE.test(code)) {
      localStorage.removeItem(INVITE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearStoredInvite() {
  try { localStorage.removeItem(INVITE_KEY); } catch { /* nothing to clear */ }
}
