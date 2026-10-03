import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import './AudioPlayerInline.scss';

const SPEEDS = [1, 1.5, 2];

export default function AudioPlayerInline({
  src,
  variant = 'inline',
  title: titleProp,
  subtitle: subtitleProp,
  artworkUrl = '',
  externalUrl = '',
}) {
  const { t } = useTranslation();
  // Same semantics as the old default params: only an undefined prop falls back.
  const title = titleProp === undefined ? t('audio.inline.defaultTitle') : titleProp;
  const subtitle = subtitleProp === undefined ? t('audio.inline.defaultSubtitle') : subtitleProp;
  const [audioUrl, setAudioUrl]       = useState(null);
  const [fallbackUrl, setFallbackUrl] = useState(null);
  const [resolvedArtwork, setResolvedArtwork] = useState('');
  const [loading, setLoading]         = useState(true);
  const [failed, setFailed]           = useState(false);
  const [playing, setPlaying]         = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [speedIdx, setSpeedIdx]       = useState(0);
  const [dragging, setDragging]       = useState(false);
  const audioRef    = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    try {
      const u = new URL(src);
      const perm = u.searchParams.get('a');
      if (!perm) { setFailed(true); setLoading(false); return; }

      fetch(`${u.origin}/api/audio?a=${perm}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          if (!data?.audioUrl) throw new Error('no url');
          setAudioUrl(data.audioUrl);
          if (data.audioUrlFallback) setFallbackUrl(data.audioUrlFallback);
          if (data.thumbnail_url) setResolvedArtwork(data.thumbnail_url);
          if (data.duration && !isNaN(data.duration)) setDuration(data.duration);
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false));
    } catch {
      setFailed(true);
      setLoading(false);
    }
  }, [src]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else a.play().catch(() => {});
  };

  const handleError = () => {
    const a = audioRef.current;
    if (fallbackUrl && a && a.src !== fallbackUrl) {
      const wasPlaying = playing;
      a.src = fallbackUrl;
      if (wasPlaying) a.play().catch(() => {});
    } else {
      setFailed(true);
    }
  };

  const getRatio = useCallback((clientX) => {
    const bar = progressRef.current;
    if (!bar || !duration) return null;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [duration]);

  const seekTo = useCallback((ratio) => {
    const a = audioRef.current;
    if (!a || ratio === null) return;
    a.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  }, [duration]);

  const handleProgressClick = (e) => seekTo(getRatio(e.clientX));

  const handleMouseDown = (e) => {
    setDragging(true);
    seekTo(getRatio(e.clientX));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => seekTo(getRatio(e.clientX));
    const onUp   = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, duration, getRatio, seekTo]);

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  const fmt = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayArtwork = artworkUrl || resolvedArtwork;
  const hasMediaHeader = variant === 'preview' || displayArtwork || title || subtitle;
  const kicker = variant === 'preview' ? t('audio.inline.kickerPreview') : t('audio.inline.kickerOpenPod');

  if (failed) return null;

  return (
    <div className={`apin apin--${variant}`}>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
          onLoadedMetadata={() => {
            const d = audioRef.current?.duration;
            if (d && !isNaN(d)) setDuration(d);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
          onError={handleError}
          preload="metadata"
        />
      )}

      {hasMediaHeader && (
        <div className="apin__media">
          <div className="apin__art" aria-hidden="true">
            {displayArtwork ? (
              <img src={displayArtwork} alt="" />
            ) : (
              <span>OP</span>
            )}
          </div>
          <div className="apin__meta">
            <span className="apin__kicker">{kicker}</span>
            <span className="apin__title">{title}</span>
            {subtitle && <span className="apin__subtitle">{subtitle}</span>}
          </div>
        </div>
      )}

      <button
        type="button"
        className="apin__play"
        onClick={togglePlay}
        disabled={loading || !audioUrl}
        aria-label={playing ? t('common.actions.pause') : t('common.actions.play')}
      >
        {loading ? (
          <span className="apin__spinner" />
        ) : playing ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      <div
        className="apin__progress"
        ref={progressRef}
        onClick={handleProgressClick}
        onMouseDown={handleMouseDown}
        style={{ cursor: dragging ? 'grabbing' : 'pointer' }}
      >
        <div className="apin__track">
          <div className="apin__fill" style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
        <div className="apin__thumb" style={{ left: `${progress}%` }} />
      </div>

      <span className="apin__time">
        {fmt(currentTime)}<span className="apin__sep"> / </span>{fmt(duration)}
      </span>

      <button type="button" className="apin__speed" onClick={cycleSpeed}>
        {SPEEDS[speedIdx]}x
      </button>

      {externalUrl && (
        <a className="apin__external" href={externalUrl} target="_blank" rel="noopener noreferrer">
          {t('common.actions.open')}
        </a>
      )}
    </div>
  );
}
