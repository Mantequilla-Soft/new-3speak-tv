import { useEffect, useRef } from 'react';
import { CHECKER_URL } from '../utils/config';
import { useAppStore } from '../lib/store';
import { listenerRewardsName } from '../utils/viewerRewards';
import { listenVouch } from '../lib/podcasts';

/**
 * Listening time for whatever the global audio player plays: 3Speak audio and
 * outside podcast episodes alike, measured by the checker the way video watch
 * time is (3speakchecks routes/audioListen.js).
 *
 *   POST /audio/listen/start → a session for this track, with a token and a beat interval
 *   POST /audio/listen/beat  → while it really plays (throttled), and once more on
 *     pause, end, seeking, track change, tab hide and page close. The server times
 *     the beats itself and only counts forward playback, so this cannot claim
 *     listening that did not happen.
 *
 * Anonymous, except for someone who agreed to listener rewards: then the session
 * carries their name and our API's proof of it (listenVouch), and the checker
 * records qualifying listens in its separate listener ledger. Unlike video, a
 * hidden tab keeps beating, because audio is made to run in the background.
 */
const itemOf = (track) => {
  if (!track) return null;
  if (track.external) return track._id ? { kind: 'podcast', id: String(track._id) } : null;
  return track.permlink ? { kind: 'audio', id: String(track.permlink) } : null;
};

export default function useListenTime(audioRef, track) {
  const item = itemOf(track);
  const key = item ? `${item.kind}:${item.id}` : null;
  const s = useRef({ sid: null, token: null, beatMs: 10000, lastBeatAt: 0, starting: false, lastTime: 0 });

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !key) return undefined;
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    s.current = { sid: null, token: null, beatMs: 10000, lastBeatAt: 0, starting: false, lastTime: el.currentTime || 0 };

    const beat = (position = el.currentTime) => {
      const cur = s.current;
      if (!cur.sid) return;
      cur.lastBeatAt = Date.now();
      try {
        fetch(`${CHECKER_URL}/audio/listen/beat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sid: cur.sid, token: cur.token, position, rate: el.playbackRate || 1,
            hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
          }),
          // Survives the page closing, unlike a plain request.
          keepalive: true,
        }).catch(() => {});
      } catch { /* best effort: never disturb playback */ }
    };

    const start = async () => {
      const cur = s.current;
      if (cur.sid || cur.starting) return;
      cur.starting = true;
      try {
        // Named only for someone who agreed to listener rewards, with our API's
        // proof of who they are; everyone else listens anonymously.
        let who = {};
        const name = await listenerRewardsName().catch(() => null);
        if (name) {
          const v = await listenVouch(name).catch(() => null);
          if (v) who = { listener: name, listenerSig: v.signature, listenerTs: v.timestamp };
        }
        const res = await fetch(`${CHECKER_URL}/audio/listen/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind, id,
            duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (track?.duration || undefined),
            position: el.currentTime || 0,
            source: '3speak',
            private: !!useAppStore.getState().privateMode,
            ...who,
          }),
        });
        const data = res.ok ? await res.json() : null;
        // The track may have changed while we waited: that session is not ours.
        if (s.current !== cur || !data?.sid) return;
        cur.sid = data.sid;
        cur.token = data.token;
        cur.beatMs = Math.max(2000, (Number(data.beatSeconds) || 10) * 1000);
        cur.lastBeatAt = Date.now();
      } catch { /* listening without measuring is fine */ } finally {
        cur.starting = false;
      }
    };

    const onPlay = () => { start(); };
    const onTime = () => {
      const cur = s.current;
      // Read before a seek moves it: 'seeking' fires with the NEW time already set.
      cur.lastTime = el.currentTime;
      if (cur.sid && Date.now() - cur.lastBeatAt >= cur.beatMs && !el.paused) beat();
    };
    // Credit the stretch played up to the jump, then the next beats start from the new spot.
    const onSeeking = () => beat(s.current.lastTime);
    const onPause = () => beat();
    const onEnded = () => beat(Number.isFinite(el.duration) ? el.duration : el.currentTime);
    const onHide = () => { if (document.visibilityState === 'hidden' && !el.paused) beat(); };
    const onPageHide = () => { if (!el.paused) beat(); };

    el.addEventListener('play', onPlay);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeking', onSeeking);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    // A track that is already playing when this runs (resumed from a previous page).
    if (!el.paused) start();
    return () => {
      // Track change or player gone: the last stretch still counts.
      beat(s.current.lastTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeking', onSeeking);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export const _test = { itemOf };
