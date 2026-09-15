import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import useSeekPreview from '../../hooks/useSeekPreview';
import { createPortal } from 'react-dom';
import { FaPlay, FaPause, FaExpand, FaCompress, FaVolumeUp, FaVolumeMute, FaVideo, FaCog } from 'react-icons/fa';
import { MdClosedCaption, MdClosedCaptionOff, MdHighQuality } from 'react-icons/md';
import { TbRewindBackward10, TbRewindForward10, TbArrowsMaximize, TbPictureInPicture, TbBulbFilled, TbMoonFilled, TbSunFilled, TbPlayerTrackNextFilled } from 'react-icons/tb';
import { SUPPORTED_LANGUAGES } from '../../utils/translate';
import { SUBTITLE_FONTS } from '../SubtitleOverlay/SubtitleOverlay';
import './VideoControls.scss';

const FONT_OPTIONS = [
  { key: 'sans-serif', label: 'Sans-serif' },
  { key: 'serif', label: 'Serif' },
  { key: 'monospace', label: 'Monospace' },
  { key: 'arial', label: 'Arial' },
  { key: 'verdana', label: 'Verdana' },
  { key: 'georgia', label: 'Georgia' },
  { key: 'times', label: 'Times' },
  { key: 'courier', label: 'Courier' },
  { key: 'comic-sans', label: 'Comic Sans' },
  { key: 'impact', label: 'Impact' },
];

function PortalIf({ condition, children }) {
  if (condition && typeof document !== 'undefined') {
    // In fullscreen only the fullscreen element's subtree is painted, so portal
    // into it (e.g. the subtitle/quality menus) instead of <body> — otherwise the
    // menu is invisible/unreachable in fullscreen on mobile.
    const target = document.fullscreenElement || document.body;
    return createPortal(children, target);
  }
  return children;
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}


