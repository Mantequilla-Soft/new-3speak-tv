import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayer } from '@mantequilla-soft/3speak-player/react';
import { ThreeSpeakApi } from '@mantequilla-soft/3speak-player';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import VideoControls from '../VideoControls/VideoControls';
import { useAdPlayback } from '../../hooks/useAdPlayback';
import useWatchDuration from '../../hooks/useWatchDuration';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { recordView } from '../../lib/recordView';
import { useAppStore } from '../../lib/store';
import { getPlayerUrl } from '../../utils/playerUrl';
import { notifyMediaPlay, onMediaPlay } from '../../utils/mediaCoordinator';
import './PlayVideo.scss';
import './InlineVideoPlayer.scss';

/* The watch page's player, small enough to sit in a chat message.
 *
 * Same SDK, same controls and, above all, the same ads: spot, disclosure, Skip,
 * seek lock, banner and ticker all come from hooks/useAdPlayback, the code the
 * watch page runs. Watch time and the view count are recorded the same way too,
 * so a video played in chat is credited to its creator like any other play.
 *
 * Deliberately NOT here: gated (supporters-only) and live posts, which the card
 * sends to the watch page instead; reactions, subtitles, quality and the rest of
 * the watch page's extras. Mounted only once someone presses play, so a chat full
 * of links does not start a player (or an ad request) per link.
 */

// Mute/volume preference, shared with the watch page.
const MUTE_STORAGE_KEY = '3speak-muted';
const VOLUME_STORAGE_KEY = '3speak-volume';

// Same Apple caps as the watch page (see the note in page/Watch.jsx).
const IS_APPLE_WEBKIT = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
);
const APPLE_HLS_CAPS = {
  maxBufferLength: 20,
  maxMaxBufferLength: 40,
  maxBufferSize: 20 * 1000 * 1000,
  backBufferLength: 10,
};

// One inline player plays at a time: starting one pauses whichever was playing.
// (mediaCoordinator only pauses OTHER kinds of player, so two of the same kind
// need this on top.)
let pauseCurrentInline = null;

