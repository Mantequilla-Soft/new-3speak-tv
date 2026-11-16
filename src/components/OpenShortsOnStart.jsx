import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { readLastPage } from '../lib/lastPage';

/**
 * "Open shorts on start" — when enabled, launching 3Speak drops the user straight
 * into /shorts instead of the home feed.
 *
 * Fires only ONCE per page load, and only when the app was actually opened on the
 * home route. Without that guard it would hijack every later navigation back to
 * "/" (tapping the logo, the Home tab, a back button) and you could never reach the
 * home feed again.
 *
 * We PUSH rather than replace, so "/" stays on the history stack and Back from the
 * shorts view lands on the home feed. That's safe precisely because of the one-shot
 * `done` ref above: this component is mounted once at the app root and never
 * unmounts on navigation, so returning to "/" cannot re-trigger the redirect. (A
 * `replace` would drop "/" entirely and Back would leave the app.)
 *
 * Note this only affects the app-open case. If the user reaches /shorts by normal
 * navigation, Back just follows real history as usual — nothing special here.
 *
 * The preference itself is persisted by the zustand store (localStorage), so it
 * survives a reload. Off by default.
 */
export default function OpenShortsOnStart() {
  const navigate = useNavigate();
  const location = useLocation();
  const openShortsOnStart = useAppStore((s) => s.openShortsOnStart);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true; // one shot per page load, whatever we decide below

    if (!openShortsOnStart) return;
    // Only when the app was OPENED on "/" — never hijack a later nav home.
    if (location.pathname !== '/') return;
    // Don't clobber a deep link that happens to carry params.
    if (location.search) return;
    // "Continue where I left off" has a page to go back to: ResumeLastPage goes there.
    if (useAppStore.getState().resumeLastPage && readLastPage()) return;

    // Push (not replace): keeps "/" behind us so Back returns to the home feed.
    navigate('/shorts');
    // Intentionally no deps: this must evaluate against the FIRST render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
