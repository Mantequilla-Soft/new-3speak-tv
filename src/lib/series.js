/**
 * A series: Shorts (or videos) grouped in a numbered order, "Part 3 of 7", built
 * on playlists. A series is a video playlist with `json_metadata.series: true`;
 * the playlists indexer only knows `video` and `audio` (lib/playlistType.js), so
 * the mark lives in json_metadata like the owner's type choice. Only the owner
 * makes a playlist a series. The checker reads the same mark (3speakchecks
 * utils/playlistType.js isSeriesPlaylist) to number a series' feed items.
 *
 * Parts are the playlist's items in `position` order: the first is part 1. New
 * parts go at the end (SERIES_APPEND_POSITION: the indexer clamps a position past
 * the end to "append").
 */
import { storedPlaylistType } from './playlistType';

export const SERIES_APPEND_POSITION = 100000;

function parseJsonMeta(m) {
  if (!m) return {};
  if (typeof m === 'object') return Array.isArray(m) ? {} : m;
  try {
    let v = JSON.parse(m);
    if (typeof v === 'string') v = JSON.parse(v);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Is this playlist (as the playlists API returns it) a series? */
export function isSeries(playlist) {
  if (!playlist) return false;
  return parseJsonMeta(playlist.json_metadata).series === true && storedPlaylistType(playlist).type !== 'audio';
}

/** The json_metadata fields that make a new playlist a series. */
export const SERIES_META = { type: 'video', series: true };

/** The parts in order (the playlist's items by position). */
export function seriesParts(playlist) {
  const items = Array.isArray(playlist?.items) ? playlist.items.filter((i) => i && i.author && i.permlink) : [];
  return [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Where a post sits in a series: { part (1-based), total, next, prev } (next and
 * prev are items or null), or null when it is not one of its parts.
 */
export function seriesPosition(playlist, author, permlink) {
  const parts = seriesParts(playlist);
  const i = parts.findIndex((p) => p.author === author && p.permlink === permlink);
  if (i < 0) return null;
  return { part: i + 1, total: parts.length, next: parts[i + 1] || null, prev: parts[i - 1] || null };
}

/**
 * The series this post belongs to, from the playlists that contain it: the
 * owner's own series first (a Short is a part of its creator's series), else
 * none. Another creator's playlist never numbers someone's Short.
 */
export function seriesOf(playlists, author) {
  return (Array.isArray(playlists) ? playlists : []).find((p) => p && p.owner === author && isSeries(p)) || null;
}