function VideoControls({
  // A video ROLL is on screen. The scrubber goes away for the length of the spot —
  // an advertiser paying for five seconds should not be handed a drag handle
  // straight past them.
  //
  // 🚨 Rolls only. A banner is painted into the creator's video while it plays
  // normally, so it never sets this: taking the timeline away then would be
  // removing a control from ordinary playback.
  adPlaying = false,
  /* A break is imminent or running and the timeline must not move the playhead past
   * it. Separate from adPlaying on purpose: that takes the WHOLE bar down for the
   * length of a spot, which is right while somebody else's video is on screen and
   * wrong in the seconds before it, where the creator's video is still playing and
   * the viewer should keep pause, volume and fullscreen. Only the scrubber goes. */
  adLocked = false,
  currentTime,
  duration,
  buffered,
  isPlaying,
  isMuted,
  volume,
  isFullscreen,
  onSeekBackward,
  onSeekForward,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onToggleFullscreen,
  onSeek,
  isVisible,
  markers,
  replayHeatmap,
  previewVideoId,
  getPlaybackHeight,
  onMarkerSelect,
  onReactToMoment,
  onCycleReactionSize,
  reactionSizeLabel,
  onTogglePip,
  qualityLevels,
  currentQuality,
  onQualityChange,
  glowMode,
  onToggleGlow,
  autoplayNext,
  onToggleAutoplay,
  subtitleLanguages,
  selectedSubtitleLang,
  onSubtitleChange,
  subtitleLoading,
  subtitleStyle,
  onSubtitleStyleChange,
  playbackRate,
  onPlaybackRateChange,
  onHoldControls,
  onReleaseControls,
}) {
  const resolvedMarkers = markers || [];

  const [hovering, setHovering] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const qualityMenuRef = useRef(null);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const speedMenuRef = useRef(null);
  const speedPortalRef = useRef(null);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const subtitleMenuRef = useRef(null);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const mobileSettingsRef = useRef(null);
  const isTouchDevice = typeof window !== 'undefined' && 'ontouchstart' in window;
  const [hoveredMarker, setHoveredMarker] = useState(null);
  const trackRef = useRef(null);
  const subtitlePortalRef = useRef(null);
  const qualityPortalRef = useRef(null);
  const [dragProgress, setDragProgress] = useState(null); // non-null while dragging

  // Volume slider — fully ref-driven to avoid React re-render lag
  const volSliderRef = useRef(null);
  const volDraggingRef = useRef(false);

  // Sync slider from prop only when user is NOT dragging
  useEffect(() => {
    if (volDraggingRef.current || !volSliderRef.current) return;
    const displayVol = isMuted ? 0 : (volume ?? 1);
    volSliderRef.current.value = displayVol;
    const pct = (displayVol * 100).toFixed(0);
    volSliderRef.current.style.background =
      `linear-gradient(to right, var(--accent-primary, #e53935) ${pct}%, rgba(255,255,255,0.3) ${pct}%)`;
  }, [volume, isMuted]);
  const progress = dragProgress !== null ? dragProgress : (duration > 0 ? (currentTime / duration) * 100 : 0);
  const bufferedPercent = (buffered || 0) * 100;

  // Build a heatmap gradient showing where reactions cluster
  const heatmapStyle = duration > 0 && resolvedMarkers.length > 0 ? (() => {
    // Create soft gaussian-like glows at each marker position
    const stops = resolvedMarkers.map(m => {
      const pos = (m.time / duration) * 100;
      const color = m.isVideo ? 'rgba(229,57,53,0.25)' : 'rgba(255,255,255,0.12)';
      return `${color} ${pos}%`;
    });
    // Interleave transparent stops to create isolated glows
    const gradient = [];
    for (const m of resolvedMarkers) {
      const pos = (m.time / duration) * 100;
      const color = m.isVideo ? 'rgba(229,57,53,0.25)' : 'rgba(255,255,255,0.12)';
      gradient.push(`transparent ${Math.max(0, pos - 3)}%`);
      gradient.push(`${color} ${pos}%`);
      gradient.push(`transparent ${Math.min(100, pos + 3)}%`);
    }
    return { background: `linear-gradient(to right, ${gradient.join(', ')})` };
  })() : null;

  // "Most replayed" heatmap — an SVG area whose height at each x reflects how
  // often that slice of the timeline was watched (normalized 0..1 buckets from
  // /api/heatmap). Rendered as a stretched area above the scrubber, YouTube-style.
  const replayHeatmapPath = useMemo(() => {
    const b = Array.isArray(replayHeatmap) ? replayHeatmap : null;
    if (!b || b.length < 2 || !b.some((v) => v > 0)) return null;
    const n = b.length;
    const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    // SVG y grows downward; baseline at 100, peaks reach ~8 (small top margin).
    const y = (v) => (100 - clamp01(v) * 92).toFixed(2);
    const pts = b.map((v, i) => `${i},${y(v)}`).join(' L');
    return { d: `M0,100 L${pts} L${n - 1},100 Z`, viewBox: `0 0 ${n - 1} 100` };
  }, [replayHeatmap]);

  // Get fraction (0-1) from a pointer/touch event relative to the track
  const fractionFromEvent = useCallback((e) => {
    if (!trackRef.current || !duration) return null;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [duration]);

  // Scrub-preview thumbnail (low-res, same technique as the homepage hover cards)
  const {
    videoRef: previewVideoRef,
    preview,
    previewWidth,
    frameless: previewFrameless,
    showAt: showSeekPreview,
    hide: hideSeekPreview,
    fmtTime: fmtPreviewTime,
  } = useSeekPreview({ videoId: previewVideoId, trackRef, duration, getPlaybackHeight });

  // Drag/scrub support — visual progress updates instantly, seeks throttled to ~150ms
  const isDraggingRef = useRef(false);
  const dragFractionRef = useRef(0);
  const lastSeekTimeRef = useRef(0);
  const SEEK_THROTTLE_MS = 150;

  const handleTrackPointerDown = useCallback((e) => {
    if (e.button && e.button !== 0) return;
    const fraction = fractionFromEvent(e);
    if (fraction === null) return;
    isDraggingRef.current = true;
    dragFractionRef.current = fraction;
    setDragProgress(fraction * 100);
    onSeek?.(fraction * duration);
    lastSeekTimeRef.current = Date.now();
    showSeekPreview(e.touches ? e.touches[0].clientX : e.clientX);
    e.preventDefault();
  }, [fractionFromEvent, duration, onSeek, showSeekPreview]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!isDraggingRef.current || !trackRef.current || !duration) return;
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = trackRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      dragFractionRef.current = fraction;
      setDragProgress(fraction * 100);
      showSeekPreview(clientX);
      // Throttle actual seeks so HLS can keep up
      const now = Date.now();
      if (now - lastSeekTimeRef.current >= SEEK_THROTTLE_MS) {
        onSeek?.(fraction * duration);
        lastSeekTimeRef.current = now;
      }
    };
    const handleUp = () => {
      if (isDraggingRef.current && duration) {
        // Final precise seek on release
        onSeek?.(dragFractionRef.current * duration);
      }
      isDraggingRef.current = false;
      setDragProgress(null);
      hideSeekPreview();
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [duration, onSeek, showSeekPreview, hideSeekPreview]);

  // Close quality menu when clicking outside
  useEffect(() => {
    if (!qualityMenuOpen) return;
    const handleClickOutside = (e) => {
      const inWrap = qualityMenuRef.current?.contains(e.target);
      const inPortal = qualityPortalRef.current?.contains(e.target);
      if (!inWrap && !inPortal) {
        setQualityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [qualityMenuOpen]);

  // Close speed menu when clicking outside
  useEffect(() => {
    if (!speedMenuOpen) return;
    const handleClickOutside = (e) => {
      const inWrap = speedMenuRef.current?.contains(e.target);
      const inPortal = speedPortalRef.current?.contains(e.target);
      if (!inWrap && !inPortal) {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [speedMenuOpen]);

  // Close subtitle menu when clicking outside
  useEffect(() => {
    if (!subtitleMenuOpen) return;
    const handleClickOutside = (e) => {
      const inWrap = subtitleMenuRef.current?.contains(e.target);
      const inPortal = subtitlePortalRef.current?.contains(e.target);
      if (!inWrap && !inPortal) {
        setSubtitleMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [subtitleMenuOpen]);

  // Hold controls visible while any menu is open on mobile
  const anyMenuOpen = mobileSettingsOpen || speedMenuOpen || qualityMenuOpen || subtitleMenuOpen;
  useEffect(() => {
    if (anyMenuOpen) {
      onHoldControls?.();
    } else {
      onReleaseControls?.();
    }
  }, [anyMenuOpen]);

  // Close mobile settings when clicking outside
  useEffect(() => {
    if (!mobileSettingsOpen) return;
    const handleClickOutside = (e) => {
      if (!mobileSettingsRef.current?.contains(e.target)) {
        setMobileSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mobileSettingsOpen]);

  // Position the popup menus (subtitles/quality/speed) as a fixed overlay.
  // In fullscreen, anchoring them to the bottom control bar clips them off the
  // bottom of the screen, so center them instead. On mobile (non-fullscreen) we
  // anchor under the button to escape overflow:hidden. Desktop non-fullscreen
  // renders inline (returns null).
  const getPortalStyle = useCallback((wrapRef) => {
    if (typeof window === 'undefined') return null;
    if (isFullscreen) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        transform: 'translate(-50%, -50%)',
        margin: 0,
        maxHeight: '70vh',
        overflowY: 'auto',
        zIndex: 2147483647,
      };
    }
    if (window.innerWidth > 767) return null;
    if (!wrapRef.current) return null;
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      position: 'fixed',
      top: rect.bottom + 6,
      bottom: 'auto',
      right: Math.max(8, window.innerWidth - rect.right),
      marginBottom: 0,
      maxHeight: '60vh',
      overflowY: 'auto',
      zIndex: 10000,
    };
  }, [isFullscreen]);

  const subtitlePortalStyle = subtitleMenuOpen ? getPortalStyle(subtitleMenuRef) : null;
  const qualityPortalStyle = qualityMenuOpen ? getPortalStyle(qualityMenuRef) : null;
  const speedPortalStyle = speedMenuOpen ? getPortalStyle(speedMenuRef) : null;

  const handleMarkerClick = useCallback((e, time, index) => {
    e.stopPropagation();
    onSeek?.(time);
    onMarkerSelect?.(index);
  }, [onSeek, onMarkerSelect]);

  // The WHOLE bar goes down for the length of a spot, not just the scrubber: rewind,
  // skip-forward and the time readout are all ways past an ad somebody paid for, and
  // a settings menu over a spot is chrome for a video that is not playing.
  //
  // The disclosure and the countdown are NOT in here — they live in PlayVideo — so
  // the viewer keeps being told what they are watching and how long is left.
  const show = (isVisible || hovering) && !adPlaying;

  return (
    <div
      className={`video-controls${show ? ' visible' : ''}`}
      onMouseEnter={() => { if (!isTouchDevice) setHovering(true); }}
      onMouseLeave={() => { if (!isTouchDevice) setHovering(false); }}
    >
      {/* Progress bar */}
      <div className={`vc-progress-row${adPlaying ? ' vc-ad-locked' : ''}${!adPlaying && adLocked ? ' vc-ad-imminent' : ''}`}>
        <div
          className="vc-progress-track"
          ref={trackRef}
          onMouseDown={handleTrackPointerDown}
          onTouchStart={handleTrackPointerDown}
          onMouseMove={(e) => { if (!isTouchDevice && previewVideoId) showSeekPreview(e.clientX); }}
          onMouseLeave={() => { if (!isDraggingRef.current) hideSeekPreview(); }}
        >
          {/* Scrub-preview thumbnail (low-res HLS, no storyboard) */}
          {previewVideoId && (
            <div
              className={`vc-seek-preview${preview.visible ? ' visible' : ''}${previewFrameless ? ' frameless' : ''}`}
              style={{ left: `${preview.leftPx}px`, width: `${previewWidth}px` }}
            >
              <video ref={previewVideoRef} className="vc-seek-preview-video" muted playsInline disablePictureInPicture />
              <div className="vc-seek-preview-time">{fmtPreviewTime(preview.time)}</div>
            </div>
          )}
          {replayHeatmapPath && (
            <svg
              className="vc-replay-heatmap"
              viewBox={replayHeatmapPath.viewBox}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={replayHeatmapPath.d} />
            </svg>
          )}
          {heatmapStyle && <div className="vc-heatmap" style={heatmapStyle} />}
          <div className="vc-buffered-fill" style={{ width: `${bufferedPercent}%` }} />
          <div className="vc-progress-fill" style={{ width: `${progress}%` }} />

          {/* Timeline markers */}
          {duration > 0 && resolvedMarkers.map((marker, i) => {
            const pos = (marker.time / duration) * 100;
            if (pos < 0 || pos > 100) return null;
            return (
              <div
                key={i}
                className={`vc-marker${hoveredMarker === i ? ' vc-marker--active' : ''}${marker.isVideo ? ' vc-marker--video' : ' vc-marker--comment'}`}
                style={{ left: `${pos}%` }}
                onClick={(e) => handleMarkerClick(e, marker.time, i)}
                onMouseEnter={() => setHoveredMarker(i)}
                onMouseLeave={() => setHoveredMarker(null)}
              >
                <div className="vc-marker-line" />
                <div className="vc-marker-avatar-wrap">
                  <img
                    className="vc-marker-avatar"
                    src={marker.avatar}
                    alt={marker.label || ''}
                  />
                  {marker.replyCount > 0 && (
                    <span className="vc-marker-reply-count">{marker.replyCount}</span>
                  )}
                </div>
                {hoveredMarker === i && marker.label && (
                  <div className="vc-marker-tooltip">
                    {marker.label}
                    {marker.replyCount > 0 && ` (${marker.replyCount} ${marker.replyCount === 1 ? 'reply' : 'replies'})`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls row */}
      <div className="vc-controls-row">
        <div className="vc-controls-left">
          <button className="vc-btn" onClick={onSeekBackward} title="Rewind 10s">
            <TbRewindBackward10 size={18} />
          </button>
          <button className="vc-btn vc-btn--play" onClick={onTogglePlay} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <FaPause size={14} /> : <FaPlay size={14} />}
          </button>
          <button className="vc-btn" onClick={onSeekForward} title="Forward 10s">
            <TbRewindForward10 size={18} />
          </button>
          <div className="vc-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
        <div className="vc-controls-right">
          {onReactToMoment && (
            <button className="vc-btn vc-btn--react" onClick={onReactToMoment} title="React to this moment">
              <FaVideo size={13} />
            </button>
          )}
          <div className="vc-volume-group">
            <button className="vc-btn" onClick={onToggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? <FaVolumeMute size={14} /> : <FaVolumeUp size={14} />}
            </button>
            {onVolumeChange && (
              <div className="vc-volume-slider-wrap">
                <input
                  ref={volSliderRef}
                  type="range"
                  className="vc-volume-slider"
                  min="0"
                  max="1"
                  step="0.01"
                  defaultValue={isMuted ? 0 : (volume ?? 1)}
                  onPointerDown={() => { volDraggingRef.current = true; }}
                  onPointerUp={() => { volDraggingRef.current = false; }}
                  onInput={(e) => {
                    const val = parseFloat(e.target.value);
                    const pct = (val * 100).toFixed(0);
                    e.target.style.background =
                      `linear-gradient(to right, var(--accent-primary, #e53935) ${pct}%, rgba(255,255,255,0.3) ${pct}%)`;
                    if (val > 0 && isMuted) onToggleMute();
                    onVolumeChange(val);
                  }}
                  onChange={() => {}}
                />
              </div>
            )}
          </div>
          {onCycleReactionSize && (
            <button className="vc-btn vc-btn--resize" onClick={onCycleReactionSize} title={`Player size: ${reactionSizeLabel || 'Standard'}`}>
              <TbArrowsMaximize size={15} />
              <span className="vc-size-label">{reactionSizeLabel || 'Standard'}</span>
            </button>
          )}
          {/* {onTogglePip && (
            <button className="vc-btn" onClick={onTogglePip} title="Picture-in-Picture">
              <TbPictureInPicture size={16} />
            </button>
          )} */}
          {onToggleAutoplay && (
            <button
              className={`vc-btn vc-btn--autoplay${autoplayNext ? ' active' : ''}`}
              onClick={onToggleAutoplay}
              title={autoplayNext ? 'Autoplay: on' : 'Autoplay: off'}
            >
              <TbPlayerTrackNextFilled size={15} />
            </button>
          )}
          {onToggleGlow && (
            <button
              className={`vc-btn vc-btn--glow${glowMode !== 'off' ? ' active' : ''}`}
              onClick={onToggleGlow}
              title={glowMode === 'off' ? 'Ambient light: subtle' : glowMode === 'page' ? 'Ambient light: vivid' : 'Ambient light: off'}
            >
              {glowMode === 'off' && <TbMoonFilled size={15} />}
              {glowMode === 'page' && <TbBulbFilled size={15} />}
              {glowMode === 'vivid' && <TbSunFilled size={15} />}
            </button>
          )}
          {subtitleLanguages && subtitleLanguages.length > 0 && (
            <div className="vc-subtitle-wrap" ref={subtitleMenuRef}>
              <button
                className={`vc-btn vc-btn--subtitle${selectedSubtitleLang ? ' active' : ''}`}
                onClick={() => { setSubtitleMenuOpen(o => !o); setQualityMenuOpen(false); }}
                title="Subtitles"
              >
                {selectedSubtitleLang ? <MdClosedCaption size={18} /> : <MdClosedCaptionOff size={18} />}
              </button>
              {subtitleMenuOpen && (
                <PortalIf condition={!!subtitlePortalStyle}>
                <div
                  className="vc-subtitle-menu"
                  ref={subtitlePortalStyle ? subtitlePortalRef : undefined}
                  style={subtitlePortalStyle || undefined}
                >
                  <button
                    className={`vc-subtitle-item${!selectedSubtitleLang ? ' active' : ''}`}
                    onClick={() => { onSubtitleChange?.(null); setSubtitleMenuOpen(false); }}
                  >
                    Off
                  </button>
                  {subtitleLanguages.map((sub) => {
                    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === sub.lang);
                    const label = langInfo ? langInfo.native : sub.lang;
                    return (
                      <button
                        key={sub.lang}
                        className={`vc-subtitle-item${selectedSubtitleLang === sub.lang ? ' active' : ''}`}
                        onClick={() => { onSubtitleChange?.(sub.lang); setSubtitleMenuOpen(false); }}
                      >
                        {label}
                        {subtitleLoading && selectedSubtitleLang === sub.lang && ' ...'}
                      </button>
                    );
                  })}
                  {subtitleStyle && onSubtitleStyleChange && (
                    <div className="vc-subtitle-style">
                      <div className="vc-subtitle-style-label">Font</div>
                      <div className="vc-subtitle-font-list">
                        {FONT_OPTIONS.map(f => (
                          <button
                            key={f.key}
                            className={`vc-subtitle-font-btn${subtitleStyle.fontFamily === f.key ? ' active' : ''}`}
                            style={{ fontFamily: SUBTITLE_FONTS[f.key] }}
                            onClick={() => onSubtitleStyleChange({ fontFamily: f.key })}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div className="vc-subtitle-style-label">Size</div>
                      <div className="vc-subtitle-style-row">
                        {[
                          { key: 'small', label: 'A' },
                          { key: 'medium', label: 'A' },
                          { key: 'large', label: 'A' },
                          { key: 'x-large', label: 'A' },
                          { key: 'xx-large', label: 'A' },
                        ].map(s => (
                          <button
                            key={s.key}
                            className={`vc-subtitle-size-btn${subtitleStyle.fontSize === s.key ? ' active' : ''}`}
                            onClick={() => onSubtitleStyleChange({ fontSize: s.key })}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <div className="vc-subtitle-style-label">Text Color</div>
                      <div className="vc-subtitle-style-row">
                        <input
                          type="color"
                          className="vc-subtitle-color-input"
                          value={subtitleStyle.color || '#ffffff'}
                          onChange={(e) => onSubtitleStyleChange({ color: e.target.value })}
                        />
                        <span className="vc-subtitle-color-hex">{subtitleStyle.color || '#ffffff'}</span>
                      </div>
                      <div className="vc-subtitle-style-label">Text Border</div>
                      <div className="vc-subtitle-style-row">
                        {[0, 2, 4, 8].map(w => (
                          <button
                            key={w}
                            className={`vc-subtitle-bg-btn${subtitleStyle.borderWidth === w ? ' active' : ''}`}
                            onClick={() => onSubtitleStyleChange({ borderWidth: w })}
                          >
                            {w === 0 ? 'Off' : `${w}px`}
                          </button>
                        ))}
                      </div>
                      {subtitleStyle.borderWidth > 0 && (
                        <>
                          <div className="vc-subtitle-style-label">Border Color</div>
                          <div className="vc-subtitle-style-row">
                            <input
                              type="color"
                              className="vc-subtitle-color-input"
                              value={subtitleStyle.borderColor || '#000000'}
                              onChange={(e) => onSubtitleStyleChange({ borderColor: e.target.value })}
                            />
                            <span className="vc-subtitle-color-hex">{subtitleStyle.borderColor || '#000000'}</span>
                          </div>
                        </>
                      )}
                      <div className="vc-subtitle-style-label">Background</div>
                      <div className="vc-subtitle-style-row">
                        {[0, 0.5, 0.7, 1].map(o => (
                          <button
                            key={o}
                            className={`vc-subtitle-bg-btn${subtitleStyle.bgOpacity === o ? ' active' : ''}`}
                            onClick={() => onSubtitleStyleChange({ bgOpacity: o })}
                          >
                            {o === 0 ? 'None' : `${Math.round(o * 100)}%`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </PortalIf>
              )}
            </div>
          )}
          {onPlaybackRateChange && (
            <div className="vc-speed-wrap" ref={speedMenuRef}>
              <button
                className={`vc-btn vc-btn--speed${playbackRate !== 1 ? ' active' : ''}`}
                onClick={() => { setSpeedMenuOpen(o => !o); setQualityMenuOpen(false); setSubtitleMenuOpen(false); }}
                title="Playback speed"
              >
                {playbackRate !== 1 ? `${playbackRate}x` : '1x'}
              </button>
              {speedMenuOpen && (
                <PortalIf condition={!!speedPortalStyle}>
                <div
                  className="vc-speed-menu"
                  ref={speedPortalStyle ? speedPortalRef : undefined}
                  style={speedPortalStyle || undefined}
                >
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                    <button
                      key={rate}
                      className={`vc-speed-item${playbackRate === rate ? ' active' : ''}`}
                      onClick={() => { onPlaybackRateChange(rate); setSpeedMenuOpen(false); }}
                    >
                      {rate === 1 ? 'Normal' : `${rate}x`}
                    </button>
                  ))}
                </div>
                </PortalIf>
              )}
            </div>
          )}
          {qualityLevels && qualityLevels.length > 0 && (
            <div className="vc-quality-wrap" ref={qualityMenuRef}>
              <button className="vc-btn" onClick={() => { setQualityMenuOpen(o => !o); setSubtitleMenuOpen(false); }} title="Quality">
                <FaCog size={14} />
              </button>
              {qualityMenuOpen && (
                <PortalIf condition={!!qualityPortalStyle}>
                <div
                  className="vc-quality-menu"
                  ref={qualityPortalStyle ? qualityPortalRef : undefined}
                  style={qualityPortalStyle || undefined}
                >
                  <button
                    className={`vc-quality-item${currentQuality === -1 ? ' active' : ''}`}
                    onClick={() => { onQualityChange?.(-1); setQualityMenuOpen(false); }}
                  >
                    Auto
                  </button>
                  {qualityLevels.map((q) => (
                    <button
                      key={q.index}
                      className={`vc-quality-item${currentQuality === q.index ? ' active' : ''}`}
                      onClick={() => { onQualityChange?.(q.index); setQualityMenuOpen(false); }}
                    >
                      {q.label || `${q.height}p`}
                    </button>
                  ))}
                </div>
                </PortalIf>
              )}
            </div>
          )}
          {/* Mobile-only settings gear — groups speed, quality, CC, autoplay */}
          <div className="vc-mobile-settings-wrap" ref={mobileSettingsRef}>
            <button
              className={`vc-btn vc-btn--mobile-settings${mobileSettingsOpen ? ' active' : ''}`}
              onClick={() => setMobileSettingsOpen(o => !o)}
              title="Settings"
            >
              <FaCog size={14} />
            </button>
            {mobileSettingsOpen && (
              <div className="vc-mobile-settings-menu">
                {onToggleAutoplay && (
                  <button
                    className={`vc-mobile-settings-item${autoplayNext ? ' active' : ''}`}
                    onClick={() => { onToggleAutoplay(); }}
                    title={autoplayNext ? 'Autoplay: on' : 'Autoplay: off'}
                  >
                    <TbPlayerTrackNextFilled size={15} />
                  </button>
                )}
                {subtitleLanguages && subtitleLanguages.length > 0 && (
                  <button
                    className={`vc-mobile-settings-item${selectedSubtitleLang ? ' active' : ''}`}
                    onClick={() => { setMobileSettingsOpen(false); setSubtitleMenuOpen(o => !o); }}
                    title="Subtitles"
                  >
                    {selectedSubtitleLang ? <MdClosedCaption size={18} /> : <MdClosedCaptionOff size={18} />}
                  </button>
                )}
                {onPlaybackRateChange && (
                  <button
                    className={`vc-mobile-settings-item${playbackRate !== 1 ? ' active' : ''}`}
                    onClick={() => { setMobileSettingsOpen(false); setSpeedMenuOpen(o => !o); }}
                    title="Playback speed"
                  >
                    {playbackRate !== 1 ? `${playbackRate}x` : '1x'}
                  </button>
                )}
                {qualityLevels && qualityLevels.length > 0 && (
                  <button
                    className={`vc-mobile-settings-item`}
                    onClick={() => { setMobileSettingsOpen(false); setQualityMenuOpen(o => !o); }}
                    title="Quality"
                  >
                    <MdHighQuality size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
          <button className="vc-btn" onClick={onToggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <FaCompress size={14} /> : <FaExpand size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VideoControls;
