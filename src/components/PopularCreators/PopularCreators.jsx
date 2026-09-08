import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { TRENDING_SORTED_URL } from '../../utils/config';
import { feedParams } from '../../utils/feedParams';
import { getFollowing } from '../../utils/hiveUtils';
import { getFollowers } from '../../hive-api/api';
import { followWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useAppStore } from '../../lib/store';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import './PopularCreators.scss';

// Every toast from this module is headed "Following"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Following');

// How many creators to surface, and how deep into trending to look for them.
const MAX_CARDS = 12;
const TRENDING_SAMPLE = 100;

const fmtFollowers = (n) => {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
};

/**
 * "Popular creators" — a standalone row on Discover.
 *
 * Creators are taken from the ORIGINAL trending feed (trendingSorted, which the
 * checker ranks on views/votes/comments), ranked by how many trending videos
 * they have, then filtered down to the ones the viewer doesn't already follow.
 * Following someone keeps their card in place (marked "Following") rather than
 * yanking it out from under the click.
 */
export default function PopularCreators() {
  const user = useAppStore((s) => s.user);
  const [followSet, setFollowSet] = useState(null); // null = not resolved yet
  const [justFollowed, setJustFollowed] = useState({}); // name -> true
  const [pending, setPending] = useState({});
  const [followerCounts, setFollowerCounts] = useState({});

  // Trending is cached hard — it's a slow-moving list and this row is decoration.
  const { data: trending } = useQuery({
    queryKey: ['popular-creators-trending'],
    queryFn: async () => {
      const res = await axios.get(`${TRENDING_SORTED_URL}?page=1&limit=${TRENDING_SAMPLE}${feedParams()}`);
      return res.data?.videos || res.data || [];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  // Who the viewer already follows. Logged out → empty set (we still show the
  // row; the follow button prompts a login).
  useEffect(() => {
    let alive = true;
    if (!user) { setFollowSet(new Set()); return undefined; }
    getFollowing(user, '', 1000)
      .then((list) => { if (alive) setFollowSet(new Set(list || [])); })
      .catch(() => { if (alive) setFollowSet(new Set()); });
    return () => { alive = false; };
  }, [user]);

  // Rank by number of trending videos, then by first appearance (i.e. how high
  // they charted), and drop anyone the viewer already follows or is themselves.
  const creators = useMemo(() => {
    if (!Array.isArray(trending) || followSet == null) return [];
    const seen = new Map();
    trending.forEach((v, i) => {
      const name = (v?.owner || v?.author || '').toLowerCase();
      if (!name) return;
      const cur = seen.get(name);
      if (cur) cur.count += 1;
      else seen.set(name, { name, count: 1, firstAt: i });
    });
    return [...seen.values()]
      .filter((c) => c.name !== (user || '').toLowerCase())
      .filter((c) => !followSet.has(c.name) || justFollowed[c.name])
      .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
      .slice(0, MAX_CARDS);
  }, [trending, followSet, user, justFollowed]);

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

  if (!creators.length) return null;

  return (
    <section className="popular-creators">
      <h3 className="pc-title">Popular creators</h3>
      <div className="pc-row">
        {creators.map((c) => {
          const followed = !!justFollowed[c.name];
          const followers = fmtFollowers(followerCounts[c.name]);
          return (
            <div className="pc-card" key={c.name}>
              <Link to={`/p/${c.name}`} className="pc-avatar" title={`@${c.name}`}>
                <HiveAvatar username={c.name} size={null} alt="" badgeSize={12} />
              </Link>
              <Link to={`/p/${c.name}`} className="pc-name" title={`@${c.name}`}>@{c.name}</Link>
              <span className="pc-followers">
                {followers != null ? `${followers} follower${followers === '1' ? '' : 's'}` : ' '}
              </span>
              <button
                type="button"
                className={`pc-follow${followed ? ' followed' : ''}`}
                onClick={() => !followed && handleFollow(c.name)}
                disabled={followed || !!pending[c.name]}
              >
                {followed ? 'Following' : (pending[c.name] ? '…' : 'Follow')}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
