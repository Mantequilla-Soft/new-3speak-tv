/**
 * The name to attach to a watch session for ad-reward purposes, or null.
 *
 * 🚨 Returns null unless this viewer has actually opted in. Identity is not sent
 * for people who declined or were never asked, so the player service never receives
 * a name it has no permission to hold. The server re-checks the opt-in against the
 * database regardless — this is the first of two gates, not the only one.
 *
 * The opt-in is fetched once per session and cached in memory. It is deliberately
 * NOT read from localStorage: the consent record lives on the server, and a stale
 * local copy could keep sending a name after someone switched it off elsewhere.
 */
import { useAppStore } from '../lib/store';
import { fetchViewerAdPrefs } from '../lib/advertiseData';

let cached = { account: null, enabled: false };
let inFlight = null;

/** Refresh the cached opt-in for the logged-in account. Safe to call repeatedly. */
export function primeViewerRewards(account) {
  if (!account) { cached = { account: null, enabled: false }; return Promise.resolve(false); }
  if (cached.account === account) return Promise.resolve(cached.enabled);
  if (inFlight) return inFlight;
  inFlight = fetchViewerAdPrefs(account)
    .then((r) => {
      cached = { account, enabled: r?.rewardsEnabled === true };
      return cached.enabled;
    })
    .catch(() => {
      // Unreadable preference means we do NOT send a name. Failing closed here
      // costs someone a few seconds of credit; failing open would send identity
      // for a viewer who may have declined.
      cached = { account, enabled: false };
      return false;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * The name to send, or null.
 *
 * 🚨 ASYNC because a cold cache is not an answer. This used to return null whenever
 * it had not been primed for the account yet, priming in the background for "next
 * time". Nothing else in the app ever called `primeViewerRewards`, so the only thing
 * that warmed the cache was the call that had already given up: the FIRST video of
 * every page load was recorded anonymous and skipped the watch token entirely.
 * Opening a link, watching one video and leaving is the most common visit there is,
 * and not one of those was ever credited.
 */
export async function viewerRewardsName() {
  const user = useAppStore.getState().user;
  if (!user) return null;
  if (cached.account !== user) await primeViewerRewards(user);
  /* Re-read the account. It can change while the fetch is in flight (a logout, or a
   * switch between accounts, which shares the in-flight request above), and a cached
   * answer belonging to somebody else must never be sent. Mismatch fails closed. */
  const now = useAppStore.getState().user;
  if (!now || cached.account !== now) return null;
  return cached.enabled ? now : null;
}
