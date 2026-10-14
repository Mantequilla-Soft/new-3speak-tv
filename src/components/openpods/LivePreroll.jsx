import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Hls from 'hls.js';
import { useTranslation } from 'react-i18next';
import { MdVolumeUp } from 'react-icons/md';
import { CHECKER_URL } from '../../utils/config';
import { rememberAdSeen } from '../../lib/adBreak';
import AdOverlay from '../ads/AdOverlay';
import AdSkip from '../ads/AdSkip';
import './LivePreroll.scss';

// No progress for this long while the spot should be playing: give up and let the
// stream through. Shorter than the upload gate's, because somebody is waiting for a
// live moment they are missing.
const STALL_MS = 12000;
// How often (seconds of ad played) the page tells the checker how far it got.
const BEAT_S = 2;

/**
 * A live stream's pre-roll: one video spot, played over the player before the
 * stream is shown (LiveAdLayer decides when; the checker decides which spot, with
 * the watch page's rules, see routes/adServe.js surface 'live').
 *
 * Fails OPEN everywhere: a manifest that will not load, a refused autoplay, a stall
 * or a player error all end the spot and show the stream. Only seconds that really
 * played are reported (POST /m/:sid/w), credited by the checker against its own
 * clock; a skip is reported as such (POST /m/:sid/skipped), like the watch page.
 *
 * Sound: tried first with sound; where the browser refuses that (no gesture on
 * this page yet), the spot plays muted with a "Tap for sound" button instead of
 * not at all.
 */
export default function LivePreroll({ ad, sid, onDone }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const doneRef = useRef(false);
  const playedRef = useRef(0);       // high-water mark of seconds played
  const reportedRef = useRef(0);
  const rememberedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [needsSound, setNeedsSound] = useState(false);
  // Read through a ref: a parent passing a fresh callback each render must not
  // restart the player (finish() is a dependency of the loader below).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const report = useCallback(() => {
    const secs = Math.round(playedRef.current * 100) / 100;
    if (!sid || secs <= reportedRef.current) return;
    reportedRef.current = secs;
    fetch(`${CHECKER_URL}/m/${encodeURIComponent(sid)}/w`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: secs }),
      keepalive: true,
    }).catch(() => { /* an unreported beat is not a crash */ });
  }, [sid]);

  // One exit for every ending. `how`: 'ended' | 'skipped' | 'failed'.
  const finish = useCallback((how) => {
    if (doneRef.current) return;
    doneRef.current = true;
    try { hlsRef.current?.destroy(); } catch { /* already gone */ }
    hlsRef.current = null;
    try { videoRef.current?.pause(); } catch { /* nothing to pause */ }
    report();
    if (how === 'skipped' && sid) {
      fetch(`${CHECKER_URL}/m/${encodeURIComponent(sid)}/skipped`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true,
      }).catch(() => { /* the viewer is through either way */ });
    }
    if (how === 'failed') console.warn('[livePreroll] showing the stream without the spot');
    onDoneRef.current?.();
  }, [report, sid]);

  // Leaving the page mid-spot still reports what was watched.
  useEffect(() => () => { if (!doneRef.current) report(); }, [report]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ad?.manifestUrl) { finish('failed'); return undefined; }
    let alive = true;

    const start = async () => {
      try {
        video.muted = false;
        await video.play();
      } catch {
        if (!alive) return;
        try {
          video.muted = true;
          await video.play();
          if (alive) setNeedsSound(true);
        } catch {
          if (alive) finish('failed');
        }
      }
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari plays HLS natively and hls.js refuses to attach there.
      video.src = ad.manifestUrl;
      start();
    } else if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => { if (alive && data?.fatal) finish('failed'); });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (alive) start(); });
      hls.loadSource(ad.manifestUrl);
      hls.attachMedia(video);
    } else {
      finish('failed');
    }
    return () => {
      alive = false;
      try { hlsRef.current?.destroy(); } catch { /* already gone */ }
      hlsRef.current = null;
    };
  }, [ad, finish]);

  // Paused while the tab is hidden and resumed on return, as the upload gate does:
  // a viewer who clicked through to the advertiser should not miss the rest.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video || doneRef.current) return;
      if (document.hidden) { try { video.pause(); } catch { /* nothing to pause */ } }
      else video.play().catch(() => { /* they can tap it */ });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Stall watchdog: measures progress, not wall clock, and ignores hidden/paused time.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    video.addEventListener('timeupdate', bump);
    const tick = setInterval(() => {
      if (document.hidden || video.paused) { last = Date.now(); return; }
      if (Date.now() - last > STALL_MS) finish('failed');
    }, 1000);
    return () => { clearInterval(tick); video.removeEventListener('timeupdate', bump); };
  }, [finish]);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const now = video.currentTime || 0;
    setPosition(now);
    if (now > playedRef.current) playedRef.current = now;
    // On screen: remembered as seen, so the next page does not repeat it.
    if (!rememberedRef.current && now > 0 && ad?.adKey) {
      rememberedRef.current = true;
      rememberAdSeen(ad.adKey);
    }
    if (playedRef.current - reportedRef.current >= BEAT_S) report();
  };

  const unmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play().catch(() => { /* still playing muted */ });
    setNeedsSound(false);
  };

  const total = Number(ad?.durationSeconds) || 0;
  const secondsLeft = total > 0 ? Math.max(0, Math.ceil(total - position)) : null;
  const skipAfter = typeof ad?.skipAfterSeconds === 'number' ? ad.skipAfterSeconds : null;
  const skipIn = skipAfter != null && position < skipAfter ? skipAfter - position : null;

  return (
    <div className="live-preroll" role="region" aria-label={t('ads.gate.ariaLabel')}>
      <video
        ref={videoRef}
        className="live-preroll__video"
        playsInline
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        onEnded={() => { playedRef.current = Math.max(playedRef.current, total); finish('ended'); }}
        onError={() => finish('failed')}
      />
      {!playing && position === 0 && <div className="live-preroll__loading" aria-hidden="true"><i /></div>}
      <div className="live-preroll__brand">
        <AdOverlay
          account={ad?.brand?.account || null}
          brand={ad?.brand || null}
          resumeIn={secondsLeft}
          resumeKey="ads.overlay.streamStartsIn"
          resumeMomentKey="ads.overlay.streamStartsMoment"
        />
      </div>
      {needsSound && (
        <button type="button" className="live-preroll__sound" onClick={unmute}>
          <MdVolumeUp aria-hidden="true" />
          {t('ads.overlay.tapForSound')}
        </button>
      )}
      {skipAfter != null && (
        <AdSkip secondsUntil={skipIn} onSkip={() => finish('skipped')} />
      )}
    </div>
  );
}

LivePreroll.propTypes = {
  ad: PropTypes.shape({
    manifestUrl: PropTypes.string,
    durationSeconds: PropTypes.number,
    skipAfterSeconds: PropTypes.number,
    adKey: PropTypes.string,
    brand: PropTypes.object,
  }).isRequired,
  sid: PropTypes.string,
  onDone: PropTypes.func.isRequired,
};
