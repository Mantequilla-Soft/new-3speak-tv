import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { getHiveUrl } from '../../utils/hiveNode';
import Card3 from '../Cards/Card3';
import { isShowablePlaylist } from '../../lib/profileLayout';
import { useTranslation } from 'react-i18next';

/**
 * The playlists' actual contents at the foot of the Overview tab: one rail of
 * video tiles per playlist, under the row of playlist covers.
 *
 * What's left out, and why:
 *  - private playlists and Watch Later — a profile shows what a creator chose
 *    to publish, and Watch Later is a personal queue. (Someone else's profile
 *    never carries them anyway; your OWN page fetches all of yours, so the
 *    filter has to live here.)
 *  - audio items, and any playlist left with nothing but audio: these are video
 *    tiles, and an album of tracks belongs in the Audio tab.
 *
 * Cost control: item data comes from one Hive `get_content` per item, so a rail
 * only fetches once it scrolls near the viewport, at most ITEM_CAP items, for
 * at most MAX_PLAYLISTS playlists. The rails sit at the very bottom of a long
 * tab, so for most visits that is no requests at all.
 */

const MAX_PLAYLISTS = 5;
const ITEM_CAP = 10;

// The marker the checker's audioHiveSync uses too: an audio post links to its
// own player. Detected from the body we already fetched — no second call.
const AUDIO_MARKER = /audio\.3speak\.tv\/play\?a=/;

const num = (v) => Number.parseFloat(v) || 0;

async function fetchPlaylistVideos(items, cap = ITEM_CAP) {
  const ordered = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, cap);
  const resolved = await Promise.all(ordered.map(async (item) => {
    try {
      const { data } = await axios.post(getHiveUrl(), {
        jsonrpc: '2.0',
        method: 'condenser_api.get_content',
        params: [item.author, item.permlink],
        id: 1,
      });
      const post = data?.result;
      if (!post?.author) return null;                                   // deleted / never existed
      if (typeof post.body === 'string' && AUDIO_MARKER.test(post.body)) return null;

      let meta = {};
      try {
        meta = typeof post.json_metadata === 'string' ? JSON.parse(post.json_metadata) : post.json_metadata || {};
      } catch { /* malformed metadata — the tile still renders */ }

      // Card3 reads payout / votes / comments from `stats` when the profile's
      // own content batch has nothing for this post, which is every item by
      // another creator.
      return {
        author: post.author,
        permlink: post.permlink,
        title: post.title,
        created_at: post.created,
        images: { thumbnail: meta.image?.[0] || null },
        duration: meta.video?.info?.duration || 0,
        stats: {
          total_hive_reward: num(post.pending_payout_value) + num(post.total_payout_value) + num(post.curator_payout_value),
          num_votes: post.net_votes ?? post.active_votes?.length ?? null,
          num_comments: post.children ?? null,
        },
      };
    } catch {
      return null;
    }
  }));
  return resolved.filter(Boolean);
}

// Also rendered on its own, as a "Playlist" section the creator placed on the
// Overview (see ProfileOverview): `count`, `title` and `view` come from there.
export function PlaylistRail({ playlist, count = ITEM_CAP, title, view = 'row', getContentForVideo, isWatched, getViewCount }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { data: videos = [] } = useQuery({
    queryKey: ['profile-playlist-rail', playlist.id, count],
    queryFn: () => fetchPlaylistVideos(playlist.items, count),
    enabled: near && !!playlist.items?.length,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // The wrapper always renders (it's what the observer watches) but stays empty
  // until there is something to show — so an all-audio playlist never flashes a
  // heading that then disappears.
  return (
    <div ref={ref} className="pov-playlist-rail">
      {videos.length > 0 && (
        <section className={`pov-section pov-section--${view}`}>
          <div className="pov-head">
            <h3>{title || playlist.name}</h3>
            <Link className="pov-more" to={`/playlist/${playlist.id}`}>{t('profile.overview.viewAll')}</Link>
          </div>
          <Card3
            videos={videos}
            getContentForVideo={getContentForVideo}
            isWatched={isWatched}
            getViewCount={getViewCount}
          />
        </section>
      )}
    </div>
  );
}

export default function ProfilePlaylistRails({ playlists = [], maxPlaylists = MAX_PLAYLISTS, count = ITEM_CAP, view = 'row', getContentForVideo, isWatched, getViewCount }) {
  const shown = playlists.filter(isShowablePlaylist).slice(0, maxPlaylists);

  if (!shown.length) return null;

  return shown.map((playlist) => (
    <PlaylistRail
      key={playlist.id}
      playlist={playlist}
      count={count}
      view={view}
      getContentForVideo={getContentForVideo}
      isWatched={isWatched}
      getViewCount={getViewCount}
    />
  ));
}
