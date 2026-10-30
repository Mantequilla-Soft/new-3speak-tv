import { useEffect, useRef } from 'react';

// Renders an embed-audio doc's pre-computed `waveform` (1-channel, ~800
// peak samples, values roughly in [-1, 1]) as canvas-drawn vertical bars.
// Bars before the playhead use the accent color; bars after use the muted.
// Click anywhere to seek — onSeek receives a fraction in [0, 1].
//
// Progress is read directly from the <audio> element on every animation
// frame instead of from a React prop: the browser only fires `timeupdate`
// roughly 4× per second, so any prop-driven approach produces visible
// stair-step motion no matter how fast we paint. Sampling el.currentTime
// each rAF tick gives true 60 fps motion.
//
// `markers` (fractions in [0, 1], playerMath.js chapterMarkers) draw a thin
// tick where each chapter starts. audioRef is read on every frame, so a swap
// of the player's <audio> element needs nothing here.
export default function Waveform({ samples, audioRef, duration, onSeek, markers }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const stateRef = useRef({ samples, audioRef, duration, markers });
  stateRef.current = { samples, audioRef, duration, markers };

  // Drag state lives in a ref so the rAF loop can read it without
  // re-subscribing. `active` flips on pointerdown and back on pointerup;
  // `fraction` is the latest pointer position in [0, 1] while dragging.
  const dragRef = useRef({ active: false, fraction: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;

    let stopped = false;
    let lastSamples = null;
    let lastProgress = -1;
    let lastDragActive = false;
    let lastDragFraction = -1;
    let lastMarkers = null;
    let cssW = 0;
    let cssH = 0;
    let dpr = window.devicePixelRatio || 1;
    let bars = null;          // Float32Array of normalized peak heights
    let barCount = 0;
    let barW = 0;
    let drawW = 0;
    let gap = 0;
    let accent = '#7B5CFA';
    let idle = 'rgba(255,255,255,0.25)';
    let tick = '#888';

    const ctx = canvas.getContext('2d');

    const readColors = () => {
      const cs = getComputedStyle(container);
      const a = cs.getPropertyValue('--accent-primary').trim();
      const m = cs.getPropertyValue('--text-muted').trim();
      const p = cs.getPropertyValue('--text-primary').trim();
      if (a) accent = a;
      if (m) idle = m;
      if (p) tick = p;
    };

    const computeBars = (samples) => {
      const N = samples.length;
      barCount = Math.min(N, Math.max(60, Math.floor(cssW / 3)));
      if (barCount <= 0) { bars = null; return; }
      barW = cssW / barCount;
      gap = Math.max(1, barW * 0.3);
      drawW = Math.max(1, barW - gap);
      const samplesPerBar = N / barCount;
      bars = new Float32Array(barCount);
      for (let i = 0; i < barCount; i++) {
        const start = Math.floor(i * samplesPerBar);
        const end = Math.min(N, Math.floor((i + 1) * samplesPerBar));
        let peak = 0;
        for (let j = start; j < end; j++) {
          const v = Math.abs(samples[j] || 0);
          if (v > peak) peak = v;
        }
        bars[i] = peak;
      }
    };

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return false;
      const newDpr = window.devicePixelRatio || 1;
      if (w === cssW && h === cssH && newDpr === dpr) return false;
      cssW = w; cssH = h; dpr = newDpr;
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastSamples = null;     // force bars + repaint
      lastProgress = -1;
      lastMarkers = null;
      return true;
    };

    const paint = () => {
      if (cssW === 0) return;
      const { samples, audioRef, duration, markers } = stateRef.current;
      if (!samples || samples.length === 0) return;

      const el = audioRef?.current;
      const t = el ? el.currentTime : 0;
      const progress = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;

      const drag = dragRef.current;

      const samplesChanged = samples !== lastSamples;
      const progressChanged = progress !== lastProgress;
      const dragChanged = drag.active !== lastDragActive
        || (drag.active && drag.fraction !== lastDragFraction);
      const markersChanged = markers !== lastMarkers;
      if (!samplesChanged && !progressChanged && !dragChanged && !markersChanged) return;

      if (samplesChanged) {
        computeBars(samples);
        lastSamples = samples;
      }
      if (!bars) return;
      lastProgress = progress;
      lastDragActive = drag.active;
      lastDragFraction = drag.fraction;
      lastMarkers = markers;

      ctx.clearRect(0, 0, cssW, cssH);
      const playedBars = Math.min(barCount, Math.floor(progress * barCount));
      const drawBar = (i) => {
        const h = Math.max(2, bars[i] * cssH);
        ctx.fillRect(i * barW + gap / 2, (cssH - h) / 2, drawW, h);
      };

      if (drag.active) {
        // While dragging, paint three regions:
        //   - 0..min(played, drag): full accent (already played, can't lose)
        //   - min..max: translucent accent (the seek "preview" rubber band)
        //   - max..end: idle
        const dragBars = Math.min(barCount, Math.floor(drag.fraction * barCount));
        const lo = Math.min(playedBars, dragBars);
        const hi = Math.max(playedBars, dragBars);

        ctx.fillStyle = accent;
        for (let i = 0; i < lo; i++) drawBar(i);

        if (lo < hi) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = accent;
          for (let i = lo; i < hi; i++) drawBar(i);
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = idle;
        for (let i = hi; i < barCount; i++) drawBar(i);
      } else {
        ctx.fillStyle = accent;
        for (let i = 0; i < playedBars; i++) drawBar(i);
        ctx.fillStyle = idle;
        for (let i = playedBars; i < barCount; i++) drawBar(i);
      }

      // Chapter starts: a thin full-height tick, half transparent.
      if (markers?.length) {
        ctx.fillStyle = tick;
        ctx.globalAlpha = 0.55;
        for (const f of markers) ctx.fillRect(Math.round(f * cssW) - 0.5, 0, 1, cssH);
        ctx.globalAlpha = 1;
      }
    };

    readColors();
    resize();

    const loop = () => {
      if (stopped) return;
      paint();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => { resize(); readColors(); });
    ro.observe(container);

    return () => { stopped = true; ro.disconnect(); };
  }, []);

  // Pointer-event drag: covers click + mouse drag + touch drag in one path.
  // setPointerCapture keeps the move/up events flowing to us even when the
  // pointer leaves the canvas while the user is still pressing.
  const fractionFor = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, fraction: fractionFor(e) };
  };

  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    dragRef.current = { active: true, fraction: fractionFor(e) };
  };

  const onPointerUp = (e) => {
    if (!dragRef.current.active) return;
    const finalF = fractionFor(e);
    dragRef.current = { active: false, fraction: 0 };
    if (onSeek) onSeek(finalF);
  };

  const onPointerCancel = () => {
    dragRef.current = { active: false, fraction: 0 };
  };

  return (
    <div
      ref={containerRef}
      className="audio-np-waveform"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
