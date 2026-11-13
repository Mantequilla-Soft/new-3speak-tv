import { useEffect, useState } from 'react';
import { fetchIncubationProgress, onIncubationProgress, progressFraction } from '../lib/incubation';

const POLL_MS = 60 * 1000;

/**
 * A warm-up account's goals (the incubation service's /progress), kept fresh:
 * read on mount, again whenever a write says a goal may have moved, and once a
 * minute. `enabled` false (a Hive account, signed out) reads nothing.
 * Shared by the bottom bar's ring, the account menu and Home's Warm-up tab;
 * the top bar's ring (NavProgress) keeps its own, with the celebration.
 */
export default function useWarmupProgress(enabled) {
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!enabled) { setProgress(null); return undefined; }
    let alive = true;
    const load = () => fetchIncubationProgress().then((p) => { if (alive) setProgress(p); }).catch(() => {});
    load();
    const off = onIncubationProgress(load);
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; off?.(); clearInterval(id); };
  }, [enabled]);
  return progress;
}

// The numbers every view shows: goals fully done, of how many, and the share
// of the way (partly done goals count for their part). The percentage is
// floored and held under 100 until every goal is done, as in NavProgress.
export function warmupFigures(progress) {
  const tasks = progress?.tasks || [];
  const total = tasks.length;
  const done = tasks.filter((task) => task.done).length;
  const fraction = progressFraction(tasks);
  const complete = total > 0 && done === total;
  return { done, total, fraction, complete, pct: complete ? 100 : Math.min(99, Math.floor(fraction * 100)) };
}
