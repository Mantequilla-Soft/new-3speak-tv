import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../lib/store';
import { getFollowing } from '../utils/hiveUtils';

import { fetchAllEndpoints } from '../utils/hangoutsEndpoints';
import { FEED_EXCLUDED_HOSTS } from '../utils/config';

/**
 * Currently-live OpenPods standalone streams, mapped to Card3-compatible
 * objects so they can be prepended into the normal video grids as regular
 * tiles (with a LIVE badge). Card3 special-cases `_liveStream` items to link
 * to /watch/<roomName> and skip hover-preview/duration.
 *
 * `following: true` filters to streamers the signed-in user follows (Follow
 * feed). Includes unlisted streams for now (the /streams endpoint does).
 *
 * Hosts in FEED_EXCLUDED_HOSTS are dropped by default, since every caller but
 * one is a discovery feed. `includeAllHosts: true` opts out — used by the
 * watch-page pager, which navigates between streams rather than surfacing them.
 *
 * `standby: true` also keeps the rooms that are open but not broadcasting yet
 * (the /live page's Scheduled tab), each marked `_standby`.
 */
export function useLiveStreams({ following = false, includeAllHosts = false, standby = false } = {}) {
  const [streams, setStreams] = useState([]);
  const [followSet, setFollowSet] = useState(null); // null = not loaded
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);

  useEffect(() => {
    let alive = true;
    if (!following) { setFollowSet(null); return undefined; }
    if (!user) { setFollowSet(new Set()); return undefined; }
    getFollowing(user, '', 1000)
      .then((list) => { if (alive) setFollowSet(new Set(list || [])); })
      .catch(() => { if (alive) setFollowSet(new Set()); });
    return () => { alive = false; };
  }, [following, user]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      // Aggregated across every configured OpenPods deployment, so the feeds
      // show live sessions wherever they're hosted.
      fetchAllEndpoints('/streams')
        .then((list) => { if (alive) setStreams(Array.isArray(list) ? list : []); })
        .catch(() => { if (alive) setStreams([]); });
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return useMemo(() => {
    let list = standby ? streams : streams.filter((s) => s.live);
    // Hive-only rooms are for signed-in Hive users; a guest shouldn't even see
    // them in discovery. Public rooms show to everyone. (Unlisted never reaches
    // the client — the server drops it from /streams.)
    if (!authenticated) list = list.filter((s) => s.visibility !== 'hive-internal');
    // Keep excluded hosts out of the discovery feeds (discover / follow / new).
    if (!includeAllHosts && FEED_EXCLUDED_HOSTS.size) {
      list = list.filter((s) => !FEED_EXCLUDED_HOSTS.has(String(s.host || '').toLowerCase()));
    }
    if (following) list = followSet ? list.filter((s) => followSet.has(s.host)) : [];
    return list.map((s) => ({
      _liveStream: true,
      // A conference ROOM, not a standalone stream — Card3 links it to the
      // OpenPods room UI (join to talk) rather than the watch page.
      _openpodRoom: s.mode === 'conference',
      roomName: s.name,
      permlink: s.name, // used only for React keys / dedupe here
      author: s.host,
      owner: s.host,
      title: s.title,
      thumbnail: s.thumbnail,
      created_at: s.createdAt,
      // Lands in Card3's normal view-count slot, where it reads as "watching
      // now" rather than lifetime views (the card labels it, see Card3).
      views: s.viewers ?? 0,
      ...(standby ? { _standby: !s.live } : {}),
    }));
  }, [streams, following, followSet, authenticated, includeAllHosts, standby]);
}
