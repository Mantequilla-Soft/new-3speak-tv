/**
 * Cookie / browser-storage consent.
 *
 * WHAT THE LAW ACTUALLY REQUIRES (§25 TDDDG, the German ePrivacy implementation —
 * this is not a GDPR rule): do not store or read ANYTHING on a user's device unless
 * it is strictly necessary for a service they explicitly asked for, or they have
 * consented. It covers localStorage and sessionStorage, not just cookies. There is
 * no "you must show a popup" rule — a banner is what you need when you store
 * something that ISN'T strictly necessary.
 *
 * After the 2026-07-14 privacy work, 3Speak stores almost nothing that needs
 * consent:
 *
 *   ESSENTIAL (consent-exempt — §25(2) Nr. 2, "explicitly requested by the user"):
 *     • Login session (access_token, user_id, accountsList, activeAccount, aioha*,
 *       hivesigner*, manteauth_login, butrauth_*, auth-entropy/public-key; plus the
 *       server httpOnly cookies threespeak_session/wsession/user + manteauth_pkce)
 *     • Settings YOU set: theme, volume, mute, autoplay, quality, subtitles,
 *       language, NSFW, card size, feed prefs, home tab order, reactions, vote
 *       weight, OpenPod announce config, shorts mute/mode  (`user-store` + friends)
 *     • Resuming an interrupted upload (tus::*, chunked::*) AND post-composer drafts
 *       (hh-studio-post-draft) — so you don't lose work you explicitly started
 *     • The installed PWA's own asset cache + OS "share into 3Speak" (service
 *       worker: workbox precache + share-target-cache) — first-party, strictly
 *       necessary; stores 3Speak's own files, never third-party content
 *     • App-version marker (3speak_app_version) for the "what's new" changelog
 *     • "Welcome box closed" (3speak_welcome_closed): set when you close the welcome
 *       box with its X, so it does not come back
 *     • This consent choice itself — we cannot remember "no" without storing "no"
 *
 *   FUNCTIONAL (optional — this is what the banner is actually for):
 *     • `3speak_pos_<owner>/<permlink>` — where you left off in each video, so
 *       playback resumes. Individually harmless, but it accumulates one key per
 *       video ever watched: a de-facto watch history sitting in your browser. It
 *       stays on your device and is never sent to us, but you did not ask for it
 *       by name, so it is offered as a choice rather than assumed.
 *
 *   ADVERTISING (optional, and only exists at all when third-party ads are
 *   switched on via VITE_ENABLE_THIRDPARTY_ADS):
 *     • Whatever a third-party ad SDK stores once it is allowed to load. We do not
 *       get to enumerate it the way we can enumerate our own keys, which is exactly
 *       why it is a separate opt-in rather than folded into "functional". Withheld
 *       consent means the SDK is never injected, so there is nothing to store: see
 *       canLoadAdScripts() in thirdPartyAds.js.
 *
 * What is NOT here while VITE_ENABLE_THIRDPARTY_ADS is off: no analytics, no
 * advertising, no third-party pixels, no tracking IDs. The watch-duration tracking
 * stores nothing on your device at all (see the note on `sid` in watchTracking.js).
 *
 * The banner copy is driven by the same flag, so it cannot drift out of step with
 * what the site actually does. That drift is the failure mode worth engineering
 * against: a truthful "we run no advertising" notice becomes a false statement the
 * moment someone ships an ad tag, and nobody remembers to edit the banner.
 */
import { ENABLE_THIRDPARTY_ADS } from '../utils/config';

const KEY = '3speak_cookie_consent';
// Bump to re-ask everyone. Tied to the ads flag on purpose: switching third-party
// ads on introduces a category nobody has seen, and carrying forward an old "Accept"
// would count as consent to something that did not exist when it was given.
const VERSION = ENABLE_THIRDPARTY_ADS ? 2 : 1;

// Written by the @mantequilla-soft/3speak-player SDK, one per video watched.
const RESUME_KEY_PREFIX = '3speak_pos_';

const DEFAULTS = { essential: true, functional: false, advertising: false };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== VERSION) return null; // stale schema → ask again
    return parsed;
  } catch {
    return null;
  }
}

