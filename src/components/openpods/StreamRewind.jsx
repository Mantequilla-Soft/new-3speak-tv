import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Hls from 'hls.js';
import { DockTile, Icon, IconButton } from '../v2/ui';
import { clipClock } from '../../lib/streamClips';
import './StreamRewind.scss';

/**
 * Rewind during a live stream (H14). A Pro host's DVR already records the
 * stream as HLS segments on its server; while it runs, GET /rooms/:room/dvr/rewind
 * hands out a playlist of the last ten minutes. "Rewind" plays that playlist
 * over the live picture (hls.js, or Safari's own HLS), with a seek bar and
 * "Go live" back to the real-time stream, whose sound is held while rewinding.
 * The state comes from hooks/useStreamRewind.js.
 */
/** The Rewind tile (dock), rail item (phone) or overlay chip (watch-page player). */
export function StreamRewindButton({ rewind, variant = 'dock' }) {
  const { t } = useTranslation();
  if (!rewind?.available) return null;
  const toggle = rewind.active ? rewind.close : rewind.open;
  const label = rewind.active ? t('rewind.goLive') : t('rewind.label');
  const title = t('rewind.title', { minutes: Math.max(1, Math.round(rewind.windowSec / 60)) });
  if (variant === 'sidebar') {
    return (
      <div className="actionItem" onClick={toggle} role="button" title={title}>
        <div className={`actionButton${rewind.active ? ' liked' : ''}`}><Icon name={rewind.active ? 'live_tv' : 'history'} size={24} /></div>
        <span className="actionLabel">{label}</span>
      </div>
    );
  }
  if (variant === 'overlay') {
    return (
      <button type="button" className="stream-rewind-chip" onClick={toggle} title={title}>
        <Icon name={rewind.active ? 'live_tv' : 'history'} size={18} />
        <span>{label}</span>
      </button>
    );
  }
  return <DockTile icon={rewind.active ? 'live_tv' : 'history'} label={label} active={rewind.active} onClick={toggle} title={title} />;
}

/**
 * The rewind player, absolutely filling its positioned parent (the stream's
 * player box). Starts 30 s behind live; "Go live" closes it.
 */
export function StreamRewindPlayer({ rewind }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const [state, setState] = useState({ start: 0, end: 0, time: 0, paused: false, ready: false, error: false });
  const url = rewind?.active ? rewind.playlistUrl : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!url || !video) return undefined;
    let hls = null;
    let startedBack = false;
    const startBack = () => {
      if (startedBack || !video.seekable.length) return;
      startedBack = true;
      const end = video.seekable.end(video.seekable.length - 1);
      const start = video.seekable.start(0);
      video.currentTime = Math.max(start, end - 30);
      video.play().catch(() => { /* autoplay blocked: the play button is there */ });
    };
    if (Hls.isSupported()) {
      hls = new Hls({ liveDurationInfinity: true, backBufferLength: 120 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.LEVEL_LOADED, () => { setState((s) => ({ ...s, ready: true })); startBack(); });
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data?.fatal) setState((s) => ({ ...s, error: true })); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('loadedmetadata', startBack, { once: true });
    } else {
      setState((s) => ({ ...s, error: true }));
    }
    const tick = () => {
      const s = video.seekable;
      setState((p) => ({
        ...p,
        start: s.length ? s.start(0) : 0,
        end: s.length ? s.end(s.length - 1) : 0,
        time: video.currentTime || 0,
        paused: video.paused,
        ready: p.ready || s.length > 0,
      }));
      if (!startedBack) startBack();
    };
    const timer = setInterval(tick, 500);
    video.addEventListener('timeupdate', tick);
    return () => {
      clearInterval(timer);
      video.removeEventListener('timeupdate', tick);
      if (hls) hls.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  if (!url) return null;
  const seek = (to) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(to, state.start), Math.max(state.start, state.end - 1));
  };
  const behind = Math.max(0, state.end - state.time);
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };

  return (
    <div className="stream-rewind" onClick={(e) => e.stopPropagation()}>
      <video ref={videoRef} className="stream-rewind__video" playsInline />
      {state.error && <div className="stream-rewind__error">{t('rewind.error')}</div>}
      <div className="stream-rewind__bar">
        <IconButton icon="replay_10" label={t('rewind.back10')} size={36} variant="media" onClick={() => seek(state.time - 10)} disabled={!state.ready} />
        <IconButton icon={state.paused ? 'play_arrow' : 'pause'} label={state.paused ? t('rewind.play') : t('rewind.pause')} size={36} variant="media" onClick={togglePlay} disabled={!state.ready} />
        <IconButton icon="forward_10" label={t('rewind.forward10')} size={36} variant="media" onClick={() => seek(state.time + 10)} disabled={!state.ready} />
        <input
          className="stream-rewind__seek"
          type="range"
          min={state.start}
          max={Math.max(state.start + 1, state.end)}
          step={1}
          value={Math.min(Math.max(state.time, state.start), Math.max(state.start + 1, state.end))}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={t('rewind.seek')}
          disabled={!state.ready}
        />
        <span className="stream-rewind__behind num" aria-live="off">-{clipClock(behind)}</span>
        <button type="button" className="stream-rewind__live" onClick={rewind.close}>
          <span className="stream-rewind__dot" aria-hidden="true" />
          {t('rewind.goLive')}
        </button>
      </div>
    </div>
  );
}
