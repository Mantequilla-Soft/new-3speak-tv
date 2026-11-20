import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { usePremiumStatus } from './usePremiumStatus';
import { loadUploadQuotas, refreshUploadQuota, subscribeUploadQuota } from '../lib/uploadQuota';

const NONE = { video: null, audio: null };

/**
 * The free plan's daily upload counters for the logged-in Hive account
 * (lib/uploadQuota.js). Never fetched for 3Speak Pro or a warm-up account
 * (incubation handle, no Hive account yet): they have no limits. A server that
 * says `exempt` is trusted the same way.
 *
 * Every counter is null when no limit is known (the backend's flag is off, the
 * route is not deployed yet, the request failed): callers show nothing and block
 * nothing then. Otherwise { limit, used, remaining, nextAt } (+ maxSeconds for audio).
 *
 * @param {{ video?: boolean, audio?: boolean }} kinds which quotas to read
 * @returns {{ ready: boolean, exempt: boolean, video: object|null, short: object|null, audio: object|null, refresh: () => void }}
 */
export function useUploadQuota({ video = true, audio = true } = {}) {
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const premium = usePremiumStatus(user);
  const warmup = !user && !!incubationHandle;
  const pro = !!premium?.premium;
  // Pro is only known once its lookup is back; until then nothing is fetched
  // (a Pro account must never see a free-plan note flash up).
  const waiting = !!user && premium === null;
  const skip = !user || warmup || pro;

  const [quotas, setQuotas] = useState(NONE);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeUploadQuota(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    if (skip || waiting) {
      setQuotas(NONE);
      setLoaded(!waiting);
      return undefined;
    }
    let alive = true;
    loadUploadQuotas(user, { video, audio })
      .then((q) => { if (alive) { setQuotas(q); setLoaded(true); } })
      .catch(() => { if (alive) { setQuotas(NONE); setLoaded(true); } });
    return () => { alive = false; };
  }, [user, skip, waiting, video, audio, tick]);

  const refresh = useCallback(() => refreshUploadQuota(), []);

  const v = skip ? null : quotas.video;
  const a = skip ? null : quotas.audio;
  return {
    ready: loaded && !waiting,
    exempt: pro || warmup || !!v?.exempt || !!a?.exempt,
    video: v && !v.exempt ? v.video || null : null,
    short: v && !v.exempt ? v.short || null : null,
    audio: a && !a.exempt ? a.audio || null : null,
    refresh,
  };
}

export default useUploadQuota;
