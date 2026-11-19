import { useEffect, useState } from 'react';
import { useAppStore } from './store';

// Data saver (idea F11): no video previews on cards or in the Home Spotlight,
// and videos start at 360p or lower. The viewer's own choice in Settings wins;
// without one (`dataSaver` null in the store) it follows the connection: on
// when the browser asks to save data (Save-Data, Android's data saver) or the
// connection is 2G.

/** The browser asks to save data, or the connection is 2G. */
export function connectionWantsSaving() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (!c) return false;
  return !!c.saveData || /^(slow-)?2g$/.test(String(c.effectiveType || ''));
}

/** Data saver right now, outside React. */
export function isDataSaverOn(choice = useAppStore.getState().dataSaver) {
  if (choice === true) return true;
  if (choice === false) return false;
  return connectionWantsSaving();
}

/** Data saver, following the setting and connection changes. */
export function useDataSaver() {
  const choice = useAppStore((s) => s.dataSaver);
  const [auto, setAuto] = useState(connectionWantsSaving);
  useEffect(() => {
    const c = typeof navigator !== 'undefined' ? navigator.connection : null;
    if (!c?.addEventListener) return undefined;
    const update = () => setAuto(connectionWantsSaving());
    c.addEventListener('change', update);
    return () => c.removeEventListener('change', update);
  }, []);
  if (choice === true) return true;
  if (choice === false) return false;
  return auto;
}

/** The highest quality a video starts at while data saver is on. */
export const DATA_SAVER_MAX_HEIGHT = 360;

/**
 * The quality level a video starts at: the stored height (a number as text, or
 * 'auto'), or the nearest level below it, or the lowest when every level is
 * above it; capped at DATA_SAVER_MAX_HEIGHT with data saver. null = automatic.
 */
export function pickStartLevel(levels, storedPref, saver = false) {
  if (!levels?.length) return null;
  let height = storedPref && storedPref !== 'auto' ? parseInt(storedPref, 10) : null;
  if (saver) height = Math.min(height || Infinity, DATA_SAVER_MAX_HEIGHT);
  if (!height || !Number.isFinite(height)) return null;
  let best = null;
  for (const l of levels) {
    if (l.height === height) return l;
    if (l.height < height && (!best || l.height > best.height)) best = l;
  }
  return best || levels.reduce((a, b) => (a.height < b.height ? a : b));
}
