import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize, Minimize } from 'lucide-react';
import './StreamFullscreenButton.scss';

const PLAYER_BOX = '.ws-player, .live-stream-player';
const boxOf = (el) => el?.closest(PLAYER_BOX) || el?.parentElement || null;

/**
 * Fullscreen for a live stream on the desktop layouts (the /watch stream page
 * and the live player on an announced stream's watch page).
 *
 * It fullscreens the PLAYER BOX it sits in (the nearest `.ws-player` /
 * `.live-stream-player`; LiveKit wraps the watch-page player's children in a
 * div of its own, so the direct parent is not always the box), rather than the bare
 * <video>: the watermark, the ad layer (ticker, banner, pre-roll) and the live
 * badge are siblings in that box and have to come along. A vertical stream
 * keeps its shape, letterboxed by the stream video's own `contain` fit.
 *
 * Renders nothing where the browser cannot fullscreen an element (iPhone
 * Safari), rather than a button that does nothing.
 */
export default function StreamFullscreenButton() {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [isFull, setIsFull] = useState(false);
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => {
    if (!supported) return undefined;
    const sync = () => {
      const box = boxOf(ref.current);
      setIsFull(!!box && document.fullscreenElement === box);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [supported]);

  const toggle = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxOf(ref.current);
    if (!box) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => { /* already left */ });
    } else {
      box.requestFullscreen?.().catch(() => { /* refused: nothing to do */ });
    }
  }, []);

  if (!supported) return null;
  const label = isFull ? t('player.controls.exitFullscreen') : t('player.controls.fullscreen');
  return (
    <button
      ref={ref}
      type="button"
      className="stream-fs-btn"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {isFull ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
}
