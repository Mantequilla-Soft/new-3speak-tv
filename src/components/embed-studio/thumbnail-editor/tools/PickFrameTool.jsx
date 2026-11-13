import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../v2/ui';
import { Hint, Slider, ToolButton } from './controls';
import { captureVideoFrame } from '../../../../utils/frameCapture';
import { reportClientError } from '../../../../utils/reportClientError';
import { isMobileDevice } from '../../../../utils/videoThumbnails';

// The real frame rate isn't known in the browser; 30 fps is close enough for
// "one frame" (at 60 fps it steps two, at 24 a bit under one).
const FRAME_SEC = 1 / 30;

const fmt = (sec) => {
  const s = Math.max(0, sec || 0);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * Scrub the uploaded video to any moment and add that frame to the options.
 * Not an edit of the thumbnail: it adds a picture to choose from (onPickFrame).
 */
export default function PickFrameTool({ videoFile, onPickFrame }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(videoFile);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [videoFile]);

  const seek = (to) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const at = Math.min(Math.max(0, to), Math.max(0, duration - 0.01));
    v.currentTime = at;
    setTime(at);
    setFailed(false);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  // The frame by whichever way works here (utils/frameCapture.js: mobile devices
  // ask our API, desktops read the visible player). Failures, and fallbacks off the
  // usual way, are reported with what each way gave, so they show up in the
  // checker's client_errors.
  const takeFrame = async () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setBusy(true);
    setFailed(false);
    let result = { dataUrl: null, method: null, tried: [] };
    try {
      result = await captureVideoFrame(v, { file: videoFile });
    } catch (err) {
      result.tried.push(`error ${err?.message || err}`);
    }
    setBusy(false);
    const usual = isMobileDevice() ? 'server' : '2d';
    if (result.method !== usual) {
      reportClientError({
        kind: 'render',
        error: { message: `[thumbnail-capture] ${result.method || 'none'} | ${result.tried.join(', ')}` },
      });
    }
    if (result.dataUrl) onPickFrame(result.dataUrl);
    else setFailed(true);
  };

  if (unplayable) return <Hint>{t('upload.thumbnail.pickFrame.unavailable')}</Hint>;

  return (
    <div className="thumb-pick">
      <video
        ref={videoRef}
        className="thumb-pick__video"
        src={url || undefined}
        muted
        playsInline
        preload="auto"
        onClick={togglePlay}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          // Shows a picture instead of an empty box (iOS paints nothing before a seek).
          e.currentTarget.currentTime = Math.min(0.1, e.currentTarget.duration / 2);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setUnplayable(true)}
      />

      <div className="thumb-pick__controls">
        <div className="thumb-pick__scrub">
          <Slider
            id="thumb-pick-pos"
            min={0}
            max={duration || 0}
            step="any"
            value={Math.min(time, duration || 0)}
            onChange={seek}
            label={t('upload.thumbnail.pickFrame.position')}
          />
          <span className="thumb-field__value">{fmt(time)} / {fmt(duration)}</span>
        </div>

        <div className="thumb-tool-row">
          <ToolButton icon={playing ? 'pause' : 'play_arrow'} onClick={togglePlay} disabled={!duration}
            title={playing ? t('upload.thumbnail.pickFrame.pause') : t('upload.thumbnail.pickFrame.play')} />
          <ToolButton icon="keyboard_double_arrow_left" onClick={() => seek(time - 1)} disabled={!duration} title={t('upload.thumbnail.pickFrame.back1s')} />
          <ToolButton icon="chevron_left" onClick={() => seek(time - FRAME_SEC)} disabled={!duration} title={t('upload.thumbnail.pickFrame.prevFrame')} />
          <ToolButton icon="chevron_right" onClick={() => seek(time + FRAME_SEC)} disabled={!duration} title={t('upload.thumbnail.pickFrame.nextFrame')} />
          <ToolButton icon="keyboard_double_arrow_right" onClick={() => seek(time + 1)} disabled={!duration} title={t('upload.thumbnail.pickFrame.forward1s')} />
        </div>

        <Button
          variant="primary"
          size={44}
          block
          icon="add_photo_alternate"
          loading={busy}
          className="thumb-btn--block"
          onClick={takeFrame}
          disabled={!duration || busy}
        >
          {t('upload.thumbnail.pickFrame.use')}
        </Button>

        {failed
          ? <Hint>{t('upload.thumbnail.pickFrame.failed')}</Hint>
          : <Hint>{t('upload.thumbnail.pickFrame.hint')}</Hint>}
      </div>
    </div>
  );
}
