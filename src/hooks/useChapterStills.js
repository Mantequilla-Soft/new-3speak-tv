import { useEffect, useRef, useState } from 'react';
import { createLowResPreviewPlayer } from '../lib/lowResPreviewPlayer';

// How long the stills may take before the stream is let go (a slow gateway).
const GIVE_UP_MS = 45000;
// A chapter's first frame is often a cut or a fade: a second in reads better,
// never past half the chapter.
const INTO_CHAPTER_S = 1;

/**
 * Stills for the chapter cards under a video, from the moment each chapter
 * starts, with no stored images: the same hidden low-res copy of the video as
 * the seek preview (lib/lowResPreviewPlayer) jumps to each chapter in turn and
 * its frame is drawn into that chapter's canvas. Loads only once the chapters
 * come into view, and lets the stream go when every still is drawn.
 *
 *   const stills = useChapterStills(videoId, chapters);
 *   <div ref={stills.rootRef}> ... <canvas ref={stills.canvasRef(i)} /> ...
 *   <video ref={stills.videoRef} {...STILLS_VIDEO_PROPS} />
 *   stills.has(i) → true once chapter i has its picture.
 *
 * The canvases may stay "tainted" (a gateway without CORS): they are only
 * shown, never read back.
 */
export default function useChapterStills(videoId, chapters) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const canvases = useRef([]);
  const [drawn, setDrawn] = useState(() => new Set());
  const starts = (chapters || []).map((c) => Math.max(0, Number(c.start) || 0));
  const key = starts.join(',');

  useEffect(() => {
    setDrawn(new Set());
    const root = rootRef.current;
    const el = videoRef.current;
    const at = key ? key.split(',').map(Number) : [];
    if (!videoId || !root || !el || !at.length || typeof IntersectionObserver === 'undefined') return undefined;

    let player = null;
    let queue = [];
    let current = null;
    let stopped = false;
    let giveUp = 0;

    const target = (i) => {
      const next = at[i + 1];
      const room = next != null ? (next - at[i]) / 2 : INTO_CHAPTER_S;
      return at[i] + Math.min(INTO_CHAPTER_S, Math.max(0, room));
    };

    const draw = (i) => {
      const c = canvases.current[i];
      if (!c || !el.videoWidth) return;
      c.width = 320;
      c.height = Math.round((320 * el.videoHeight) / el.videoWidth) || 180;
      try {
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        setDrawn((d) => new Set(d).add(i));
      } catch { /* not decodable here: the card keeps its placeholder */ }
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(giveUp);
      el.removeEventListener('loadeddata', next);
      el.removeEventListener('seeked', onSeeked);
      try { player?.destroy(); } catch { /* already gone */ }
      player = null;
    };

    function next() {
      if (stopped) return;
      current = queue.shift();
      if (current == null) { stop(); return; }
      try { el.currentTime = target(current); } catch { next(); }
    }

    // The seek is done; paint once the frame is up (a frame callback where the
    // browser has one, a short wait elsewhere), then on to the next chapter.
    function onSeeked() {
      const i = current;
      let painted = false;
      const paint = () => { if (painted || stopped) return; painted = true; draw(i); next(); };
      if (typeof el.requestVideoFrameCallback === 'function') el.requestVideoFrameCallback(paint);
      setTimeout(paint, 400);
    }

    const start = () => {
      queue = at.map((_, i) => i);
      player = createLowResPreviewPlayer(el, { loop: false });
      el.addEventListener('loadeddata', next, { once: true });
      el.addEventListener('seeked', onSeeked);
      giveUp = setTimeout(stop, GIVE_UP_MS);
      player.load(videoId).catch(stop);
    };

    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      start();
    }, { rootMargin: '200px' });
    io.observe(root);

    return () => { io.disconnect(); stop(); };
  }, [videoId, key]);

  return {
    rootRef,
    videoRef,
    canvasRef: (i) => (node) => { canvases.current[i] = node; },
    has: (i) => drawn.has(i),
  };
}

/** The hidden video the stills come from: muted, never shown, never in the way. */
export const STILLS_VIDEO_PROPS = {
  muted: true,
  playsInline: true,
  preload: 'auto',
  disablePictureInPicture: true,
  'aria-hidden': true,
  tabIndex: -1,
  className: 'chapter-stills-source',
};
