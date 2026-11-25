import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { usePremiumStatus } from './usePremiumStatus';
import { atParam, isPublishBlocked, loadPublishQuota, refreshPublishQuota, subscribePublishQuota } from '../lib/publishQuota';

// setTimeout takes at most 2^31 - 1 ms (24.8 days); a later free time is
// looked at again when the page next reads it.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * ⏳ The free plan's daily PUBLISH limit (lib/publishQuota.js) for the
 * logged-in Hive account: may a `kind` go out at `at` (default now)? `exclude`
 * leaves out the scheduled post being rescheduled. Never asked for 3Speak Pro,
 * while Pro is still loading, for a warm-up account (no Hive account, no
 * schedule; its upload cap stays on the upload server) or with `enabled` off.
 *
 * `quota` is null when no limit is known (the checker's route is off, not
 * deployed, or failed): callers show nothing and block nothing then. Only the
 * answer for the very `kind` / `at` / `exclude` asked for is ever returned, so
 * an older answer never blocks a newly picked time. `debounceMs` waits for a
 * time being picked to settle before asking. A "publish now" that is blocked
 * is asked again by itself once its next free time has come.
 *
 * @returns {{ ready: boolean, checking: boolean, quota: object|null, blocked: boolean, refresh: () => void }}
 */
export function usePublishQuota({ kind = 'video', at = null, exclude = '', enabled = true, debounceMs = 0 } = {}) {
  const user = useAppStore((s) => s.user);
  const premium = usePremiumStatus(user);
  const pro = !!premium?.premium;
  const waiting = enabled && !!user && premium === null;
  const skip = !enabled || !user || pro;
  const atIso = atParam(at);
  const key = [user || '', kind, atIso || 'now', exclude || ''].join('|');

  // The key actually asked for: lags `key` by `debounceMs` while a time is picked.
  const [debounced, setDebounced] = useState(key);
  const settled = debounceMs ? debounced : key;
  const [answer, setAnswer] = useState({ key: null, value: null });
  const [tick, setTick] = useState(0);

  useEffect(() => subscribePublishQuota(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    if (!debounceMs) return undefined;
    const timer = setTimeout(() => setDebounced(key), debounceMs);
    return () => clearTimeout(timer);
  }, [key, debounceMs]);

  const live = settled === key && !skip && !waiting;
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    loadPublishQuota(user, { kind, at: atIso || null, exclude, fresh: tick > 0 })
      .then((value) => { if (alive) setAnswer({ key, value }); })
      .catch(() => { if (alive) setAnswer({ key, value: null }); });
    return () => { alive = false; };
  }, [live, user, kind, atIso, exclude, key, tick]);

  const quota = !skip && answer.key === key ? answer.value : null;
  const blocked = isPublishBlocked(quota);

  // "Publish now" held back: ask again once the next free time has come.
  const nextFreeAt = blocked && !atIso ? quota.nextFreeAt : null;
  useEffect(() => {
    if (!Number.isFinite(nextFreeAt)) return undefined;
    const delay = Math.min(MAX_TIMER_MS, Math.max(1000, nextFreeAt - Date.now() + 1000));
    const timer = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [nextFreeAt]);

  const refresh = useCallback(() => refreshPublishQuota(), []);
  const ready = skip || (!waiting && answer.key === key);
  return { ready, checking: !ready, quota, blocked, refresh };
}

export default usePublishQuota;
