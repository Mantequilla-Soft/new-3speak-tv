import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { MAX_PULL, THRESHOLD, pageHasOwnPullToRefresh } from './PullToRefresh';
import './PullToRefresh.scss';

// Pages where a reload would throw work away, or where dragging down already
// means something: uploads and editors, Shorts and live streams (swipe between
// them), the studio, chat, the automations editor, OBS and embed pages.
const SKIP = [
  /^\/(upload|studio|embed-studio|editvideo|edit-scheduled|draft|firstupload|publish-backlog|translate)(\/|$)/,
  /^\/(shorts|openpods|automations|chat|galaxy|egress-stream|obs|embed|image|test)(\/|$)/,
  /^\/(watch|l)\/[^/]+/,
  /^\/live\/clips\//,
];

const NOT_FROM = 'input, textarea, select, [contenteditable="true"], video, canvas, [role="slider"], [data-no-ptr]';

/** A scrolled box between the finger and the page: that box scrolls, the page does not refresh. */
function insideScrolledBox(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
  }
  return false;
}

/**
 * Drag down at the top of any page to reload it, on phones and tablets. The
 * feeds keep their own pull-to-refresh (it reloads just the feed); this one
 * covers every other page, with the same tile. The browser's own pull is off
 * (`overscroll-behavior: none`, it shifted fixed elements on iOS) and an
 * installed app has none, so without this most pages could not be refreshed.
 */
export default function GlobalPullToRefresh() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { uploading, videoUploadStatus } = useEmbedUpload();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gesture = useRef(null);
  const pullRef = useRef(0);
  // The latest values, for listeners added once.
  const live = useRef({});
  live.current = { pathname, busy: uploading || videoUploadStatus === 'uploading', refreshing };

  useEffect(() => {
    const touchScreen = () => window.matchMedia?.('(hover: none) and (max-width: 1024px)').matches;
    const set = (d) => { pullRef.current = d; setPull(d); };

    const onStart = (e) => {
      gesture.current = null;
      const { pathname: path, busy, refreshing: now } = live.current;
      if (now || busy || e.touches.length !== 1 || !touchScreen()) return;
      if (window.scrollY > 0 || pageHasOwnPullToRefresh() || SKIP.some((re) => re.test(path))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest(NOT_FROM) || insideScrolledBox(target)) return;
      gesture.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: false };
    };
    const onMove = (e) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.touches[0].clientX - g.x;
      const dy = e.touches[0].clientY - g.y;
      if (!g.decided && Math.abs(dx) + Math.abs(dy) > 8) {
        g.decided = true;
        // Sideways or upwards: not a pull.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { gesture.current = null; set(0); return; }
      }
      if (window.scrollY > 0) { gesture.current = null; set(0); return; }
      set(Math.max(0, Math.min(dy * 0.5, MAX_PULL)));
    };
    const onEnd = () => {
      if (!gesture.current) return;
      gesture.current = null;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        set(THRESHOLD);
        window.location.reload();
        return;
      }
      set(0);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (pull <= 10 && !refreshing) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div className="ptr-global" style={{ transform: `translate(-50%, ${pull}px)`, opacity: Math.min(pull / THRESHOLD, 1) }} aria-live="polite">
      <div className={`ptr-spinner ${ready && !refreshing ? 'ptr-ready' : ''} ${refreshing ? 'ptr-active' : ''}`}>
        <Icon name={refreshing ? 'progress_activity' : 'refresh'} size={24} />
      </div>
      <span className="ptr-label">
        {refreshing ? t('misc.pullToRefresh.refreshing') : ready ? t('misc.pullToRefresh.release') : t('misc.pullToRefresh.pull')}
      </span>
    </div>
  );
}
