import { useCallback, useRef, useState } from 'react';
import { fractionAt, shouldLiveSeek } from '../lib/timelineScrub';

/**
 * Press and drag on a timeline to scrub (mouse, touch and pen, one path of
 * pointer events). The pointer is captured, so the drag keeps going outside the
 * bar; the page does not scroll (the bar has `touch-action: none`) and the
 * press is stopped from reaching the swipe gestures around it.
 *
 *   const scrub = useTimelineScrub({ duration, onSeek, local })
 *   <div {...scrub.handlers}> ... {scrub.dragging && <Tip time={scrub.time} />}
 *
 * `onSeek(seconds)` runs on release (and, for a `local` file, throttled while
 * dragging). `fractionRef` holds the live fraction for a canvas drawn per frame.
 * Cancelled (another gesture took the pointer): nothing is seeked.
 */
export default function useTimelineScrub({ duration, onSeek, local = false, disabled = false }) {
  const [drag, setDrag] = useState(null); // fraction while dragging, else null
  const fractionRef = useRef(null);
  const lastSeekRef = useRef(0);
  const d = duration > 0 ? duration : 0;

  const move = useCallback((e) => {
    const f = fractionAt(e.clientX, e.currentTarget.getBoundingClientRect());
    fractionRef.current = f;
    setDrag(f);
    return f;
  }, []);

  const onPointerDown = useCallback((e) => {
    if (disabled || !d || (e.button != null && e.button !== 0)) return;
    // The bar's own swipes (open, close, skip) and the page must not see it.
    e.stopPropagation();
    if (e.pointerType !== 'mouse') e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    move(e);
  }, [disabled, d, move]);

  const onPointerMove = useCallback((e) => {
    if (fractionRef.current == null) return;
    e.stopPropagation();
    const f = move(e);
    const now = Date.now();
    if (shouldLiveSeek({ local, now, lastAt: lastSeekRef.current })) {
      lastSeekRef.current = now;
      onSeek?.(f * d);
    }
  }, [move, local, onSeek, d]);

  const end = useCallback((e, commit) => {
    if (fractionRef.current == null) return;
    e.stopPropagation();
    const f = commit ? fractionAt(e.clientX, e.currentTarget.getBoundingClientRect()) : null;
    fractionRef.current = null;
    setDrag(null);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    if (commit && d) onSeek?.(f * d);
  }, [onSeek, d]);

  const onPointerUp = useCallback((e) => end(e, true), [end]);
  const onPointerCancel = useCallback((e) => end(e, false), [end]);
  // The click that follows a drag must not reach the bar (it would open the player).
  const onClick = useCallback((e) => e.stopPropagation(), []);

  return {
    dragging: drag != null,
    fraction: drag,
    time: drag != null ? drag * d : null,
    fractionRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick },
  };
}
