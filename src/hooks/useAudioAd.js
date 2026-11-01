import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { rememberAdSeenFor } from '../lib/adBreak';
import { requestAudioAd, reportAudioAdHeard } from '../lib/audioAd';

/**
 * Spoken ticker spots in the global audio player (lib/audioAd.js).
 *
 * When the track reaches the booked position (0% = before it starts) the track is
 * paused, the spot plays on its own element, and the track resumes where it was.
 * A pre-roll that only arrived after the first moments played rewinds the track to
 * the start, so nothing of it is missed.
 *
 * While the spot runs, the player's own controls drive the spot: any play on the
 * track's element (button, headphones, lock screen, pop-out window) is turned into
 * play/pause of the spot instead. Listening time does not count the spot, since the
 * track's element is paused for it.
 *
 * Fails open everywhere: a spot that cannot play (blocked, broken, stalled) is
 * dropped and the track goes on. One spot per track per play.
 */
const STALL_MS = 8000;
// A pre-roll that starts later than this into the track does not rewind it.
const REWIND_WITHIN_S = 3;

const itemOf = (track) => (
  track && !track.external && !track.live && track.owner && track.permlink
    ? `${track.owner}/${track.permlink}` : null
);

export default function useAudioAd(audioRef, track, elementKey) {
  const key = itemOf(track);
  const [spot, setSpot] = useState(null);
  // 'idle' | 'playing' | 'paused'
  const [phase, setPhase] = useState('idle');
  // The spot played to its end: its link stays offered for the rest of the track.
  const [heard, setHeard] = useState(false);
  const s = useRef({ key: null, spot: null, done: false, active: false, el: null, resumeAt: 0, lastProgressAt: 0 });

  // A new track: ask, and get the sound ready (fetching it records nothing).
  useEffect(() => {
    const cur = { key, spot: null, done: false, active: false, el: null, resumeAt: 0, lastProgressAt: 0 };
    s.current = cur;
    setSpot(null);
    setPhase('idle');
    setHeard(false);
    if (!key) return undefined;
    const [owner, permlink] = [track.owner, track.permlink];
    requestAudioAd({ owner, permlink, viewer: useAppStore.getState().user || null }).then((a) => {
      if (s.current !== cur || !a) return;
      const el = new Audio();
      el.preload = 'auto';
      el.src = a.audioUrl;
      cur.el = el;
      cur.spot = a;
      setSpot(a);
    });
    return () => {
      cur.done = true;
      cur.active = false;
      if (cur.el) { try { cur.el.pause(); cur.el.removeAttribute('src'); cur.el.load(); } catch { /* gone */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Bound to the track's element (and again after the player swaps it).
  useEffect(() => {
    const main = audioRef.current;
    const cur = s.current;
    const ad = cur.el;
    if (!main || !spot || !ad || cur.done) return undefined;
    const setPlaying = (v) => useAppStore.getState().audioSetIsPlaying(v);

    const finish = (heard) => {
      if (!cur.active) return;
      // Resume unless the listener had paused the spot. A spot only ever begins on a
      // playing track, so one that never got going (refused, broken) resumes it.
      const wasPlaying = heard || !cur.started || !ad.paused;
      cur.active = false;
      cur.done = true;
      try { ad.pause(); } catch { /* gone */ }
      setPhase('idle');
      if (heard) { setHeard(true); reportAudioAdHeard(spot.shownUrl); }
      if (main.currentTime > cur.resumeAt && main.currentTime - cur.resumeAt < REWIND_WITHIN_S) main.currentTime = cur.resumeAt;
      if (wasPlaying) main.play().catch(() => {});
    };

    const begin = (at) => {
      cur.active = true;
      cur.started = false;
      cur.resumeAt = at;
      cur.lastProgressAt = Date.now();
      main.pause();
      ad.volume = main.volume;
      ad.muted = main.muted;
      try { ad.currentTime = 0; } catch { /* not loaded yet */ }
      ad.play().then(() => {
        // Remembered once it is actually playing, for its own (short) cap window.
        if (spot.adKey) rememberAdSeenFor(spot.capMinutes, spot.adKey);
      }).catch(() => finish(false));
    };

    const due = () => {
      if (cur.active || cur.done) return null;
      const pct = spot.positionPercent;
      if (pct <= 0) return 0;
      const d = useAppStore.getState().audioDuration || main.duration;
      if (!(Number.isFinite(d) && d > 0)) return null;
      const at = (pct / 100) * d;
      return main.currentTime >= at ? at : null;
    };

    const onMainPlay = () => {
      // During the spot a play on the track means play/pause of the spot.
      if (cur.active) {
        main.pause();
        if (ad.paused) ad.play().catch(() => finish(false)); else ad.pause();
        return;
      }
      const at = due();
      if (at != null) begin(at);
    };
    const onMainTime = () => {
      if (cur.active) { if (!main.paused) main.pause(); return; }
      if (main.paused) return;
      const at = due();
      if (at != null) begin(at);
    };
    const onMainVolume = () => { ad.volume = main.volume; ad.muted = main.muted; };

    const onAdPlay = () => { if (cur.active) { cur.started = true; setPhase('playing'); setPlaying(true); } };
    const onAdPause = () => { if (cur.active && !ad.ended) { setPhase('paused'); setPlaying(false); } };
    const onAdTime = () => { cur.lastProgressAt = Date.now(); };
    const onAdEnded = () => finish(true);
    const onAdError = () => finish(false);

    // A spot that stops making progress while it should be playing is dropped.
    const watchdog = setInterval(() => {
      if (cur.active && !ad.paused && Date.now() - cur.lastProgressAt > STALL_MS) finish(false);
    }, 1000);

    main.addEventListener('play', onMainPlay);
    main.addEventListener('timeupdate', onMainTime);
    main.addEventListener('volumechange', onMainVolume);
    ad.addEventListener('play', onAdPlay);
    ad.addEventListener('pause', onAdPause);
    ad.addEventListener('timeupdate', onAdTime);
    ad.addEventListener('ended', onAdEnded);
    ad.addEventListener('error', onAdError);
    // The track may already be playing when the answer comes in.
    if (!main.paused && !cur.active) { const at = due(); if (at != null) begin(at); }
    return () => {
      clearInterval(watchdog);
      main.removeEventListener('play', onMainPlay);
      main.removeEventListener('timeupdate', onMainTime);
      main.removeEventListener('volumechange', onMainVolume);
      ad.removeEventListener('play', onAdPlay);
      ad.removeEventListener('pause', onAdPause);
      ad.removeEventListener('timeupdate', onAdTime);
      ad.removeEventListener('ended', onAdEnded);
      ad.removeEventListener('error', onAdError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, elementKey]);

  /** Play/pause of the spot, for the player's own button. False when no spot runs. */
  const toggle = useCallback(() => {
    const cur = s.current;
    if (!cur.active || !cur.el) return false;
    if (cur.el.paused) cur.el.play().catch(() => {}); else cur.el.pause();
    return true;
  }, []);

  return {
    active: phase !== 'idle',
    playing: phase === 'playing',
    spot: phase !== 'idle' ? spot : null,
    // After the spot: what the "Find out more" card shows, until the track changes.
    heardSpot: heard && phase === 'idle' ? spot : null,
    toggle,
  };
}

export const _test = { itemOf };
