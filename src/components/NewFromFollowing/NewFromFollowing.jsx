import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { NEW_FROM_FOLLOWING_URL } from '../../utils/config';
import { useAppStore } from '../../lib/store';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import { useTranslation } from 'react-i18next';
import './NewFromFollowing.scss';

/**
 * "New from creators you follow" — a rail of creator badges for people whose
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

  // No visible heading by request — the badges speak for themselves. The
  // aria-label keeps the section named for screen readers.
  return (
    <section className="new-from-following" aria-label={t('feeds.newFromFollowing.aria')}>
      <div className="nff-wrapper">
        {showLeft && (
          <button type="button" className="nff-scroll-btn left" onClick={() => scroll('left')} aria-label={t('feeds.scrollLeft')}>
            <FaChevronLeft />
          </button>
        )}
        {showRight && (
          <button type="button" className="nff-scroll-btn right" onClick={() => scroll('right')} aria-label={t('feeds.scrollRight')}>
            <FaChevronRight />
          </button>
        )}
        <div className="nff-rail" ref={railRef}>
        {creators.map((c) => (
          <AuthorBadge
            key={c.username}
            author={c.username}
            subtitle={countsLabel(c, t)}
            // Straight to the tab that holds the new work when it's all shorts.
            tabHint={c.videos ? undefined : 'shorts'}
          />
        ))}
        </div>
      </div>
    </section>
  );
}
