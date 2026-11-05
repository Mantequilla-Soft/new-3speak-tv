// Per-user feed suppression: "not interested" (one video) and "don't show this
// creator" (every video by an author). The checker filters these out of every
// personalized feed server-side — see routes/userFilters.js.
//
// Unlike "hide watched", these are explicit dismissals: they apply regardless of
// any setting, so feedParams() must always send ?currentuser= for them to work.
import axios from 'axios';
import { CHECKER_URL } from './config';

/** Mark a single video "not interested". Idempotent. */
export async function hideVideo(username, owner, permlink) {
  if (!username || !owner || !permlink) return false;
  try {
    await axios.post(`${CHECKER_URL}/user/hide-video`, { username, owner, permlink });
    return true;
  } catch (err) {
    console.error('hideVideo failed:', err);
    return false;
  }
}

/** Undo a "not interested". */
export async function unhideVideo(username, owner, permlink) {
  if (!username || !owner || !permlink) return false;
  try {
    await axios.delete(`${CHECKER_URL}/user/hide-video`, { data: { username, owner, permlink } });
    return true;
  } catch (err) {
    console.error('unhideVideo failed:', err);
    return false;
  }
}

/** Hide every video by a creator from this user's feeds. Idempotent. */
export async function hideCreator(username, creator) {
  if (!username || !creator) return false;
  try {
    await axios.post(`${CHECKER_URL}/user/hide-creator`, { username, creator });
    return true;
  } catch (err) {
    console.error('hideCreator failed:', err);
    return false;
  }
}

/** Undo a creator dismissal. */
export async function unhideCreator(username, creator) {
  if (!username || !creator) return false;
  try {
    await axios.delete(`${CHECKER_URL}/user/hide-creator`, { data: { username, creator } });
    return true;
  } catch (err) {
    console.error('unhideCreator failed:', err);
    return false;
  }
}

/** Everything this user has dismissed — for a manage/undo screen. */
export async function getHidden(username) {
  if (!username) return { videos: [], creators: [] };
  try {
    const res = await axios.get(`${CHECKER_URL}/user/hidden/${encodeURIComponent(username)}`);
    return { videos: res.data?.videos || [], creators: res.data?.creators || [] };
  } catch (err) {
    console.error('getHidden failed:', err);
    return { videos: [], creators: [] };
  }
}

/**
 * Add the viewer to a browsing request, so the checker can drop the creators they
 * dismissed (shorts, audio, playlists: owner, 2026-11-05). No viewer = unchanged.
 */
export function withViewer(url, user) {
  if (!user) return url;
  return `${url}${url.includes('?') ? '&' : '?'}currentuser=${encodeURIComponent(user)}`;
}

/**
 * The rails of OTHER content types that the checker filters by hidden creators.
 * Refetched after a hide/unhide so the creator's shorts, audio and playlists go
 * (or come back) at once. Not the main video grids: those drop the creator
 * locally, and a refetch would reshuffle them under the user.
 */
const HIDE_CREATOR_RAIL_KEYS = [
  'feed-shorts', 'feed-audio', 'feed-community', 'feed-playlists',
  'shorts-stories', 'stories', 'new-from-following', 'watch-related-shorts',
  'audio-grouped', 'audio-playlists', 'audio-filtered', 'audio-creators',
];

export function refreshRailsAfterHide(queryClient) {
  if (!queryClient) return;
  for (const k of HIDE_CREATOR_RAIL_KEYS) queryClient.invalidateQueries({ queryKey: [k] });
}
