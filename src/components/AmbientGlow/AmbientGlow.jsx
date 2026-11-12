import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './AmbientGlow.scss';

const GLOW_STORAGE_KEY = '3speak-ambient-glow';
const CANVAS_W = 32;
const CANVAS_H = 18;
const FPS_INTERVAL = 1000 / 10; // ~10 fps for smooth glow transitions

// Modes: 'off' → 'page' (subtle) → 'vivid' (bright) → 'off'
const MODES = ['off', 'page', 'vivid'];
// Subtle is the default (owner 2026-11-12).
export const DEFAULT_GLOW = 'page';
// Once per browser, whatever was stored before is set back to subtle; this
// marker records that it happened, so the viewer's own choice sticks after.
export const GLOW_RESET_KEY = '3speak-ambient-glow-reset-2026-11';

export const readStoredMode = () => {
  try {
    if (localStorage.getItem(GLOW_RESET_KEY) !== '1') {
      localStorage.setItem(GLOW_STORAGE_KEY, DEFAULT_GLOW);
      localStorage.setItem(GLOW_RESET_KEY, '1');
      return DEFAULT_GLOW;
    }
    const stored = localStorage.getItem(GLOW_STORAGE_KEY);
    if (MODES.includes(stored)) return stored;
    // Legacy values
    if (stored === '1' || stored === 'card') return 'page';
  } catch { /* storage blocked: the default */ }
  return DEFAULT_GLOW;
};

export const useAmbientGlow = () => {
  const [glowMode, setGlowMode] = useState(readStoredMode);

  const toggleGlow = useCallback(() => {
    setGlowMode(prev => {
      const idx = MODES.indexOf(prev);
      const next = MODES[(idx + 1) % MODES.length];
      try { localStorage.setItem(GLOW_STORAGE_KEY, next); } catch { /* not kept */ }
      return next;
    });
  }, []);

  return { glowMode, toggleGlow };
};

/**
 * AmbientGlow — renders a fixed canvas (portalled to document.body) that
 * samples video frames and CSS-blurs them into a full-page ambient light effect.
 * Desktop only — disabled on mobile via CSS.
 *
 * Modes:
 *   'off'   — no glow
 *   'page'  — subtle ambient glow (lower saturation)
 *   'vivid' — bright/saturated glow
 *
 * @param {() => HTMLVideoElement|null} getVideoEl — getter for the video element
 * @param {string} glowMode — 'off' | 'page' | 'vivid'
 */
const AmbientGlow = ({ getVideoEl, glowMode }) => {
  const canvasRef = useRef(null);
  const getVideoElRef = useRef(getVideoEl);
  getVideoElRef.current = getVideoEl;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (glowMode === 'off') {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    let rafId = null;
    let lastDraw = 0;

    const draw = (now) => {
      rafId = requestAnimationFrame(draw);
      if (now - lastDraw < FPS_INTERVAL) return;
      lastDraw = now;

      const videoEl = getVideoElRef.current?.();
      if (!videoEl || videoEl.readyState < 2) return;

      try {
        ctx.drawImage(videoEl, 0, 0, CANVAS_W, CANVAS_H);
      } catch {
        // CORS / SecurityError — ignore
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [glowMode]);

  const activeClass = glowMode !== 'off' ? ` active glow-${glowMode}` : '';

  return createPortal(
    <canvas
      className={`page-glow-canvas${activeClass}`}
      ref={canvasRef}
      aria-hidden="true"
    />,
    document.body
  );
};

export default AmbientGlow;
