import { useEffect } from 'react';

/**
 * The day's channel point for signing in (hangouts POST /points/daily, once per
 * UTC day per account). Once per day and account from this browser: a silent
 * hangouts session (the @threespeak signature, never a wallet popup), then the
 * claim. Nothing happens without a session; the server pays at most once a day
 * anyway, so a second tab or device costs nothing.
 */

const KEY = 'points-daily:';
const DELAY_MS = 5000;

const today = () => new Date().toISOString().slice(0, 10);

function claimedToday(user) {
  try { return localStorage.getItem(KEY + user) === today(); } catch { return false; }
}

function markClaimed(user) {
  try { localStorage.setItem(KEY + user, today()); } catch { /* private mode: try again next load */ }
}

/** `getToken(user)` resolves a hangouts session token or null. */
export default function useDailyPoints({ apiUrl, user, authenticated, getToken }) {
  useEffect(() => {
    if (!apiUrl || !authenticated || !user || claimedToday(user)) return undefined;
    let gone = false;
    // After the page settled: not on the first paint's critical path.
    const t = setTimeout(async () => {
      try {
        const token = await getToken(user);
        if (gone || !token) return;
        const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/points/daily`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        // A server without the route (404) is done for today too.
        if (res.ok || res.status === 404) markClaimed(user);
      } catch { /* offline or no session: the next load tries again */ }
    }, DELAY_MS);
    return () => { gone = true; clearTimeout(t); };
  }, [apiUrl, user, authenticated, getToken]);
}
