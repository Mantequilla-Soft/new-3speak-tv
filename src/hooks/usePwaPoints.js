import { useEffect } from 'react';
import { isStandalone } from '../utils/pwaInstall';

/**
 * The once-ever points for using the installed app (hangouts POST /points/pwa).
 * This is the one award the app claims itself, so the server pays it once per
 * account at most. Only when the app runs installed (display-mode standalone,
 * or navigator.standalone on iOS) and someone is signed in: a silent hangouts
 * session (never a wallet popup), then the claim, once per account from this
 * browser. Without a session nothing happens; the next load tries again.
 */

const KEY = 'points-pwa:';
const DELAY_MS = 8000;
// A live server without the route (404): ask again after a few days.
const RETRY_MS = 3 * 24 * 3600 * 1000;

function shouldClaim(user, now) {
  try {
    const v = localStorage.getItem(KEY + user);
    if (v === 'done') return false;
    const later = /^later:(\d+)$/.exec(v || '');
    return !later || now - Number(later[1]) > RETRY_MS;
  } catch { return true; }
}

function remember(user, value) {
  try { localStorage.setItem(KEY + user, value); } catch { /* private mode: the server pays once anyway */ }
}

/** `getToken(user)` resolves a hangouts session token or null. */
export default function usePwaPoints({ apiUrl, user, authenticated, getToken, standalone = isStandalone }) {
  useEffect(() => {
    if (!apiUrl || !authenticated || !user || !standalone() || !shouldClaim(user, Date.now())) return undefined;
    let gone = false;
    // After the page settled, and after the day's sign-in claim.
    const t = setTimeout(async () => {
      try {
        const token = await getToken(user);
        if (gone || !token) return;
        const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/points/pwa`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        // Paid now, or paid before (409): done for good.
        if (res.ok || res.status === 409) remember(user, 'done');
        else if (res.status === 404) remember(user, `later:${Date.now()}`);
      } catch { /* offline or no session: the next load tries again */ }
    }, DELAY_MS);
    return () => { gone = true; clearTimeout(t); };
  }, [apiUrl, user, authenticated, getToken, standalone]);
}
