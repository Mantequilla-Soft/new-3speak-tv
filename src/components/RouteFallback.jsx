import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { endResume, isResuming } from '../lib/lastPage';
import { Icon } from './v2/Icon';

// How many route fallbacks are up right now (StrictMode mounts them twice).
let showing = 0;
export const fallbackShowing = () => showing > 0;

/**
 * What the router shows while a lazy route arrives: an empty block that holds the
 * page height (App.css), so the shell holds still. When the app was just sent on
 * to the page it was last on (lib/lastPage resumeOnStart), a spinner over a
 * see-through veil says it is on its way (owner 2026-11-16).
 */
export default function RouteFallback() {
  const { t } = useTranslation();
  const resuming = isResuming();
  useLayoutEffect(() => {
    showing += 1;
    return () => {
      showing -= 1;
      // Deferred: StrictMode takes it down and puts it straight back up.
      setTimeout(() => { if (!showing) endResume(); }, 50);
    };
  }, []);
  return (
    <div className="route-suspense-fallback">
      {resuming && (
        <div className="route-resume-veil" role="status" aria-label={t('common.status.loading')}>
          <span className="route-resume-spinner"><Icon name="progress_activity" size={32} className="v2-spin" /></span>
        </div>
      )}
    </div>
  );
}
