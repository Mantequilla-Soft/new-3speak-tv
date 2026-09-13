import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import {
  fetchIncubationProgress, progressHue, progressFraction, onIncubationProgress,
} from '../../lib/incubation';
import './NavProgress.scss';

// One read a minute. The goals are each several minutes of real work, so a
// minute is quick enough that the bar moves while the user is still on the page
// that moved it, and slow enough to stay a rounding error against everything
// else the nav loads. Route changes no longer drive this: navigation is a poor
// proxy for progress -- someone can browse for ten minutes without finishing a
// task, or finish one and stay put.
const POLL_MS = 60 * 1000;

// How long the finish celebration is left mounted. Must outlast the longest
// keyframe below (the ring, which runs twice after a 0.3s beat).
const CELEBRATE_MS = 2400;

// Six sparks read as a burst without turning the nav into a firework. They are
// rendered only while celebrating, so a finished bar costs nothing to keep on
// screen afterwards.
const SPARKS = [0, 1, 2, 3, 4, 5];

// Finishing is news exactly once. Remembered per handle so a reload -- or the
// next session, where the first poll also comes back complete -- does not
// replay a celebration the user has already had, and so a second handle on the
// same browser still gets its own.
const seenKey = (handle) => `incubation_progress_done:${handle}`;

// Deliberately pessimistic: a browser that will not let us remember the burst
// has been played would otherwise replay it on every single poll, which is far
// worse than never showing it.
function alreadyCelebrated(handle) {
  try { return localStorage.getItem(seenKey(handle)) === '1'; } catch { return true; }
}

function markCelebrated(handle) {
  try { localStorage.setItem(seenKey(handle), '1'); } catch { /* ignore */ }
}

/**
 * Reaching 100% is the tasks themselves all being done.
 *
 * Not `progress.complete`, which is the service's own flag and can mean more
 * than the bar is showing (it also gates the review step). The celebration
 * belongs to the thing the user is watching move.
 */
function isFull(p) {
  const tasks = p?.tasks;
  return Array.isArray(tasks) && tasks.length > 0 && tasks.every((t) => t.done);
}

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
  const [celebrating, setCelebrating] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!incubationHandle) return;
    try {
      const p = await fetchIncubationProgress();
      if (!alive.current || !Array.isArray(p?.tasks)) return;
      setProgress(p);
      if (isFull(p) && !alreadyCelebrated(incubationHandle)) {
        markCelebrated(incubationHandle);
        setCelebrating(true);
      }
    } catch {
      // Transient (offline, 5xx): keep the last answer rather than blanking the
      // bar. The nav must not depend on this endpoint.
    }
  }, [incubationHandle]);

  const complete = isFull(progress);

  useEffect(() => {
    if (!incubationHandle) return undefined;
    alive.current = true;
    refresh();
    // Nothing left to watch once every task is done -- the number cannot move
    // again -- so the finished bar stops asking.
    const id = complete ? null : setInterval(refresh, POLL_MS);
    // A tab left open for an hour is the common case, and the answer only
    // changes when the user does something. Read again on the way back in so
    // returning to the tab never shows a minute-old number.
    const onWake = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    // The one that actually matters. Polling is the safety net for things this
    // app never sees (watch time is written by the player), but a user who has
    // just posted their tenth comment is looking at the pill RIGHT NOW, and a
    // minute of staleness reads as a bar that does not work.
    const offAction = onIncubationProgress(refresh);
    return () => {
      alive.current = false;
      if (id) clearInterval(id);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      offAction();
    };
  }, [incubationHandle, refresh, complete]);

  // Take the celebration back off once it has played: it is a moment, not a
  // state, and an animation left running is one the browser keeps compositing.
  useEffect(() => {
    if (!celebrating) return undefined;
    const id = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
    return () => clearTimeout(id);
  }, [celebrating]);

  if (!incubationHandle || !progress) return null;

  const done = progress.tasks.filter((t) => t.done).length;
  const total = progress.tasks.length;
  // Same scale as the profile panel: each goal is worth an equal share and
  // partial progress inside one counts, so the pill creeps forward as they go
  // rather than jumping a fifth at a time.
  const filled = progressFraction(progress.tasks);
  const pct = filled * 100;
  // Floored, and capped below 100 until every goal is actually done. Rounding
  // 99.6% up to "100%" while a goal is still open is the same lie the bar used
  // to tell when it looked full at 92.7%, and a number is read more literally
  // than a bar is.
  const pctLabel = complete ? 100 : Math.min(99, Math.floor(pct));

  return (
    <Link
      to="/profile"
      className={`nav-progress${complete ? ' is-complete' : ''}${celebrating ? ' is-celebrating' : ''}`}
      // "fully done" rather than "done": the count and the percentage disagree
      // on purpose (1 of 5 goals, but 54% of the way) because part-finished
      // goals count towards the bar. Saying which is which stops that reading
      // as a bug.
      title={progress.complete
        ? `All ${total} goals done (100%). The team will review your channel.`
        : `${pctLabel}% towards your Hive account. ${done} of ${total} goals fully done.`}
      aria-label={complete
        ? `Your progress: 100%, all ${total} goals done`
        : `Your progress: ${pctLabel}%, ${done} of ${total} goals fully done`}
    >
      <span className="nav-progress-bar" aria-hidden="true">
        <span
          className="nav-progress-fill"
          style={{ width: `${pct}%`, '--bar-hue': progressHue(filled) }}
        />
      </span>
      <span className="nav-progress-count">{done}/{total}</span>
      {celebrating && (
        <span className="nav-progress-sparks" aria-hidden="true">
          {SPARKS.map((i) => <span key={i} className="nav-progress-spark" />)}
        </span>
      )}
      {/* The burst is the only thing that marks the moment, and it is purely
          visual -- so say it out loud too, once, for anyone who cannot see it.
          The region is always mounted and only its text changes: a live region
          that appears at the same instant as its content is not reliably
          announced. */}
      <span className="nav-progress-sr" role="status">
        {celebrating ? 'All goals done towards your Hive account.' : ''}
      </span>
    </Link>
  );
}
