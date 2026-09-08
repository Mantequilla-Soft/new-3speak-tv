import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { SUGGESTED_CREATORS_URL } from '../../utils/config';
import { feedParams } from '../../utils/feedParams';
import { getFeedSeed } from '../../utils/feedSeed';
import { getFollowing } from '../../utils/hiveUtils';
import { getFollowers } from '../../hive-api/api';
import { followWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useAppStore } from '../../lib/store';
import { getTagLabel, getTagEmoji } from '../../utils/tagsV2';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import './SuggestedCreators.scss';

// Every toast from this module is headed "Following"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Following');

const FETCH_LIMIT = 20;   // the pool we pick from
const MAX_SHOWN = 15;     // how many tiles the scroller holds

const fmtFollowers = (n) => {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
};

// Small seeded shuffle so the discover tab's slice is random but STABLE within a
// session (keyed to the shared feed seed) — it doesn't re-shuffle on every render.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const a = [...arr];
  const rng = mulberry32((seed >>> 0) || 1);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * "Follow these" — a horizontal rail of creator tiles interleaved into the discover /
 * interests grids (checker `/feeds/suggested-creators`: interest-matched creators).
 *
 * Behaves like the shorts-stories row: a swipe-able scroller with a hidden scrollbar
 * and prev/next arrows on desktop (mobile uses swipe). Hidden entirely when logged out.
 */
export default function SuggestedCreators({ variant = 'discover' }) {
  const user = useAppStore((s) => s.user);
  const interests = useAppStore((s) => s.interests);
  const hasInterests = Array.isArray(interests) && interests.length > 0;

  const [followSet, setFollowSet] = useState(null);      // null = not resolved yet
  const [justFollowed, setJustFollowed] = useState({});  // name -> true
  const [pending, setPending] = useState({});
  const [followerCounts, setFollowerCounts] = useState({});

  // Horizontal scroller with prev/next arrows — same pattern as ShortsStories.
  const scrollRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const checkScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 10);
    setShowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);
  const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir === 'left' ? -240 : 240, behavior: 'smooth' });

  // ONE deterministic top-N fetch. feedParams() carries interests + currentuser, so the
  // server already excludes the caller and who they follow.
  const params = feedParams();
  const { data: suggested } = useQuery({
    queryKey: ['suggested-creators', params],
    enabled: hasInterests && !!user,
    queryFn: async () => {
      const res = await axios.get(`${SUGGESTED_CREATORS_URL}?limit=${FETCH_LIMIT}${params}`);
      return res.data?.creators || [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Belt-and-suspenders follow filter (the server excludes follows too, but its set
  // can be a cold miss on the first request).
  useEffect(() => {
    let alive = true;
    if (!user) { setFollowSet(new Set()); return undefined; }
    getFollowing(user, '', 1000)
      .then((list) => { if (alive) setFollowSet(new Set(list || [])); })
      .catch(() => { if (alive) setFollowSet(new Set()); });
    return () => { alive = false; };
  }, [user]);

  // The non-followed candidates, in the server's score order.
  const pool = useMemo(() => {
    if (!Array.isArray(suggested) || followSet == null) return [];
    return suggested
      .map((c) => ({
        name: (c.author || '').toLowerCase(),
        displayName: c.display_name || c.author,
        avatar: c.avatar,
        basis: c.basisTopic || (Array.isArray(c.matchedTopics) ? c.matchedTopics[0] : null),
      }))
      .filter((c) => c.name && c.name !== (user || '').toLowerCase())
      .filter((c) => !followSet.has(c.name) || justFollowed[c.name]);
  }, [suggested, followSet, user, justFollowed]);

  // What renders: discover reshuffles (seeded, stable per session); interests keeps order.
  const creators = useMemo(() => {
    if (!pool.length) return [];
    const ordered = variant === 'discover' ? seededShuffle(pool, getFeedSeed()) : pool;
    return ordered.slice(0, MAX_SHOWN);
  }, [pool, variant]);

  // Follower counts, once per creator that makes the cut.
  useEffect(() => {
    let alive = true;
    const missing = creators.map((c) => c.name).filter((n) => followerCounts[n] === undefined);
    if (!missing.length) return undefined;
    Promise.all(missing.map(async (n) => {
      try {
        const r = await getFollowers(n);
        return [n, r?.follower_count ?? null];
      } catch { return [n, null]; }
    })).then((pairs) => {
      if (!alive) return;
      setFollowerCounts((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => { alive = false; };
  }, [creators, followerCounts]);

  // Keep the arrow visibility in sync with scroll position + list/viewport changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    checkScrollButtons();
    el.addEventListener('scroll', checkScrollButtons, { passive: true });
    window.addEventListener('resize', checkScrollButtons);
    return () => {
      el.removeEventListener('scroll', checkScrollButtons);
      window.removeEventListener('resize', checkScrollButtons);
    };
  }, [creators, checkScrollButtons]);

  const handleFollow = useCallback(async (name) => {
    if (!isLoggedIn() || !user) {
      toast.error('Please login to follow creators');
      return;
    }
    setPending((p) => ({ ...p, [name]: true }));
    try {
      await followWithAioha(name, true);
      setJustFollowed((f) => ({ ...f, [name]: true }));
      setFollowSet((s) => new Set([...(s || []), name]));
      toast.success(`Following @${name}`);
    } catch (err) {
      toast.error(`Could not follow @${name}: ${err?.message || 'please try again'}`);
    } finally {
      setPending((p) => ({ ...p, [name]: false }));
    }
  }, [user]);

  // Hide entirely when logged out (interests can linger in the persisted store).
  if (!user || !hasInterests || !creators.length) return null;

  return (
    <section className="suggested-creators">
      <div className="sc-scroll-wrapper">
        {showLeft && (
          <button className="sc-scroll-btn left" onClick={() => scroll('left')} aria-label="Scroll left">
            <FaChevronLeft />
          </button>
        )}

        <div className="sc-row" ref={scrollRef}>
          {creators.map((c) => {
            const followed = !!justFollowed[c.name];
            const followers = fmtFollowers(followerCounts[c.name]);
            return (
              <div className="sc-card" key={c.name}>
                <Link to={`/p/${c.name}`} className="sc-avatar" title={`@${c.name}`}>
                  <HiveAvatar username={c.name} size={null} alt="" badgeSize={12} />
                </Link>
                <Link to={`/p/${c.name}`} className="sc-name" title={`@${c.name}`}>@{c.name}</Link>
                {c.basis && (
                  <span className="sc-basis" title={`Mostly posts ${getTagLabel(c.basis)}`}>
                    <span className="sc-basis-emoji">{getTagEmoji(c.basis)}</span>
                    {getTagLabel(c.basis)}
                  </span>
                )}
                <span className="sc-followers">
                  {followers != null ? `${followers} follower${followers === '1' ? '' : 's'}` : ' '}
                </span>
                <button
                  type="button"
                  className={`sc-follow${followed ? ' followed' : ''}`}
                  onClick={() => !followed && handleFollow(c.name)}
                  disabled={followed || !!pending[c.name]}
                >
                  {followed ? 'Following' : (pending[c.name] ? '…' : 'Follow')}
                </button>
              </div>
            );
          })}
        </div>

        {showRight && (
          <button className="sc-scroll-btn right" onClick={() => scroll('right')} aria-label="Scroll right">
            <FaChevronRight />
          </button>
        )}
      </div>
    </section>
  );
}
