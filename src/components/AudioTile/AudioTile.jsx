import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import { useAppStore } from '../../lib/store';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
// The tile styles live in Audio.scss (shared with the playlist tile and the
// audio page), so the tile looks the same on every page that shows it.
import '../../page/Audio.scss';

function audioThumb(item) {
  if (!item) return fallbackImg;
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  if (fixed && fixed !== fallbackImg && fixed !== '/images/speak.jpg') return fixed;
  // Fall back to the cover of the first playlist this audio was published into
  // (set by the checker via $lookup against the playlists collection).
  if (item.playlist_thumbnail) return fixVideoThumbnail({ thumbnail: item.playlist_thumbnail });
  return `/img/u/${item.owner}/avatar/small`;
}

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const s = Math.floor(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Self-contained audio tile. Plays through the global player by default.
 *
 * Props:
 *   item          — required, an `embed-audio` doc
 *   contextItems  — optional list used for next/prev autoplay (defaults to [item])
 *   onPlay        — override the default play behavior
 *   onOpen        — optional; a click on the title opens the audio's own page
 *                  (the audio page's AudioItemView) instead of playing it
 *   onAddToQueue  — override default queue behavior
 *   onAuthorClick — override default (navigate to /@owner)
 *   onAddToPlaylist, onShare, onVote — optional; the corresponding action button
 *                  is only rendered when its callback is provided
 *   loggedIn      — gate playlist button rendering (defaults to false)
 *   trackNumber   — optional; shown before the title (e.g. inside a playlist)
 *   hideAlbum     — hide the "from <album>" line (the playlist page itself)
 *   hideFollow    — no Follow button (the page already names the creator)
 */
function AudioTile({
  item,
  contextItems,
  onPlay,
  onOpen,
  onAddToQueue,
  onAuthorClick,
  onAddToPlaylist,
  onShare,
  onVote, // eslint-disable-line no-unused-vars
  loggedIn = false,
  trackNumber,
  hideAlbum = false,
  hideFollow = false, // eslint-disable-line no-unused-vars
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);

  const isCurrent = audioCurrent?._id === item._id;
  const isPlaying = isCurrent && audioIsPlaying;

  // Hover-only action buttons can't be reached on touch devices, so a long-press
  // on the cover reveals them (and suppresses the play that the tap would fire).
  const tileRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  // Only check this author's follow status once the tile scrolls into view, so
  // a long list of audio tiles doesn't fire an RPC per tile up front.
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

    // While something else plays, a tap or click lines the track up at the end
    // of the queue.
    if (useAppStore.getState().audioQueueIfPlaying(item)) return;

    // Mobile default: a short tap enqueues the track as the last item and,
    // since nothing is playing, starts it.
    if (wasTouch) {
      audioAddToQueue(item); // no-op if already queued; appends as last otherwise
      audioPlay(item);
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

  const thumb = audioThumb(item);
  const goAuthor = (e) => {
    e.stopPropagation();
    if (onAuthorClick) onAuthorClick();
    else navigate(`/@${item.owner}?tab=audio`);
  };

  const actions = (
    <div className="audio-tile-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="audio-tile-action-btn" onClick={handleQueue} title={t('audio.tile.queue')} aria-label={t('audio.tile.queue')}><Icon name="queue_music" size={16} /></button>
      {loggedIn && onAddToPlaylist && (
        <button type="button" className="audio-tile-action-btn" onClick={(e) => { e.stopPropagation(); onAddToPlaylist(); }} title={t('audio.tile.playlist')} aria-label={t('audio.tile.playlist')}><Icon name="playlist_add" size={16} /></button>
      )}
      {onShare && (
        <button type="button" className="audio-tile-action-btn" onClick={(e) => { e.stopPropagation(); onShare(); }} title={t('common.actions.share')} aria-label={t('common.actions.share')}><Icon name="ios_share" size={16} /></button>
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
      <img src={thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
      {isPlaying && <span className="audio-tile-eq" aria-hidden="true"><span /><span /><span /></span>}
      <span className="audio-tile-play" aria-hidden="true"><Icon name={isPlaying ? 'pause' : 'play_arrow'} size={28} fill /></span>
      {actions}
    </div>
  );

  const body = (
    <div className="audio-tile-body">
      <span className="audio-tile-title" onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(); } : handlePlay}>
        {trackNumber != null && <span className="audio-tile-track-num num">{trackNumber}.</span>}
        {item.title || t('audio.untitled')}
      </span>
      {/* The creator and the length on one line (28e). */}
      <span className="audio-tile-by">
        <button type="button" className="audio-tile-author" onClick={goAuthor} title={`@${item.owner}`}>
          <img className="audio-tile-avatar" src={`/img/u/${item.owner}/avatar/small`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          <span>{item.owner}</span>
        </button>
        <span aria-hidden="true">·</span>
        <span className="audio-tile-dur num">{fmt(item.duration)}</span>
      </span>
      {/* The album (public playlist) the track belongs to, from the checker. */}
      {!hideAlbum && item.playlist_id && item.playlist_name && (
        <Link
          className="audio-tile-album"
          to={`/playlist/${item.playlist_id}`}
          onClick={(e) => e.stopPropagation()}
        >
          {t('audio.tile.fromAlbum', { album: item.playlist_name })}
        </Link>
      )}
    </div>
  );

  return (
    <div ref={tileRef} className={cx('audio-tile', isCurrent && 'audio-tile-active', revealed && 'audio-tile-revealed')}>
      {cover}
      {body}
    </div>
  );
}

/** 30 bar heights (px, 4 to 22) from a track's waveform samples. */
function miniWave(samples, bars = 30) {
  if (!Array.isArray(samples) || samples.length < bars) return null;
  const per = samples.length / bars;
  // The mean loudness of each slice: peaks alone flatten a mastered track.
  const levels = Array.from({ length: bars }, (_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) { sum += Math.abs(Number(samples[j]) || 0); n += 1; }
    return n ? sum / n : 0;
  });
  const top = Math.max(...levels) || 1;
  const low = Math.min(...levels);
  const span = top - low || 1;
  return levels.map((p) => 4 + Math.round(((p - low) / span) * 18));
}

/**
 * A ranked row of a top list (28e "Top tracks"): the rank, the cover, title
 * and creator, the track's waveform, its length and Add to queue. The row
 * playing is tinted; the cover and the title play it.
 */
export function AudioRankRow({ item, rank, contextItems, onAddToQueue, onOpen }) {
  const { t } = useTranslation();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const isCurrent = audioCurrent?._id === item._id;
  const isPlaying = isCurrent && audioIsPlaying;
  const wave = miniWave(item.waveform?.[0]);
  const play = () => {
    if (useAppStore.getState().audioQueueIfPlaying(item)) return;
    audioPlay(item, contextItems || [item]);
  };
  return (
    <div className={cx('audio-rank-row', isCurrent && 'is-current')}>
      <span className={cx('audio-rank-row__n num', rank === 1 && 'is-first')}>{rank}</span>
      <button type="button" className="audio-rank-row__cover" onClick={play} aria-label={isPlaying ? t('common.actions.pause') : t('common.actions.play')}>
        <img src={audioThumb(item)} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        {isPlaying && <span className="audio-tile-eq" aria-hidden="true"><span /><span /><span /></span>}
      </button>
      <span className="audio-rank-row__text">
        <b onClick={onOpen || play}>{item.title || t('audio.untitled')}</b>
        <span>{item.owner}</span>
      </span>
      <span className="audio-rank-row__wave" aria-hidden="true">
        {wave && wave.map((h, i) => <span key={i} style={{ height: h }} />)}
      </span>
      <span className="audio-rank-row__dur num">{fmt(item.duration)}</span>
      <button
        type="button"
        className="audio-rank-row__add"
        onClick={() => (onAddToQueue ? onAddToQueue() : audioAddToQueue(item))}
        title={t('audio.tile.queue')}
        aria-label={t('audio.tile.queue')}
      ><Icon name="playlist_add" size={20} /></button>
    </div>
  );
}

export function AudioTileSkeleton({ count = 5 }) {
  return [...Array(count)].map((_, i) => (
    <div key={i} className="audio-tile audio-tile-skeleton" aria-hidden="true">
      <div className="v2-skeleton audio-tile-skeleton__cover" />
      <div className="v2-skeleton is-line" />
      <div className="v2-skeleton is-line audio-tile-skeleton__short" />
    </div>
  ));
}

export default AudioTile;
