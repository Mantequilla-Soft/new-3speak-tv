import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { clearLastPage, readLastPage, saveLastPage } from '../lib/lastPage';

/**
 * "Continue where I left off" (owner 2026-11-16): while it is on, every page the
 * user opens is remembered (lib/lastPage.js), and opening 3Speak on Home goes
 * back to that page.
 *
 * The same rules as OpenShortsOnStart: once per page load, only when the app was
 * opened on "/" with no query (a shared link always wins), and a PUSH so Back
 * returns to the home feed. When a page is resumed, OpenShortsOnStart stands back.
 *
 * Turning the setting off forgets the saved page. Off by default.
 */
export default function ResumeLastPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const enabled = useAppStore((s) => s.resumeLastPage);
  const started = useRef(false);

  useEffect(() => {
    if (!enabled) {
      started.current = true;
      clearLastPage();
      return;
    }
    if (!started.current) {
      started.current = true;
      const target = location.pathname === '/' && !location.search ? readLastPage() : null;
      // The saved page is recorded again once the router lands on it.
      if (target) { navigate(target); return; }
    }
    saveLastPage(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, location.pathname, location.search, location.hash]);

  return null;
}
