import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Film, Link2, User, X } from 'lucide-react';
import AccountImg from '../HiveAvatar/AccountImg';
import { fetchLinkMeta } from '../Chat/chatLinks';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { activeLinksAt } from '../../utils/videoTimeline';
import './TimelineToasters.scss';

// More than this at once would cover the picture; the rest wait their turn.
const MAX_VISIBLE = 3;

/** Where an in-app toaster goes, or null for an external link. */
export function timelineLinkPath(link) {
  if (link.kind === 'video') return `/@${link.author}/${link.permlink}`;
  if (link.kind === 'profile') return `/@${link.account}`;
  return null;
}

// The thumbnail of a linked 3Speak video. Not stored in the post (the format
// keeps only author/permlink/title), so it is looked up once the toaster shows;
// fetchLinkMeta caches per post, so a toaster that comes back costs nothing.
function useVideoThumb(link, enabled) {
  const [thumb, setThumb] = useState(null);
  const author = link.kind === 'video' ? link.author : null;
  const permlink = link.kind === 'video' ? link.permlink : null;
  useEffect(() => {
    if (!enabled || !author || !permlink) return undefined;
    let alive = true;
    fetchLinkMeta({ kind: 'post', author, permlink })
      .then((m) => { if (alive && m?.thumbnail) setThumb(fixVideoThumbnail({ thumbnail: m.thumbnail })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [author, permlink, enabled]);
  return thumb;
}

/** The look of one toaster, shared by the watch page and the editor's lists. */
export function TimelineLinkFace({ link, thumb = null }) {
  const { t } = useTranslation();
  const lookedUp = useVideoThumb(link, link.kind === 'video' && !thumb);
  const img = thumb || lookedUp;
  let media;
  let kindLabel;
  let titleText;
  let sub;
  if (link.kind === 'video') {
    kindLabel = t('watch.timeline.video');
    titleText = link.title || `${link.author}/${link.permlink}`;
    sub = `@${link.author}`;
    media = img ? (
      <img className="tl-toast__thumb" src={img} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
    ) : (
      <span className="tl-toast__icon"><Film size={18} /></span>
    );
  } else if (link.kind === 'profile') {
    kindLabel = t('watch.timeline.profile');
    titleText = `@${link.account}`;
    sub = null;
    media = <AccountImg className="tl-toast__avatar" account={link.account} alt="" loading="lazy" />;
  } else {
    kindLabel = t('watch.timeline.link');
    titleText = link.title || link.site || link.url;
    sub = link.site || null;
    media = <span className="tl-toast__icon"><Link2 size={18} /></span>;
  }
  return (
    <>
      {media}
      <span className="tl-toast__text">
        <span className="tl-toast__kind">
          {link.kind === 'profile' ? <User size={11} /> : null}
          {kindLabel}
        </span>
        <span className="tl-toast__title">{titleText}</span>
        {sub && <span className="tl-toast__sub">{sub}</span>}
      </span>
    </>
  );
}

/**
 * The creator's link toasters, top-right over the video.
 *
 * Driven by `currentTime` in CONTENT seconds (the same clock the chapters use),
 * so a stitched ad never shifts them; the caller hides the whole layer while a
 * spot plays. Inside the player wrapper, which is the fullscreen element, so they
 * show in fullscreen too.
 *
 * Two modes:
 *  - watch (default): a toaster is a real link. 3Speak videos and profiles open
 *    in the app (after `onBeforeNavigate`, which pauses), anything else in a new
 *    tab. A dismissed toaster stays gone until `resetKey` changes (a new video).
 *  - preview (`onSelect` given): the timeline editor. A click selects the link in
 *    the editor instead of leaving the page; `selectedIndex` is highlighted.
 */
export default function TimelineToasters({
  links,
  currentTime,
  hidden = false,
  top = 10,
  resetKey,
  onBeforeNavigate,
  onSelect,
  selectedIndex = null,
  compact = false,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => new Set());

  useEffect(() => { setDismissed(new Set()); }, [resetKey]);

  const shown = useMemo(() => {
    if (hidden || !Array.isArray(links) || !links.length) return [];
    const now = Number(currentTime) || 0;
    const active = new Set(activeLinksAt(links, now));
    return links
      .map((link, index) => ({ link, index, key: `${index}:${link.at}:${link.kind}` }))
      .filter(({ link, key }) => active.has(link) && !dismissed.has(key))
      .slice(-MAX_VISIBLE);
  }, [links, currentTime, hidden, dismissed]);

  if (!shown.length) return null;

  // Clicks and taps must not reach the player's click surface underneath, which
  // would toggle playback (or the controls) as the viewer reaches for a link.
  const stop = (e) => e.stopPropagation();

  const dismiss = (key) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDismissed((prev) => new Set(prev).add(key));
  };

  const openInApp = (path) => (e) => {
    e.stopPropagation();
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onBeforeNavigate?.();
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* not fullscreen */ }
    navigate(path);
  };

  return (
    <div
      className={`tl-toasts${compact ? ' tl-toasts--compact' : ''}`}
      style={{ top }}
      role="region"
      aria-label={t('watch.timeline.region')}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {shown.map(({ link, index, key }) => {
        const path = timelineLinkPath(link);
        const cls = `tl-toast tl-toast--${link.kind}${selectedIndex === index ? ' is-selected' : ''}`;
        const face = <TimelineLinkFace link={link} />;
        let body;
        if (onSelect) {
          body = (
            <button type="button" className="tl-toast__main" onClick={(e) => { e.stopPropagation(); onSelect(index); }}>
              {face}
            </button>
          );
        } else if (path) {
          body = (
            <a className="tl-toast__main" href={path} onClick={openInApp(path)}>
              {face}
            </a>
          );
        } else {
          body = (
            <a
              className="tl-toast__main"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              title={t('watch.timeline.opensNewTab')}
              onClick={(e) => { e.stopPropagation(); onBeforeNavigate?.(); }}
            >
              {face}
            </a>
          );
        }
        return (
          <div key={key} className={cls}>
            {body}
            <button type="button" className="tl-toast__close" onClick={dismiss(key)} aria-label={t('watch.timeline.dismiss')}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
