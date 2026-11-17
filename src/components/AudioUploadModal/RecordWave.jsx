import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/ui';

// One bar per sample, newest on the right
const SAMPLE_MS = 50;
const BARS = 72;
// Below this peak (about -34 dBFS) for SILENT_MS the mic counts as silent: a
// recording that comes out silent while the mic light is on (owner
// 2026-11-17) shows up while it is made, not after
const QUIET = 0.02;
const SILENT_MS = 3000;

/**
 * An analyser on the mic stream, started before the recorder as the editor's
 * recorder does: on some phones a mic nothing else listens to records silence.
 * Returns { analyser, close } or null where Web Audio is missing.
 */
export function openRecordGraph(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !stream) return null;
  let ctx;
  try {
    ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    ctx.resume?.().catch(() => {});
    return { analyser, close: () => { try { ctx.close().catch?.(() => {}); } catch { /* closed */ } } };
  } catch {
    try { ctx?.close(); } catch { /* ignore */ }
    return null;
  }
}

/**
 * The live waveform under "Recording": the mic's level as scrolling bars, so
 * it is plain that sound is coming in, and a warning when none does (silence
 * for a few seconds, or the browser muted the track). `analyser` is the one
 * the modal hangs on the mic before the recorder starts (openRecordGraph).
 */
export default function RecordWave({ analyser, track }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    if (!analyser) return undefined;
    const data = new Uint8Array(analyser.fftSize);
    const peaks = new Array(BARS).fill(0);
    let lastLoud = Date.now();

    const draw = () => {
      const c = canvasRef.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = getComputedStyle(c).color;
      const step = w / BARS;
      const bar = Math.max(1, step * 0.55);
      peaks.forEach((p, i) => {
        // A little boost so speech fills the height; a flat line still shows
        const bh = Math.max(bar, Math.min(1, Math.sqrt(p) * 1.4) * h);
        g.beginPath();
        if (g.roundRect) g.roundRect(i * step, (h - bh) / 2, bar, bh, bar / 2);
        else g.rect(i * step, (h - bh) / 2, bar, bh);
        g.fill();
      });
    };

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      peaks.shift();
      peaks.push(peak);
      const now = Date.now();
      const muted = !!track?.muted;
      if (peak >= QUIET && !muted) lastLoud = now;
      setSilent(muted || now - lastLoud >= SILENT_MS);
      draw();
    };
    const timer = setInterval(tick, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [analyser, track]);

  return (
    <div className="audio-upload-rec-wave">
      <canvas ref={canvasRef} role="img" aria-label={t('audio.upload.source.level')} />
      {silent && (
        <p className="audio-upload-rec-silent" role="status">
          <Icon name="mic_off" size={16} />
          <span>{t('audio.upload.source.noSound')}</span>
        </p>
      )}
    </div>
  );
}
