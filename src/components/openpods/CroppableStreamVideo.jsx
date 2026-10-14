import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StreamVideo } from '@snapie/hangouts-react';
import './CroppableStreamVideo.scss';

// A stream counts as landscape above this width/height ratio. A little over 1 so
// a square-ish camera feed is left alone.
const LANDSCAPE_RATIO = 1.15;
// Pointer travel before a press becomes a drag (and stops being a tap).
const DRAG_SLOP_PX = 6;

/**
 * The SDK's <StreamVideo>, plus a viewer-side vertical crop for phones.
 *
 * The streamer sends ONE landscape program track. With `vertical` on, a
 * landscape stream fills the portrait screen (object-fit: cover) and the viewer
 * drags sideways to choose which slice of the frame they see. Nothing changes
 * on the wire or in the program track: the studio canvas also feeds the VOD and
 * the DVR clips, so the crop must only ever happen here.
 *
 * Whether the stream really IS landscape is read from the <video> element's
 * decoded size, not the room's `portrait` flag: a phone streamer's frame is
 * already 9:16 and gets no crop. `onOrientation(true|false|null)` reports it so
 * the page only offers the vertical/full switch when it means something.
 */
export default function CroppableStreamVideo({ vertical = false, onOrientation, showLiveBadge = false }) {
  const { t } = useTranslation();
  const wrapRef = useRef(null);
  const [videoEl, setVideoEl] = useState(null);
  const [aspect, setAspect] = useState(null); // decoded width / height, null until known
  const [cropX, setCropX] = useState(0.5);    // 0 = left edge, 1 = right edge
  const [showGuide, setShowGuide] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });   // the wrapper's size in CSS px
  const dragRef = useRef(null);
  const draggedRef = useRef(false);
  const guideTimerRef = useRef(null);

  const landscape = aspect == null ? null : aspect > LANDSCAPE_RATIO;
  const active = vertical && landscape === true;

  // The SDK mounts its <video> only once the program track arrives, and can
  // swap it (host reconnects, quality layer changes), so watch for it.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const find = () => setVideoEl(wrap.querySelector('video.hh-stream-video__el') || wrap.querySelector('video'));
    find();
    const mo = new MutationObserver(find);
    mo.observe(wrap, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!videoEl) return undefined;
    const read = () => {
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      if (w && h) setAspect(w / h);
    };
    read();
    // `resize` fires when the decoded size changes (simulcast layer switch,
    // streamer flips their phone), not just on first frame.
    videoEl.addEventListener('loadedmetadata', read);
    videoEl.addEventListener('resize', read);
    return () => {
      videoEl.removeEventListener('loadedmetadata', read);
      videoEl.removeEventListener('resize', read);
    };
  }, [videoEl]);

  const onOrientationRef = useRef(onOrientation);
  useEffect(() => { onOrientationRef.current = onOrientation; }, [onOrientation]);
  useEffect(() => { onOrientationRef.current?.(landscape); }, [landscape]);

  const flashGuide = useCallback((ms = 2200) => {
    setShowGuide(true);
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current);
    guideTimerRef.current = setTimeout(() => setShowGuide(false), ms);
  }, []);
  // Show the "drag to look around" hint each time the crop switches on.
  useEffect(() => {
    if (active) flashGuide(3500);
    return undefined;
  }, [active, flashGuide]);
  useEffect(() => () => { if (guideTimerRef.current) clearTimeout(guideTimerRef.current); }, []);

  // How many CSS pixels of the covered frame hang outside the box sideways.
  const overflowPx = aspect && box.h ? Math.max(0, box.h * aspect - box.w) : 0;

  /* The drag listens on the whole player box (this component's positioned
   * parent), not only on the video. On phones the chat overlay is a transparent
   * band over the middle of the picture whose message list takes touches, so a
   * listener on the video alone only ever saw drags above and below that band.
   * Real controls keep their touches: buttons, links, form fields, the rail and
   * the chat composer never start a pan. Vertical moves are left alone either way
   * (the stream pager's swipe, the chat's own scrolling). */
  const latestRef = useRef(null);
  latestRef.current = { active, cropX, overflowPx };
  useEffect(() => {
    const box = wrapRef.current?.parentElement;
    if (!box) return undefined;
    const KEEP = 'button, a, input, textarea, select, label, [role="button"], .actionSidebar, .hh-chat__input-row, .hh-chat__guest-prompt';
    const down = (e) => {
      const { active: on, cropX: x, overflowPx: overflow } = latestRef.current;
      if (!on || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target instanceof Element && e.target.closest(KEEP)) return;
      dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: x, overflow, dragging: false };
      draggedRef.current = false;
    };
    const move = (e) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.dragging) {
        // Mostly vertical = the swipe-to-next-stream gesture, not ours.
        if (Math.abs(dx) < DRAG_SLOP_PX || Math.abs(dx) < Math.abs(dy)) return;
        d.dragging = true;
        draggedRef.current = true;
        try { box.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
      }
      if (d.overflow <= 0) return;
      // The picture follows the finger: dragging right reveals the LEFT side.
      setCropX(Math.min(1, Math.max(0, d.start - dx / d.overflow)));
      flashGuide();
    };
    const end = (e) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      dragRef.current = null;
    };
    // A drag must not also count as the page's tap (which toggles the info block).
    const click = (e) => {
      if (!draggedRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      draggedRef.current = false;
    };
    box.addEventListener('pointerdown', down);
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('click', click, true);
    return () => {
      box.removeEventListener('pointerdown', down);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', end);
      box.removeEventListener('pointercancel', end);
      box.removeEventListener('click', click, true);
    };
  }, [flashGuide]);

  // Position bar: the full frame as a track, the visible slice as the thumb.
  const visibleFrac = active && aspect && box.h ? Math.min(1, box.w / (box.h * aspect)) : 1;
  const thumbLeft = (1 - visibleFrac) * cropX;

  return (
    <div
      ref={wrapRef}
      className={`ws-crop${active ? ' ws-crop--active' : ''}`}
      style={{ '--ws-crop-x': `${(cropX * 100).toFixed(2)}%` }}
    >
      <StreamVideo showLiveBadge={showLiveBadge} />
      {active && (
        <div className={`ws-crop__guide${showGuide ? ' is-visible' : ''}`} aria-hidden="true">
          <span className="ws-crop__hint">{t('misc.watchStream.dragToPan')}</span>
          <span className="ws-crop__track">
            <span
              className="ws-crop__thumb"
              style={{ left: `${(thumbLeft * 100).toFixed(2)}%`, width: `${(visibleFrac * 100).toFixed(2)}%` }}
            />
          </span>
        </div>
      )}
    </div>
  );
}
