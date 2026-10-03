import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatTimeAgo } from '../../i18n';
import { MdPlayArrow, MdPlaylistPlay, MdShare, MdAdd } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { audioCategoryIcon } from '../../utils/audioCategoryIcons';
// Reuse the existing tile styles defined in Audio.scss so this component is the
// single source of truth and stays visually identical across pages.
import '../../page/Audio.scss';

function audioThumb(item) {
  if (!item) return fallbackImg;
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  if (fixed && fixed !== fallbackImg && fixed !== '/images/speak.jpg') return fixed;
  // Fall back to the cover of the first playlist this audio was published into
  // (set by the checker via $lookup against the playlists collection).
  if (item.playlist_thumbnail) return item.playlist_thumbnail;
  return `https://images.hive.blog/u/${item.owner}/avatar/small`;
}

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const s = Math.floor(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtAgo(ds) {
  if (!ds) return '';
  return formatTimeAgo(ds, { style: 'narrow' });
}

// i18n keys, translated at render (never call t() at module level).
const CATEGORY_LABEL_KEYS = {
  podcast: 'audio.categories.podcast',
  voice_message: 'audio.categories.voice',
  song: 'audio.categories.music',
  audiobook: 'audio.categories.audiobook',
  interview: 'audio.categories.interview',
};

// Build a one-line metadata summary shown beneath the username:
//   - For music tracks with a genre, the genre replaces the type label
//   - Audio with no category falls back to "Voice"
//   - bpm is appended when present
function getMetaLine(item, t) {
  const parts = [];
  const isMusic = item.category === 'song' || item.category === 'music';
  if (isMusic && item.genre) {
    parts.push(String(item.genre));
  } else if (item.category && CATEGORY_LABEL_KEYS[item.category]) {
    parts.push(t(CATEGORY_LABEL_KEYS[item.category]));
  } else {
    parts.push(t(CATEGORY_LABEL_KEYS.voice_message));
  }
  if (item.bpm) parts.push(t('audio.tile.bpm', { bpm: item.bpm }));
  return parts.join(' · ');
}

/**
 * Self-contained audio tile. Plays through the global player by default.
 *
 * Props:
 *   item          — required, an `embed-audio` doc
 *   contextItems  — optional list used for next/prev autoplay (defaults to [item])
 *   onPlay        — override the default play behavior
 *   onAddToQueue  — override default queue behavior
 *   onAuthorClick — override default (navigate to /@owner)
 *   onAddToPlaylist, onShare, onVote — optional; the corresponding action button
 *                  is only rendered when its callback is provided
 *   loggedIn      — gate playlist button rendering (defaults to false)
 */
function AudioTile({
  item,
  contextItems,
  onPlay,
  onAddToQueue,
  onAuthorClick,
  onAddToPlaylist,
  onShare,
  onVote, // eslint-disable-line no-unused-vars
  loggedIn = false,
}) {
  const { t } = useTranslation();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const navigate = useNavigate();

  const isCurrent = audioCurrent?._id === item._id;
  const isPlaying = isCurrent && audioIsPlaying;

  // Hover-only action buttons can't be reached on touch devices, so a long-press
  // on the cover reveals them (and suppresses the play that the tap would fire).
  const tileRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  // Only check this author's follow status once the tile scrolls into view, so
  // a long list of audio tiles doesn't fire an RPC per tile up front.
  const [inView, setInView] = useState(false);
  const longPressTimer = useRef(null);
  const suppressClickRef = useRef(false);
  const wasTouchRef = useRef(false); // distinguishes touch-tap from desktop click
  const LONG_PRESS_MS = 450;

  const startLongPress = () => {
    clearTimeout(longPressTimer.current);
    suppressClickRef.current = false;
    wasTouchRef.current = true;
    longPressTimer.current = setTimeout(() => {
      suppressClickRef.current = true; // swallow the click that ends this press
      setRevealed(true);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => clearTimeout(longPressTimer.current);

  // Clean up a pending timer if the tile unmounts mid-press.
  useEffect(() => () => clearTimeout(longPressTimer.current), []);

  // Lazily flip `inView` the first time the tile nears the viewport.
  useEffect(() => {
    const el = tileRef.current;
    if (!el || inView) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { rootMargin: '150px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  // Once revealed, a tap anywhere outside this tile collapses the actions.
  useEffect(() => {
    if (!revealed) return;
    const onOutside = (e) => {
      if (tileRef.current && !tileRef.current.contains(e.target)) setRevealed(false);
    };
    document.addEventListener('touchstart', onOutside, true);
    document.addEventListener('mousedown', onOutside, true);
    return () => {
      document.removeEventListener('touchstart', onOutside, true);
      document.removeEventListener('mousedown', onOutside, true);
    };
  }, [revealed]);

  const handlePlay = () => {
    const wasTouch = wasTouchRef.current;
    wasTouchRef.current = false;
    // The long-press that revealed the actions must not also start playback.
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    setRevealed(false);

    // Mobile default: a short tap enqueues the track as the last item. It only
    // becomes the currently-playing item when the queue was empty (it's now the
    // first item) or nothing is currently playing — otherwise it just lines up.
    if (wasTouch) {
      const { audioQueue, audioIsPlaying } = useAppStore.getState();
      const makeCurrent = audioQueue.length === 0 || !audioIsPlaying;
      audioAddToQueue(item); // no-op if already queued; appends as last otherwise
      if (makeCurrent) audioPlay(item);
      return;
    }

    // Desktop (mouse click): keep the original play-now behavior.
    if (onPlay) return onPlay();
    audioPlay(item, contextItems || [item]);
  };
  const handleQueue = (e) => {
    e.stopPropagation();
    if (onAddToQueue) return onAddToQueue();
    audioAddToQueue(item);
  };
  const handleAuthor = (e) => {
    e.stopPropagation();
    if (onAuthorClick) return onAuthorClick();
    navigate(`/p/${item.owner}?tab=audio`);
  };

  const thumb = audioThumb(item);
  const metaLine = getMetaLine(item, t);

  const actions = (
    <div className="audio-tile-actions" onClick={(e) => e.stopPropagation()}>
      <button className="audio-tile-action-btn" onClick={handleQueue} title={t('audio.tile.queue')}><MdAdd size={14} /></button>
      {loggedIn && onAddToPlaylist && (
        <button className="audio-tile-action-btn" onClick={(e) => { e.stopPropagation(); onAddToPlaylist(); }} title={t('audio.tile.playlist')}><MdPlaylistPlay size={14} /></button>
      )}
      {onShare && (
        <button className="audio-tile-action-btn" onClick={(e) => { e.stopPropagation(); onShare(); }} title={t('common.actions.share')}><MdShare size={14} /></button>
      )}
    </div>
  );

  const cover = (
    <div
      className="audio-tile-cover"
      onClick={handlePlay}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img src={thumb} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
      <div className="audio-tile-overlay">
        {isPlaying ? <div className="audio-tile-eq"><span /><span /><span /></div> : <MdPlayArrow size={28} />}
      </div>
      <span className="audio-tile-duration">{fmt(item.duration)}</span>
      {actions}
    </div>
  );

  const body = (
    <div className="audio-tile-body">
      <span className="audio-tile-title" onClick={handlePlay}>{item.title || t('audio.untitled')}</span>
      <AuthorBadge author={item.owner} showFollow={inView} compact tabHint="audio" onClick={onAuthorClick} />
      {metaLine && <span className="audio-tile-meta"><i className={`audio-tile-meta-icon ${audioCategoryIcon(item.category)}`} /> {metaLine}</span>}
      <div className="audio-tile-footer">
        <div className="audio-tile-footer-left">
          {item.stats?.total_hive_reward > 0 && <PayoutAmount amount={item.stats.total_hive_reward} size={10} />}
          {item.plays > 0 && <span>{t('audio.tile.plays', { count: item.plays })}</span>}
        </div>
        <span className="audio-tile-time">{fmtAgo(item.createdAt)}</span>
      </div>
    </div>
  );

  return (
    <div ref={tileRef} className={`audio-tile${isCurrent ? ' audio-tile-active' : ''}${revealed ? ' audio-tile-revealed' : ''}`}>
      {cover}
      {body}
    </div>
  );
}

export function AudioTileSkeleton({ count = 5 }) {
  return [...Array(count)].map((_, i) => <div key={i} className="audio-tile-skeleton" />);
}

export default AudioTile;
