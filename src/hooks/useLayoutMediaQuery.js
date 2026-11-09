import { useEffect, useState } from 'react';

// Is anything on the page fullscreen right now? Covers the standard API,
// the old webkit prefix, and iOS Safari's native video player, which goes
// fullscreen without ever setting document.fullscreenElement.
function anyFullscreen(iosVideoFs) {
  if (typeof document === 'undefined') return false;
  return iosVideoFs || !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// After leaving fullscreen the phone still has to rotate back, so the width
// right at the exit event is the landscape one. Wait for the turn to settle
// before re-reading, or the page flashes the wide layout (and reloads any
// player in it) on its way back to the phone one.
const SETTLE_MS = 500;

/**
 * matchMedia(query).matches as state, for picking which layout to RENDER.
 *
 * Frozen while something is fullscreen: putting a video fullscreen on a phone
 * rotates it to landscape, which pushes the width past the phone breakpoint.
 * Swapping layouts at that moment unmounts the <video>, and fullscreen ends
 * with it (the channel trailer did exactly this).
 */
export default function useLayoutMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(query);
    let iosVideoFs = false;
    let settleTimer = null;

    const sync = () => {
      if (!anyFullscreen(iosVideoFs)) setMatches(mq.matches);
    };
    const syncLater = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(sync, SETTLE_MS);
    };
    const onFsChange = () => {
      // Entering: nothing to do, the freeze is the point. Leaving: re-read once
      // the rotation back is done.
      if (!anyFullscreen(iosVideoFs)) syncLater();
    };
    // iOS fires these on the <video> and they don't bubble, hence capture.
    const onIosBegin = () => { iosVideoFs = true; };
    const onIosEnd = () => { iosVideoFs = false; syncLater(); };

    mq.addEventListener('change', sync);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('webkitbeginfullscreen', onIosBegin, true);
    document.addEventListener('webkitendfullscreen', onIosEnd, true);
    sync();
    return () => {
      clearTimeout(settleTimer);
      mq.removeEventListener('change', sync);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('webkitbeginfullscreen', onIosBegin, true);
      document.removeEventListener('webkitendfullscreen', onIosEnd, true);
    };
  }, [query]);

  return matches;
}
