/**
 * Outside podcast shows inside a 3Speak playlist.
 *
 * The owner adds whole shows: their feed URLs live in the playlist's own
 * json_metadata as `feeds: [{ url, title }]`, on chain like the rest of the
 * playlist. The checker keeps those shows polled (3speakchecks
 * utils/playlistFeeds.js) and serves their episodes through /podcasts/bundle;
 * the playlist page merges them by date with the playlist's 3Speak items, and
 * the playlist's RSS feed carries them too.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchPlaylistBundle, feedKey, threeSpeakPost } from './podcasts';

// Same cap as the checker's (MAX_PLAYLIST_FEEDS).
export const MAX_PLAYLIST_FEEDS = 25;
// Hive refuses a custom_json over 8192 bytes; the update op carries more than json_metadata.
export const MAX_PLAYLIST_JSON = 7000;
const MAX_TITLE = 100;

function cleanUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 2000) return '';
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
  } catch {
    return '';
  }
  return s;
}

/** The outside shows a playlist's json_metadata names: [{ url, title }], valid and once each. */
export function playlistFeedsOf(jsonMeta) {
  const list = Array.isArray(jsonMeta?.feeds) ? jsonMeta.feeds : [];
  const out = [];
  const seen = new Set();
  for (const f of list) {
    const url = cleanUrl(f && typeof f === 'object' ? f.url : f);
    const key = url && feedKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const title = typeof f?.title === 'string' ? f.title.trim().slice(0, MAX_TITLE) : '';
    out.push(title ? { url, title } : { url });
    if (out.length >= MAX_PLAYLIST_FEEDS) break;
  }
  return out;
}

/** json_metadata with its outside shows replaced (the key dropped when there are none). */
export function withPlaylistFeeds(jsonMeta, feeds) {
  const out = { ...(jsonMeta || {}) };
  const clean = playlistFeedsOf({ feeds });
  if (clean.length) out.feeds = clean;
  else delete out.feeds;
  return out;
}

/** Is `url` the RSS feed of the playlist `playlistId` itself? */
export const isOwnPlaylistFeed = (url, playlistId) => feedKey(url).endsWith(`/rss/playlist/${playlistId}.xml`);

/** A playlist's outside shows and their episodes, paged newest first. */
export function usePlaylistBundle(urls) {
  return useInfiniteQuery({
    queryKey: ['podcasts', 'bundle', urls.join('\n')],
    enabled: urls.length > 0,
    initialPageParam: null,
    queryFn: ({ pageParam }) => fetchPlaylistBundle(urls, pageParam),
    getNextPageParam: (last) => last.next_cursor || undefined,
    staleTime: 60 * 1000,
  });
}

const timeOf = (v) => {
  const ms = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

/** When a playlist item was published: Hive's `created` has no zone, it is UTC. */
export function itemTime(video) {
  if (video?.audioDoc?.createdAt) return timeOf(video.audioDoc.createdAt);
  const c = video?.created_at;
  if (!c) return 0;
  return timeOf(typeof c === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(c) ? `${c}Z` : c);
}

/**
 * The playlist's 3Speak items and its outside episodes in one list, newest first:
 * `{ kind: 'item', video, at }` and `{ kind: 'episode', ep, feed, at }`.
 *
 * While older outside episodes are still to load (`complete` false), a 3Speak item
 * older than the last loaded episode waits for them, so paging never shows the
 * list out of order. An outside episode that is one of the playlist's own 3Speak
 * posts (a 3Speak feed added as a show) is left out.
 */
export function mergeByDate(videos, episodes, feeds, { complete }) {
  const feedsById = new Map((feeds || []).map((f) => [f.id, f]));
  const own = new Set(videos.map((v) => `${v.author}/${v.permlink}`));
  const eps = (episodes || [])
    .filter((ep) => {
      const post = threeSpeakPost(ep.link);
      return !post || !own.has(`${post.author}/${post.permlink}`);
    })
    .map((ep) => ({ kind: 'episode', ep, feed: feedsById.get(ep.feed_id) || null, at: timeOf(ep.published_at) }));
  const oldest = eps.length ? Math.min(...eps.map((e) => e.at)) : Infinity;
  const items = videos
    .map((video) => ({ kind: 'item', video, at: itemTime(video) }))
    .filter((e) => complete || (e.at && e.at >= oldest));
  // Newest first; anything without a date goes last.
  return [...items, ...eps].sort((a, b) => b.at - a.at);
}
