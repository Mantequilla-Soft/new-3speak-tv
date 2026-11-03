import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { rememberAdSeenFor } from '../lib/adBreak';
import { requestAudioAd, reportAudioAdHeard } from '../lib/audioAd';

/**
 * Spoken ticker spots in the global audio player (lib/audioAd.js).
 *
 * When the track reaches the booked position (0% = before it starts) the track is
 * paused, the spot plays on its own element, and the track resumes where it was.
 *
 * The track's opening is HELD (paused at the start) while the checker's answer is
 * still out, at most HOLD_MAX_MS, so a pre-roll really comes first instead of cutting
 * in after a moment of the track. A later spot, or no spot, releases it at once. A
 * pre-roll that only arrives after the hold rewinds the track to the start.
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
// The longest the track's opening waits for the checker's answer. Fails open after.
const HOLD_MAX_MS = 2500;
// A pre-roll that starts later than this into the track does not rewind it.
const REWIND_WITHIN_S = 3;

// Outside episodes carry spots too. One whose link names a 3Speak post
// (lib/podcasts.js threeSpeakPost, the same check that gives it votes and comments)
// is that creator's audio: the checker turns the post into their track, so the spot
// pays them like on the track itself. Any other episode has no creator behind it:
// it is asked for by episode, and the creator's share goes to the platform.
const itemOf = (track) => {
  if (!track || track.live) return null;
  if (track.external) {
    if (track.owner && track.post_permlink) return `${track.owner}/post:${track.post_permlink}`;
    return track._id && !track.private ? `episode:${track._id}` : null;
  }
  return track.owner && track.permlink ? `${track.owner}/${track.permlink}` : null;
};

// What the checker is asked with, for the item above.
const requestOf = (track) => {
  if (!track.external) return { owner: track.owner, permlink: track.permlink };
  if (track.owner && track.post_permlink) return { owner: track.owner, postPermlink: track.post_permlink };
  return { episodeId: String(track._id) };
};

export default function useAudioAd(audioRef, track, elementKey) {
  const key = itemOf(track);
  const [spot, setSpot] = useState(null);
  // 'idle' | 'playing' | 'paused'
  const [phase, setPhase] = useState('idle');
  // The spot played to its end: its link stays offered for the rest of the track.
  const [heard, setHeard] = useState(false);
  const s = useRef({ key: null, spot: null, done: false, active: false, el: null, resumeAt: 0, lastProgressAt: 0, pending: false, held: false });

  // A new track: ask, and get the sound ready (fetching it records nothing).
  useEffect(() => {
    const cur = { key, spot: null, done: false, active: false, el: null, resumeAt: 0, lastProgressAt: 0, pending: !!key, held: false };
    s.current = cur;
    setSpot(null);
    setPhase('idle');
    setHeard(false);
    if (!key) return undefined;
    const ref = requestOf(track);

    // Hold the opening while the answer is out (see the top).
    const main = audioRef.current;
    const hold = () => {
      if (!cur.pending || !main || main.currentTime >= REWIND_WITHIN_S) return;
      cur.held = true;
      main.pause();
    };
    const resumeHeld = () => {
      if (cur.held && !cur.active && !cur.done && main) { cur.held = false; main.play().catch(() => {}); }
    };
    let timer = null;
    const release = () => {
      if (!cur.pending) return;
      cur.pending = false;
      clearTimeout(timer);
      if (main) { main.removeEventListener('play', hold); main.removeEventListener('playing', hold); }
    };
    if (main) {
      main.addEventListener('play', hold);
      main.addEventListener('playing', hold);
      if (!main.paused) hold();
    }
    timer = setTimeout(() => { release(); resumeHeld(); }, HOLD_MAX_MS);

    requestAudioAd({ ...ref, viewer: useAppStore.getState().user || null }).then((a) => {
      if (s.current !== cur) return;
      release();
      // No spot: the held track goes on. A spot: the binding below decides.
      if (!a) { resumeHeld(); return; }
      const el = new Audio();
      el.preload = 'auto';
      el.src = a.audioUrl;
      cur.el = el;
      cur.spot = a;
      setSpot(a);
    });
    return () => {
      release();
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
    // The track may already be playing when the answer comes in, or be held for it:
    // a spot that is due now starts, otherwise a held track goes on.
    if ((!main.paused || cur.held) && !cur.active) {
      const at = due();
      if (at != null) { cur.held = false; begin(at); }
      else if (cur.held) { cur.held = false; main.play().catch(() => {}); }
    }
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
