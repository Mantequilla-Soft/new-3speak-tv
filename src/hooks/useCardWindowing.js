import { useCallback, useMemo, useRef, useState } from "react";

// Feed windowing: a card far from the viewport keeps its slot in the grid, at the
// height it last had, but drops everything inside it (thumbnail, text, badges).
// Infinite feeds never unmount anything, so a long scroll used to keep hundreds of
// full cards and their decoded thumbnails in memory, which is what makes an older
// phone or laptop slow down. The grid itself is untouched: same CSS, same
// interleaved rails, same hover preview, because the card element never goes away.
//
// One IntersectionObserver per grid. The page scrolls on the window, so the root is
// the viewport and the margin keeps 1.5 screens rendered above and below.
const NEAR_MARGIN = "150% 0px";

// The first cards of a grid always render in full, so the top of a feed never
// shows an empty slot, even for a frame.
const ALWAYS_RENDERED = 12;

// Heights of hidden cards, keyed by window width too: a card's height follows its
// column width. Lives at module level so a feed that remounts (back to Discover)
// can start its far-away cards as slots of the right height, which keeps the saved
// scroll position landing where it was. Bounded; oldest entries go first.
const MAX_HEIGHTS = 3000;
const heights = new Map();
const heightKey = (key) => `${typeof window !== "undefined" ? window.innerWidth : 0}:${key}`;
function rememberHeight(key, h) {
  const k = heightKey(key);
  heights.delete(k);
  heights.set(k, h);
  if (heights.size > MAX_HEIGHTS) heights.delete(heights.keys().next().value);
}

// For the grid: `null` when windowing is off, otherwise the shared observer.
export function useCardWindowing(enabled) {
  const subs = useRef(new Map());
  const observerRef = useRef(null);
  return useMemo(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return null;
    return {
      observe(node, onChange) {
        if (!observerRef.current) {
          observerRef.current = new IntersectionObserver((entries) => {
            for (const e of entries) subs.current.get(e.target)?.(e.isIntersecting, e.boundingClientRect.height);
          }, { rootMargin: NEAR_MARGIN });
        }
        subs.current.set(node, onChange);
        observerRef.current.observe(node);
        // No observer teardown in an effect on purpose: each card unobserves
        // itself, and StrictMode's double mount would otherwise disconnect an
        // observer the remounted cards had already subscribed to.
        return () => {
          subs.current.delete(node);
          observerRef.current?.unobserve(node);
        };
      },
    };
  }, [enabled]);
}

// For each card: `hiddenHeight` is null while the card renders in full, else the
// height its empty slot keeps. `ref` goes on the card element, composed with any
// ref the card already had (the hover preview observes the same node).
export function useWindowedCard(windowing, key, index, ownRef) {
  const [hiddenHeight, setHiddenHeight] = useState(() => {
    if (!windowing || index < ALWAYS_RENDERED) return null;
    return heights.get(heightKey(key)) ?? null;
  });
  // `ownRef` is the hover preview's observer callback, which is stable.
  const ref = useCallback((node) => {
    ownRef?.(node);
    if (!node || !windowing) return undefined;
    return windowing.observe(node, (near, h) => {
      if (near || index < ALWAYS_RENDERED) { setHiddenHeight(null); return; }
      if (!(h > 0)) return;
      rememberHeight(key, h);
      setHiddenHeight(h);
    });
  }, [windowing, key, index, ownRef]);
  // A grid can stop windowing while mounted (it turned mixed): show everything.
  return { ref, hiddenHeight: windowing ? hiddenHeight : null };
}
