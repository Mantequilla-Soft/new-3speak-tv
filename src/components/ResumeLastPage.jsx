import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { clearLastPage, endResume, saveLastPage } from '../lib/lastPage';
import { fallbackShowing } from './RouteFallback';

/**
 * "Continue where I left off" (owner 2026-11-16): while it is on, every page the
 * user opens is remembered (lib/lastPage.js). Going back to it happens before
 * React starts (resumeOnStart in main.jsx), so Home never flashes first. (It
 * replaced "Open Shorts on start", owner 2026-11-16.)
 *
 * Turning the setting off forgets the saved page. On by default for someone who
 * never used 3Speak before (lib/store.js); everyone else is asked once
 * (components/StartPrompt).
 */
export default function ResumeLastPage() {
  const location = useLocation();
  const enabled = useAppStore((s) => s.resumeLastPage);

  // The resumed page rendered without waiting for a route chunk: no spinner to
  // take down, so the next page that loads must not get one either.
  useEffect(() => { if (!fallbackShowing()) endResume(); }, []);

  useEffect(() => {
    if (!enabled) { clearLastPage(); return; }
    saveLastPage(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, location.pathname, location.search, location.hash]);

  return null;
}
