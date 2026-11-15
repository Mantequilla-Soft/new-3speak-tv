import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { fetchContinueWatching, hideFromContinueWatching } from '../../lib/continueWatching';
import { fixVideoThumbnail } from '../../utils/fixThumbnails';
import { formatRelativeDate } from '../../utils/dateFilters';
import { watchPath } from '../../utils/urls';
import { toastIn } from '../../utils/toast';
import { Icon } from '../v2/Icon';
import '../NewFromFollowing/NewFromFollowing.scss';
import './ContinueWatching.scss';

/**
 * Continue watching, next to "New from people you follow" on Home and drawn the
 * same way: one strip ("3 videos to continue watching", their thumbnails stacked)
 * and Show, which opens a row of the videos with how far in they were left.
 * It reuses that strip's classes (`nff-*`), so the two always match.
 *
 * All of it comes from the checker (lib/continueWatching.js): videos left between
 * 10 % and 75 %, newest first, on any device. Only for viewers opted into viewer
 * rewards; for everyone else the checker says `enabled: false` and nothing shows.
 * A card opens the video where it was left; its x takes it off the strip, with
 * Undo, on every device.
 */

const REFRESH_MS = 60 * 1000;
// A few seconds back, so the sentence it stopped in starts again.
const REWIND_S = 3;

const authorOf = (v) => String(v.author?.username || v.author || v.owner || '').replace(/^@/, '');

function ContinueCard({ video, onRemove }) {
  const { t } = useTranslation();
  const author = authorOf(video);
  const { position = 0, duration = 0, pct = 0, at } = video.progress || {};
  const from = Math.max(0, Math.floor(position - REWIND_S));
  const minutesLeft = Math.max(1, Math.ceil((duration - position) / 60));
  const title = video.title || video.permlink;
  return (
    <div className="cw-card">
      <Link className="cw-card-link" to={watchPath(author, video.permlink, from > 0 ? `t=${from}` : '')} title={title}>
        <span className="cw-card-thumb">
          <img src={fixVideoThumbnail(video)} alt="" loading="lazy" />
          <span
            className="cw-card-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label={t('feeds.continueWatching.progress', { pct: Math.round(pct) })}
          >
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </span>
        </span>
        <span className="cw-card-text">
          <b>{title}</b>
          <span>@{author} · {t('audio.podcasts.continue.left', { minutes: minutesLeft })}</span>
          {at && <span>{t('misc.watched.watchedAt', { when: formatRelativeDate(at) })}</span>}
        </span>
      </Link>
      <button
        type="button"
        className="cw-card-remove"
        onClick={() => onRemove(video)}
        title={t('feeds.continueWatching.remove')}
        aria-label={t('feeds.continueWatching.remove')}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export default function ContinueWatching() {
  const { t } = useTranslation();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const queryClient = useQueryClient();
  const key = ['continue-watching', user];

  const { data } = useQuery({
    queryKey: key,
    enabled: !!authenticated && !!user,
    staleTime: REFRESH_MS,
    retry: 1,
    queryFn: () => fetchContinueWatching(user),
  });
  const videos = data?.enabled ? data.videos : [];

  // Folded to the one-line strip until asked for, like the follow strip.
  const [open, setOpen] = useState(false);

  // Gone from the strip at once; Undo puts it back where it was.
  const remove = (video) => {
    const k = video._progressKey;
    const before = queryClient.getQueryData(key);
    if (!before) return;
    queryClient.setQueryData(key, { ...before, videos: before.videos.filter((v) => v._progressKey !== k) });
    const putBack = () => {
      queryClient.setQueryData(key, (now) => {
        if (!now || now.videos.some((v) => v._progressKey === k)) return now;
        const keep = new Set([k, ...now.videos.map((v) => v._progressKey)]);
        return { ...now, videos: before.videos.filter((v) => keep.has(v._progressKey)) };
      });
    };
    hideFromContinueWatching(user, k).then(() => {
      toastIn('Video').success(t('feeds.continueWatching.removed'), {
        action: {
          label: t('engagement.cardMenu.undo'),
          onClick: () => {
            putBack();
            hideFromContinueWatching(user, k, false).catch(() => queryClient.invalidateQueries({ queryKey: key }));
          },
        },
      });
    }).catch(() => {
      putBack();
      toastIn('Video').error(t('feeds.continueWatching.removeFailed'));
    });
  };

  // Arrows over the rail's ends, as on the follow strip.
  const railRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const checkArrows = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 10);
    setShowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    checkArrows();
    el.addEventListener('scroll', checkArrows);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkArrows) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', checkArrows);
      ro?.disconnect();
    };
  }, [checkArrows, videos.length, open]);
  const scroll = (direction) => {
    railRef.current?.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' });
  };

  if (!authenticated || !videos.length) return null;

  return (
    <section className="new-from-following continue-watching" aria-label={t('feeds.continueWatching.aria')}>
      <div className="nff-head">
        <div className="nff-stack cw-stack" aria-hidden="true">
          {videos.slice(0, 3).map((v) => (
            <img key={v._progressKey} src={fixVideoThumbnail(v)} alt="" className="cw-stack-thumb" loading="lazy" />
          ))}
        </div>
        <p className="nff-summary">
          <b>{t('common.units.videos', { count: videos.length })}</b> {t('feeds.continueWatching.rest')}
        </p>
        <button
          type="button"
          className="nff-toggle"
          aria-expanded={open}
          aria-controls="cw-rail"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('feeds.newFromFollowing.hide') : t('feeds.newFromFollowing.show')}
        </button>
      </div>
      {open && (
        <div className="nff-wrapper">
          {showLeft && (
            <button type="button" className="nff-scroll-btn left" onClick={() => scroll('left')} aria-label={t('feeds.scrollLeft')}>
              <Icon name="chevron_left" size={20} />
            </button>
          )}
          {showRight && (
            <button type="button" className="nff-scroll-btn right" onClick={() => scroll('right')} aria-label={t('feeds.scrollRight')}>
              <Icon name="chevron_right" size={20} />
            </button>
          )}
          <div className="nff-rail cw-rail" id="cw-rail" ref={railRef}>
            {videos.map((v) => <ContinueCard key={v._progressKey} video={v} onRemove={remove} />)}
          </div>
        </div>
      )}
    </section>
  );
}
