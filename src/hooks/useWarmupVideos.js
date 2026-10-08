import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchIncubationFeed } from '../lib/incubation';

const EMPTY = [];

/**
 * Recent posts from warm-up users (on 3Speak, not yet on Hive), shaped for Card3.
 *
 * The home feed puts these right after the promoted videos as ordinary cards.
 * They have no votes, views or payout to rank on, so they get a fixed slot rather
 * than a made-up score, and Card3 marks them with a leaf (`_incubation`) so the
 * viewer can tell they come from new users and have not been through the same
 * ranking as the rest of the feed.
 *
 * The viewer's own posts are left out: this exists to put NEW people in front of
 * everyone else, and seeing yourself in it is useless. Fails quietly to an empty
 * list, the feed must not depend on it.
 */
export function useWarmupVideos({ enabled = true, limit = 8, ownHandle = null } = {}) {
  const { data = EMPTY } = useQuery({
    queryKey: ['warmup-feed-videos', limit],
    queryFn: async () => {
      try {
        const d = await fetchIncubationFeed(limit);
        return d?.items || EMPTY;
      } catch {
        return EMPTY;
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    if (!enabled) return EMPTY;
    const mine = ownHandle ? String(ownHandle).toLowerCase() : null;
    // Card3 reads author/permlink/title/thumbnail/duration/created, so the shape
    // it wants is the shape it gets. `_incubation` marks these as off-chain for
    // anything downstream that needs to know (no payout slot, the leaf badge).
    return data
      .filter((it) => {
        const who = it.author?.handle || it.handle;
        return !!who && (!mine || String(who).toLowerCase() !== mine);
      })
      .map((it) => ({
        author: it.author?.handle || it.handle,
        permlink: it.permlink,
        title: it.title || '',
        thumbnail: it.thumbnail || null,
        duration: it.duration || 0,
        created: it.created,
        _incubation: true,
      }));
  }, [data, enabled, ownHandle]);
}