export default function InlineVideoPlayer({ author, permlink, poster = null, onOpenWatch = null }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const premiumStatus = usePremiumStatus(user);
  const wrapperRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef(null);

  const {
    ref: sdkVideoRef,
    state: playerState,
    player,
    load: loadVideo,
    pause,
    togglePlay,
    seek,
    setMuted: sdkSetMuted,
    setVolume: sdkSetVolume,
  } = usePlayer({
    apiBase: getPlayerUrl(),
    muted: localStorage.getItem(MUTE_STORAGE_KEY) === '1',
    loop: false,
    poster: false,
    resume: false,
    // Only a definitive failure; the player has already tried its other CDNs.
    onError: (err) => { if (err?.fatal) setFailed(true); },
    onReady: () => setReady(true),
    hlsConfig: {
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      maxBufferSize: 60 * 1000 * 1000,
      fragLoadingTimeOut: 60000,
      fragLoadingMaxRetry: 3,
      fragLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 60000,
      manifestLoadingTimeOut: 20000,
      levelLoadingTimeOut: 20000,
      startLevel: -1,
      abrEwmaDefaultEstimate: 1000000,
      ...(IS_APPLE_WEBKIT ? APPLE_HLS_CAPS : {}),
    },
  });

  // Callback ref for the SDK, object ref for everything that measures the element
  // (the banner click target, the seek guard). See the same pair in Watch.jsx.
  const [videoAttached, setVideoAttached] = useState(false);
  const videoElRef = useRef(null);
  const videoRef = useCallback((element) => {
    try { sdkVideoRef(element); } catch { /* player already destroyed */ }
    videoElRef.current = element;
    if (element) {
      const savedVol = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY));
      if (!isNaN(savedVol)) element.volume = savedVol;
      if (poster) element.poster = poster;
    }
    setVideoAttached(!!element);
  }, [sdkVideoRef, poster]);

  const sdkApiRef = useRef(null);
  if (!sdkApiRef.current) sdkApiRef.current = new ThreeSpeakApi(getPlayerUrl());

  const { adBreakRef, chrome, beginVideo, loadWithSpot } = useAdPlayback({
    player, playerState, videoElRef, videoAttached,
  });

  // Load once the element is attached: a spot if the checker has one, else plain.
  useEffect(() => {
    if (!player || !videoAttached || !author || !permlink) return undefined;
    let active = true;
    const viewer = (useAppStore.getState().user || '').toLowerCase() || null;
    beginVideo();
    (async () => {
      const got = await loadWithSpot({
        api: sdkApiRef.current, author, permlink, viewer, loadVideo,
        isActive: () => active,
      });
      if (got !== 'plain') return;
      // Not reported to the checker as unavailable: that call belongs to the watch
      // page, which can tell a dead video from one this small player cannot play.
      loadVideo(`${author}/${permlink}`).catch(() => { if (active) setFailed(true); });
    })();
    return () => { active = false; };
  }, [player, videoAttached, author, permlink, loadVideo, beginVideo, loadWithSpot]);

  // Someone pressed play to get here, so start as soon as there is a frame.
  useEffect(() => {
    if (!player) return undefined;
    return player.on('ready', () => {
      player.play().catch(() => { /* the play button is right there */ });
    });
  }, [player]);

  // Watch time in CONTENT seconds, and the view count, exactly as on the watch page.
  useWatchDuration({
    api: sdkApiRef.current,
    author,
    permlink,
    playerState,
    mapPosition: (tSec) => adBreakRef.current.contentTime(tSec),
    premium: premiumStatus?.premium === true,
  });
  const viewCountedRef = useRef(false);
  useEffect(() => {
    if (playerState?.paused !== false || viewCountedRef.current) return;
    viewCountedRef.current = true;
    recordView(sdkApiRef.current, author, permlink);
  }, [playerState?.paused, author, permlink]);

  // One player at a time: the watch page, audio and shorts pause for this, and
  // this pauses for them and for any other inline player.
  useEffect(() => {
    if (playerState.paused) return;
    notifyMediaPlay('inline-video');
    if (pauseCurrentInline && pauseCurrentInline !== pause) pauseCurrentInline();
    pauseCurrentInline = pause;
  }, [playerState.paused, pause]);
  useEffect(() => onMediaPlay('inline-video', () => pause()), [pause]);
  useEffect(() => () => { if (pauseCurrentInline === pause) pauseCurrentInline = null; }, [pause]);

  const setMuted = useCallback((m) => {
    sdkSetMuted(m);
    localStorage.setItem(MUTE_STORAGE_KEY, m ? '1' : '0');
  }, [sdkSetMuted]);
  const setVolume = useCallback((vol) => {
    sdkSetVolume(vol);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(vol));
  }, [sdkSetVolume]);

  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);
  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrapperRef.current?.requestFullscreen?.();
  }, []);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The timeline in CONTENT seconds, the same mapping as the watch page's controls:
  // a stitched spot is not part of the creator's video, and its seconds cannot be
  // scrubbed into.
  const ab = adBreakRef.current;
  const contentDuration = ab.contentDuration(playerState.duration);

  return (
    <div
      className={`inline-player${isFullscreen ? ' is-fullscreen' : ''}`}
      ref={wrapperRef}
      onMouseMove={showControlsTemporarily}
    >
      {chrome.adCountdown != null && (
        <div className="watch-ad-countdown" role="status" aria-live="polite">
          {t('watch.ad.countdown', { seconds: chrome.adCountdown })}
        </div>
      )}
      {chrome.adSkip}
      {chrome.sponsorLabel && (
        <div className="watch-sponsor-note watch-sponsor-slot">{chrome.sponsorLabel}</div>
      )}
      {chrome.bannerHit}
      {chrome.tickerSlot}
      <video ref={videoRef} playsInline />
      {!ready && !failed && (
        <div className="inline-player-loading" aria-hidden="true">
          <Loader2 size={28} className="inline-player-spin" />
        </div>
      )}
      {failed && (
        <div className="inline-player-failed">
          <span>{t('player.inline.cantPlay')}</span>
          {onOpenWatch && (
            <button type="button" onClick={onOpenWatch}>{t('player.inline.openOnSite')}</button>
          )}
        </div>
      )}
      {!failed && (
        <>
          <div
            className="video-interact-overlay"
            onClick={() => { togglePlay(); showControlsTemporarily(); }}
          />
          <VideoControls
            adPlaying={chrome.adPlaying}
            adLocked={chrome.adLocked}
            currentTime={ab.contentTime(playerState.currentTime)}
            duration={contentDuration}
            buffered={(() => {
              if (!(contentDuration > 0) || !(playerState.duration > 0)) return playerState.buffered;
              return Math.min(1, ab.contentTime(playerState.buffered * playerState.duration) / contentDuration);
            })()}
            isPlaying={!playerState.paused}
            isMuted={playerState.muted}
            volume={playerState.volume}
            isFullscreen={isFullscreen}
            isVisible={controlsVisible || playerState.paused}
            onTogglePlay={togglePlay}
            onToggleMute={() => setMuted(!playerState.muted)}
            onVolumeChange={(val) => {
              setVolume(val);
              if (val === 0) setMuted(true);
              else if (playerState.muted) setMuted(false);
            }}
            onSeekBackward={() => {
              const at = ab.contentTime(playerState.currentTime);
              seek(ab.playerTimeFor(Math.max(0, at - 10)));
            }}
            onSeekForward={() => {
              if (ab.seekLocked(playerState.currentTime)) return;
              const at = ab.contentTime(playerState.currentTime);
              seek(ab.playerTimeFor(Math.min(contentDuration, at + 10)));
            }}
            onSeek={(tSec) => {
              const to = ab.playerTimeFor(tSec);
              if (ab.lockedSeekTarget(to, playerState.currentTime) != null) return;
              seek(to);
            }}
            onToggleFullscreen={toggleFullscreen}
            onHoldControls={() => { clearTimeout(hideTimerRef.current); setControlsVisible(true); }}
            onReleaseControls={showControlsTemporarily}
          />
        </>
      )}
    </div>
  );
}
