import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveStreams } from './useLiveStreams';

// Matched to the shorts player so the gesture feels the same across both
// full-bleed surfaces (see Short.jsx).
const MIN_SWIPE_PX = 50;
const COOLDOWN_MS = 700;

/**
 * Swipe / scroll between live streams on the full-bleed stream page, the way
 * the shorts feed pages between videos.
 *
 * Deliberately inert when there is nowhere to go: with no OTHER stream live,
 * the gesture does nothing at all rather than bouncing, reloading the current
 * stream, or dumping the viewer back to a feed — leaving a broadcast you're
 * watching is not something a stray scroll should be able to do.
 *
 * Returns a ref to attach to the element the gesture should be read from.
 */
export function useLiveStreamPager({ currentRoom, enabled = true }) {
  const navigate = useNavigate();
  // Same list as the feeds, excluded hosts left out: a swipe from someone
  // else's stream must not land on theirs.
  const streams = useLiveStreams();
  const containerRef = useRef(null);
  const lockRef = useRef(false);

  // Everything currently live, in the order /streams ranked them.
  const rooms = useMemo(
    () => streams.map((s) => s.roomName).filter(Boolean),
    [streams],
  );
  const hasNext = rooms.some((r) => r !== currentRoom);

  const go = useCallback((dir) => {
    if (!hasNext || lockRef.current) return;
    const others = rooms.filter((r) => r !== currentRoom);
    if (others.length === 0) return;

    // Page relative to where we are in the full list so the order is stable and
    // wraps. A stream that isn't in the list at all (unlisted, or it just
    // ended) has no position, so start from the top instead.
    const idx = rooms.indexOf(currentRoom);
    let target;
    if (idx === -1) {
      target = dir > 0 ? others[0] : others[others.length - 1];
    } else {
      const next = (idx + dir + rooms.length) % rooms.length;
      target = rooms[next] === currentRoom ? others[0] : rooms[next];
    }
    if (!target) return;

    lockRef.current = true;
    setTimeout(() => { lockRef.current = false; }, COOLDOWN_MS);
    navigate(`/watch/${target}`);
  }, [currentRoom, hasNext, navigate, rooms]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled || !hasNext) return undefined;

    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < 8) return;   // trackpad jitter
      e.preventDefault();
      go(e.deltaY > 0 ? 1 : -1);
    };

    let startY = null;
    const onTouchStart = (e) => { startY = e.targetTouches?.[0]?.clientY ?? null; };
    const onTouchEnd = (e) => {
      const endY = e.changedTouches?.[0]?.clientY;
      if (startY == null || endY == null) return;
      const distance = startY - endY;
      startY = null;
      if (Math.abs(distance) < MIN_SWIPE_PX) return;
      // Swipe UP (finger travels up, positive distance) = next, same as shorts.
      go(distance > 0 ? 1 : -1);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, go, hasNext]);

  return { containerRef, hasNext };
}