/** Has the user answered the banner yet? */
export function hasDecided() {
  return read() !== null;
}

/** Current consent for a category. Essential is always true; anything unknown is false. */
export function hasConsent(category) {
  if (category === 'essential') return true;
  // Belt and braces: with the flag off there is no advertising category, so nothing
  // may claim consent for one. Without this, a stored record from an ads-enabled
  // build would keep returning true after the flag was switched back off.
  if (category === 'advertising' && !ENABLE_THIRDPARTY_ADS) return false;
  const c = read();
  return c ? !!c[category] : DEFAULTS[category] ?? false;
}

/**
 * Record the choice. `functional` false → immediately purge what it covers.
 *
 * Purging matters: the player SDK writes resume positions on its own, so "declined"
 * has to mean we actively remove them, not merely that we promise not to look.
 */
export function setConsent({ functional, advertising }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      version: VERSION,
      essential: true,
      functional: !!functional,
      // Pinned to false whenever the flag is off, so a stored "yes" from a period
      // when ads were enabled cannot silently re-authorise them if they are later
      // switched off and on again.
      advertising: ENABLE_THIRDPARTY_ADS ? !!advertising : false,
      decidedAt: new Date().toISOString(),
    }));
  } catch {
    /* storage disabled — the banner will simply ask again next visit */
  }
  if (!functional) purgeFunctionalStorage();
}

/**
 * Remove every key the functional category covers. Safe to call at any time; called
 * on decline and again on each app start while consent is withheld, because the
 * player SDK will keep re-creating these keys as videos are watched.
 */
export function purgeFunctionalStorage() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(RESUME_KEY_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    return doomed.length;
  } catch {
    return 0;
  }
}

/**
 * The actual valve. Blocks the WRITE of a functional key at the storage boundary
 * whenever functional consent is absent.
 *
 * Why a write-guard and not just the purge below: the player SDK saves resume
 * positions with a bare `localStorage.setItem('3speak_pos_…')` that is NOT gated by
 * any of its own options — only its RESTORE is. So purging alone means "Essential
 * only" merely deletes positions on reload while the SDK keeps writing fresh ones as
 * you watch: a periodic mop, not an off-switch. This intercepts the write itself, so
 * the position is never stored in the first place — which also means there is
 * nothing for the SDK to restore, so the feature is genuinely inactive.
 *
 * It reads consent live on every call, so switching to Accept lifts the block
 * immediately with no reload. Before the user has answered the banner, functional
 * consent is false by default, so nothing non-essential is stored pre-consent —
 * which is exactly what prior-consent (ePrivacy) requires.
 *
 * Patches Storage.prototype so it also covers sessionStorage; harmless, since the
 * guarded prefix is only ever used in localStorage. Only our prefix is touched —
 * every other key passes straight through untouched.
 */
let storageGuardInstalled = false;
export function installStorageGuard() {
  if (storageGuardInstalled) return;
  try {
    const proto = typeof window !== 'undefined' && window.Storage && window.Storage.prototype;
    if (!proto || proto.__consentGuarded) { storageGuardInstalled = true; return; }
    const originalSetItem = proto.setItem;
    proto.setItem = function guardedSetItem(key, value) {
      if (typeof key === 'string' && key.startsWith(RESUME_KEY_PREFIX) && !hasConsent('functional')) {
        return undefined; // functional storage not consented → silently drop the write
      }
      return originalSetItem.call(this, key, value);
    };
    proto.__consentGuarded = true;
    storageGuardInstalled = true;
  } catch {
    // Sealed prototype / ancient browser — enforceConsentOnStart()'s purge is the
    // fallback (weaker, but better than nothing).
    storageGuardInstalled = true;
  }
}

/**
 * Call once on app start, BEFORE the player can run. Installs the write-guard and
 * clears anything a previous session (or a pre-guard build) may have left behind.
 */
export function enforceConsentOnStart() {
  installStorageGuard();
  if (hasDecided() && !hasConsent('functional')) purgeFunctionalStorage();
}
