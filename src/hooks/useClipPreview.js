import { useCallback, useEffect, useRef, useState } from 'react';
import { parseShortRange } from '../lib/clipIdeas';

/**
 * Play one range of the video and pause at its end ("Shorts from this video",
 * the watch page's Preview). `toggle(range)` starts it, or stops it when that
 * range is the one playing; `previewing` is the range playing now (or null).
 *
 * The player reports the old time for a beat after the seek, so the end and
 * scrub-away checks wait until playback is inside the range first. Scrubbing
 * out of the range ends the preview without pausing.
 *
 * @param currentTime  the player's time in content seconds
 * @param seek         (sec) => seek there and play
 * @param pause        () => pause the player
 */
export function useClipPreview({ currentTime, seek, pause }) {
  const [previewing, setPreviewing] = useState(null);
  const reached = useRef(false);
  const pauseRef = useRef(pause);
  useEffect(() => { pauseRef.current = pause; });

  const stop = useCallback(() => setPreviewing(null), []);

  const toggle = useCallback((range) => {
    if (previewing && previewing.start === range.start) {
      setPreviewing(null);
      pauseRef.current?.();
      return;
    }
    reached.current = false;
    setPreviewing({ start: range.start, end: range.end });
    seek?.(range.start);
  }, [previewing, seek]);

  useEffect(() => {
    if (!previewing || !Number.isFinite(currentTime)) return;
    const inside = currentTime >= previewing.start - 1 && currentTime < previewing.end;
    if (!reached.current) {
      if (inside) reached.current = true;
      return;
    }
    if (currentTime >= previewing.end) {
      pauseRef.current?.();
      setPreviewing(null);
    } else if (!inside) {
      setPreviewing(null);
    }
  }, [currentTime, previewing]);

  return { previewing, toggle, stop };
}

/**
 * "Make a Short" on the profile's Stats tab links to the watch page with
 * `short=S-E`. Once `ready` (the owner's page, the video's file known), hand that
 * range to `open` a single time and take the parameter out of the address, so a
 * reload does not open the editor again.
 */
export function useShortRangeParam({ ready, open }) {
  const done = useRef(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });
  useEffect(() => {
    if (done.current || !ready) return;
    const range = parseShortRange(window.location.search);
    if (!range) return;
    done.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('short');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    openRef.current(range);
  }, [ready]);
}
