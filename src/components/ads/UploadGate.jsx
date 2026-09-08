import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Hls from 'hls.js';
import './UploadGate.scss';

/**
 * The pre-upload spot: a creator watches it before they may post.
 *
 * 🚨 THIS ONE INTERRUPTS WORK, NOT CONSUMPTION.
 * Every other ad surface sits between somebody and entertainment they can come back to.
 * This sits between a creator and publishing a video they have already made and
 * uploaded, which is the worst possible moment to be wrong. So it fails OPEN at every
 * step: no ad, an ad that will not load, a stalled manifest, a player error, a request
 * that never answers — all of them let the post through. The only path that blocks is
 * one where a spot is genuinely playing.
 *
 * The countdown runs on PLAYBACK rather than on arrival, for the same reason as the
 * shorts spot: a clock started when the ad was requested spends its first seconds on
 * loading, and the advertiser paid for seconds on screen. It stops when the video is
 * paused, so pausing cannot be used to wait the spot out.
 *
 * There is no skip. That is the whole product — an advertiser buying this is buying
 * completion, and a skip button would make it a shorts spot with extra steps. The escape
 * hatch is the failure path above, not a button.
 */
export default function UploadGate({ ad, onWatched }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [left, setLeft] = useState(Math.ceil(Number(ad?.durationSeconds) || 0));
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  /* One place to leave, so every exit runs the same teardown.
   *
   * 🚨 `played` says whether the spot actually reached its end, and the caller MUST NOT
   * ignore it. Every exit here unlocks the upload — that is the fail-open promise — but
   * only a real playthrough is an impression. Reporting a bailed spot as watched would
   * bill an advertiser for a spot that never rendered a frame, and pay the creator for
   * it, every time a manifest 404'd. */
  const finish = useCallback((played) => {
    try { hlsRef.current?.destroy(); } catch { /* already gone */ }
    hlsRef.current = null;
    onWatched(played === true);
  }, [onWatched]);

  // A spot that cannot be played must not cost somebody their upload. Hoisted out of
  // the loader because the stall watchdog below needs the same exit.
  const bail = useCallback((why) => {
    console.warn('[uploadGate] letting the post through:', why);
    setFailed(true);
    finish(false);          // unlocked, but nothing was watched and nothing is owed
  }, [finish]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ad?.manifestUrl) return undefined;
    let alive = true;
    const bailIfAlive = (why) => { if (alive) bail(why); };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari plays HLS natively and hls.js refuses to attach there.
      video.src = ad.manifestUrl;
      video.play().catch(() => bailIfAlive('autoplay refused'));
    } else if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data?.fatal) bailIfAlive(`hls ${data.type}`); });
      hls.loadSource(ad.manifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => bailIfAlive('autoplay refused')));
    } else {
      bailIfAlive('no HLS support in this browser');
      return undefined;
    }

    return () => {
      alive = false;
      try { hlsRef.current?.destroy(); } catch { /* already gone */ }
      hlsRef.current = null;
    };
  }, [ad, bail]);

  /* Paused while the tab is in the background, and picked up again on return.
   *
   * Somebody who clicks through to the advertiser is doing the thing the advertiser
   * paid for, and they should not come back to a spot that ran to the end without
   * them. It also closes the obvious dodge: open the gate, switch away, come back to
   * an unlocked button having watched nothing.
   *
   * The countdown already tracks `playing`, so pausing the video stops the clock with
   * no extra bookkeeping.
   */
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) {
        try { video.pause(); } catch { /* nothing to pause */ }
      } else {
        // May be refused when the tab regains focus; the viewer can press play, and
        // the countdown simply waits. Never a reason to fail the gate.
        video.play().catch(() => { /* they can start it themselves */ });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /* Stall watchdog: bails only when the spot SHOULD be advancing and is not.
   *
   * ⚠️ This was a fixed timeout of twice the spot's length from arrival, which was
   * fine while nothing could pause it. It is wrong now: reading the advertiser's page
   * for half a minute would have tripped it, letting the post through on a spot that
   * never finished — the gate quietly opening as a reward for clicking the ad.
   *
   * So it measures PROGRESS instead of wall-clock, and ignores time while the tab is
   * hidden or the video is legitimately paused. What it still catches is the case it
   * was written for: a frozen player that fires no error and would otherwise strand
   * somebody on a still frame with no way forward.
   */
  useEffect(() => {
    if (failed) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let lastProgress = Date.now();
    const bump = () => { lastProgress = Date.now(); };
    video.addEventListener('timeupdate', bump);
    const tick = setInterval(() => {
      if (document.hidden || video.paused) { lastProgress = Date.now(); return; }
      if (Date.now() - lastProgress > 20000) bail('spot stalled with no error');
    }, 1000);
    return () => {
      clearInterval(tick);
      video.removeEventListener('timeupdate', bump);
    };
  }, [failed, bail]);

  // Ticks only while the video is actually moving, so loading and pausing do not
  // consume the advertiser's seconds.
  useEffect(() => {
    if (!playing || failed) return undefined;
    const t = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [playing, failed]);

  const brand = ad?.brand;
  return (
    <div className="upload-gate" role="dialog" aria-modal="true" aria-label="Sponsor message">
      <div className="upload-gate-inner">
        <video
          ref={videoRef}
          className="upload-gate-video"
          playsInline
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => finish(true)}
          onError={() => { setFailed(true); finish(false); }}
        />
        <div className="upload-gate-bar">
          <span className="upload-gate-label">{ad?.label || 'Sponsored'}</span>
          {brand?.productName && (
            brand.clickUrl
              ? <a className="upload-gate-brand" href={brand.clickUrl} target="_blank" rel="noopener noreferrer sponsored">{brand.productName}</a>
              : <span className="upload-gate-brand">{brand.productName}</span>
          )}
          <span className="upload-gate-count">
            {playing ? `${left}s` : 'loading…'}
          </span>
        </div>
        <p className="upload-gate-note">Watch this to unlock Post Video.</p>
      </div>
    </div>
  );
}

UploadGate.propTypes = {
  ad: PropTypes.shape({
    manifestUrl: PropTypes.string,
    durationSeconds: PropTypes.number,
    label: PropTypes.string,
    brand: PropTypes.object,
  }).isRequired,
  onWatched: PropTypes.func.isRequired,
};
