import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { fetchIncubationProgress } from '../../lib/incubation';
import './NavProgress.scss';

// Re-read at most this often. The bar has to move when someone finishes a task
// mid-session, but the goals are things that take minutes, so polling the
// endpoint on every route change would be a request per navigation for a number
// that has almost certainly not changed.
const MIN_REFRESH_MS = 30 * 1000;

/**
 * How close the signed-in user is to a real Hive account, in the top bar.
 *
 * Renders for INCUBATING users only, and nothing at all otherwise, so the bar
 * is unchanged for everyone with an account. It is a link rather than a widget:
 * the detail, and the thing you can act on, lives on the profile.
 */
export default function NavProgress() {
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [progress, setProgress] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const location = useLocation();

  useEffect(() => {
    // No clearing needed on the way out: the component renders nothing without
    // a handle, so stale progress is never shown.
    if (!incubationHandle) return undefined;
    if (Date.now() - fetchedAt < MIN_REFRESH_MS) return undefined;
    let alive = true;
    fetchIncubationProgress()
      .then((p) => {
        if (!alive) return;
        setProgress(p);
        setFetchedAt(Date.now());
      })
      .catch(() => { /* the nav must not depend on this */ });
    return () => { alive = false; };
    // location drives the refresh: finishing a task means navigating somewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incubationHandle, location.pathname]);

  if (!incubationHandle || !progress) return null;

  const done = progress.tasks.filter((t) => t.done).length;
  const total = progress.tasks.length;
  const pct = total ? (done / total) * 100 : 0;

  return (
    <Link
      to="/profile"
      className="nav-progress"
      title={progress.complete
        ? 'All goals done. The team will review your channel.'
        : `${done} of ${total} goals done towards your Hive account`}
      aria-label={`Your progress: ${done} of ${total} goals done`}
    >
      <span className="nav-progress-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="nav-progress-count">{done}/{total}</span>
    </Link>
  );
}
