import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { usePremiumStatus } from './usePremiumStatus';
import { loadUploadQuotas, refreshUploadQuota, subscribeUploadQuota } from '../lib/uploadQuota';

const NONE = { video: null, audio: null };

/**
 * The daily upload counters for the logged-in account (lib/uploadQuota.js):
 * the free plan's for a Hive account, the warm-up's (3 videos + 3 Shorts, no
 * audio limit) for a warm-up account (incubation handle, no Hive account yet).
 * Never fetched for 3Speak Pro. A server that says `exempt` is trusted the same
 * way.
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
  // A warm-up uploads under its handle, so its counters are kept for that name.
  const owner = user || (warmup ? incubationHandle : null);
  const pro = !!premium?.premium;
  // Pro is only known once its lookup is back; until then nothing is fetched
  // (a Pro account must never see a free-plan note flash up).
  const waiting = !!user && premium === null;
  const skip = !owner || pro;
  // Warm-up accounts have no audio limit.
  const wantAudio = audio && !warmup;

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
    loadUploadQuotas(owner, { video, audio: wantAudio })
      .then((q) => { if (alive) { setQuotas(q); setLoaded(true); } })
      .catch(() => { if (alive) { setQuotas(NONE); setLoaded(true); } });
    return () => { alive = false; };
  }, [owner, skip, waiting, video, wantAudio, tick]);

  const refresh = useCallback(() => refreshUploadQuota(), []);

  const rawV = skip ? null : quotas.video;
  // A warm-up trusts only a warm-up answer: a server that could not tell says
  // the free plan (1 video), yet lets the upload through, so that number must
  // not block anything here.
  const v = warmup && rawV && !rawV.exempt && rawV.plan !== 'warmup' ? null : rawV;
  const a = skip || warmup ? null : quotas.audio;
  return {
    ready: loaded && !waiting,
    exempt: pro || !!v?.exempt || !!a?.exempt,
    video: v && !v.exempt ? v.video || null : null,
    short: v && !v.exempt ? v.short || null : null,
    audio: a && !a.exempt ? a.audio || null : null,
    refresh,
  };
}

export default useUploadQuota;
