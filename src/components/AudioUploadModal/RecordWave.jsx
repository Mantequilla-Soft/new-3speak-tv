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
export const QUIET_PEAK = QUIET;

/**
 * The audio context for the level graph, made in the record click itself: made
 * after the mic permission prompt, the click no longer counts and the context
 * stays suspended, the graph hears nothing and on a phone the recording came out
 * silent (first try failed, the second worked; owner 2026-11-17).
 */
export function newRecordContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    ctx.resume?.().catch(() => {});
    return ctx;
  } catch { return null; }
}

/**
 * An analyser on the mic stream, started before the recorder as the editor's
 * recorder does: on some phones a mic nothing else listens to records silence.
 * Takes the context from newRecordContext (else makes one). Returns
 * { analyser, ctx, attach, close } or null where Web Audio is missing; attach
 * moves the graph to a reopened mic on the same context.
 */
export function openRecordGraph(stream, ctx = newRecordContext()) {
  if (!ctx || !stream) { try { ctx?.close(); } catch { /* ignore */ } return null; }
  try {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    let source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    ctx.resume?.().catch(() => {});
    const attach = (next) => {
      try { source.disconnect?.(); } catch { /* gone */ }
      source = ctx.createMediaStreamSource(next);
      source.connect(analyser);
    };
    return { analyser, ctx, attach, close: () => { try { ctx.close().catch?.(() => {}); } catch { /* closed */ } } };
  } catch {
    try { ctx.close(); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Wait until the mic really delivers: the track live and not muted, the graph's
 * context running and its first samples in. A working mic is never exactly
 * zero, not even in a quiet room (its noise floor); a dead stream is, so the
 * check reads float samples: 8-bit ones round a quiet room to the silent
 * midpoint too. Gives up after `timeoutMs`. Resolves true when ready.
 */
export async function waitForMic(stream, graph, { timeoutMs = 2500, stepMs = 50, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const track = stream?.getAudioTracks?.()[0];
  const float = !!graph?.analyser.getFloatTimeDomainData;
  const data = graph ? new (float ? Float32Array : Uint8Array)(graph.analyser.fftSize) : null;
  for (let waited = 0; waited <= timeoutMs; waited += stepMs) {
    const live = !!track && track.readyState !== 'ended' && !track.muted;
    let heard = !graph;
    if (graph) {
      if (graph.ctx?.state === 'suspended') graph.ctx.resume?.().catch(() => {});
      if (!graph.ctx || graph.ctx.state === 'running') {
        if (float) {
          graph.analyser.getFloatTimeDomainData(data);
          heard = data.some((v) => v !== 0);
        } else {
          graph.analyser.getByteTimeDomainData(data);
          heard = data.some((v) => v !== 128);
        }
      }
    }
    if (live && heard) return true;
    await sleep(stepMs);
  }
  return false;
}

/**
 * The live waveform under "Recording": the mic's level as scrolling bars, so
 * it is plain that sound is coming in, and a warning when none does (silence
 * for a few seconds, or the browser muted the track). `analyser` is the one
 * the modal hangs on the mic before the recorder starts (openRecordGraph).
 */
export default function RecordWave({ analyser, track, onPeak }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const [silent, setSilent] = useState(false);
  const onPeakRef = useRef(onPeak);
  onPeakRef.current = onPeak;

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
      onPeakRef.current?.(peak);
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
