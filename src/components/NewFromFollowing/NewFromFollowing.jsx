import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { NEW_FROM_FOLLOWING_URL } from '../../utils/config';
import { useAppStore } from '../../lib/store';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { Icon } from '../v2/Icon';
import { useTranslation } from 'react-i18next';
import './NewFromFollowing.scss';

/**
 * "New from creators you follow" (19c): a cyan strip that sums it up ("6 new
 * videos from people you follow", with their stacked avatars) above a rail of
 * creator chips for people whose
 * recent uploads this viewer hasn't watched yet.
 *
 * The checker (`/feeds/new-from-following`) does the work: last 7 days, creators
 * from the viewer's Hive following list, minus anything already in watch_history
 * or dismissed. It returns creators with unwatched shorts/videos counts, never a
 * video list, so this stays a couple of KB no matter how much was posted.
 *
 * No follow button by design: everyone here is someone you already follow.
 */

const REFRESH_MS = 5 * 60 * 1000;

// "3 shorts / 2 videos", dropping whichever side is zero, singular when it's one.
function countsLabel({ shorts = 0, videos = 0 }, t) {
  const parts = [];
  if (shorts) parts.push(t('feeds.newFromFollowing.shorts', { count: shorts }));
  if (videos) parts.push(t('common.units.videos', { count: videos }));
  return parts.join(' / ');
}

export default function NewFromFollowing() {
  const { t } = useTranslation();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const showNsfw = useAppStore((s) => s.showNsfw);

  const { data } = useQuery({
    queryKey: ['new-from-following', user, showNsfw],
    enabled: !!authenticated && !!user,
    staleTime: REFRESH_MS,
    gcTime: 2 * REFRESH_MS,
    retry: 1,
    queryFn: async () => {
      const params = { currentuser: user, limit: 30 };
      if (showNsfw) params.nsfw = 'true';
      const res = await axios.get(NEW_FROM_FOLLOWING_URL, { params });
      return res.data;
    },
  });

  const creators = data?.creators || [];

  // Arrow controls, same behaviour as the stories row above: each arrow only
  // appears when there's actually something to scroll to on that side.
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
    // Badge widths settle after the avatars load, which changes scrollWidth.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkArrows) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', checkArrows);
      ro?.disconnect();
    };
  }, [checkArrows, creators.length]);

  const scroll = (direction) => {
    railRef.current?.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' });
  };

  // Nothing new is the normal state for plenty of viewers — show nothing at all
  // rather than an empty box that never fills.
  if (!authenticated || !creators.length) return null;

  const total = creators.reduce((n, c) => n + (c.shorts || 0) + (c.videos || 0), 0);

  return (
    <section className="new-from-following" aria-label={t('feeds.newFromFollowing.aria')}>
      <div className="nff-head">
        <div className="nff-stack" aria-hidden="true">
          {creators.slice(0, 4).map((c) => (
            <HiveAvatar key={c.username} username={c.username} size="small" alt="" badgeSize={0} className="nff-stack-avatar" />
          ))}
        </div>
        <p className="nff-summary">
          <b>{t('feeds.newFromFollowing.summary', { count: total })}</b> {t('feeds.newFromFollowing.fromFollowing')}
        </p>
      </div>
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
        <div className="nff-rail" ref={railRef}>
          {creators.map((c) => (
            <Link
              key={c.username}
              // Straight to the tab that holds the new work when it's all shorts.
              to={c.videos ? `/@${c.username}` : `/@${c.username}?tab=shorts`}
              className="nff-chip"
              title={`@${c.username}`}
            >
              <HiveAvatar username={c.username} size="small" alt="" badgeSize={9} className="nff-chip-avatar" />
              <span className="nff-chip-text">
                <b>@{c.username}</b>
                <span>{countsLabel(c, t)}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
