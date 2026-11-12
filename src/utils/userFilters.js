// Per-user feed suppression: "not interested" (one video) and "don't show this
// creator" (every video by an author). The checker filters these out of every
// personalized feed server-side — see routes/userFilters.js.
//
// Unlike "hide watched", these are explicit dismissals: they apply regardless of
// any setting, so feedParams() must always send ?currentuser= for them to work.
import axios from 'axios';
import { useEffect, useSyncExternalStore } from 'react';
import { CHECKER_URL } from './config';

// ── The viewer's dismissals, shared by every grid for the whole visit ──
//
// Issue #565: "Not interested" seemed to do nothing, because the same videos
// kept coming back. The checker does drop them, but only from the NEXT fetch,
// and the home feeds stay cached for minutes. Each grid kept its own list of
// what was dismissed, which was gone as soon as the grid remounted (open a
// video, come back): the cached feed showed the video again. Other grids, the
// Spotlight and the watch page never knew at all.
//
// Now there is ONE list per visit: the viewer's saved dismissals, loaded once
// (useDismissals), plus every hide / undo of this visit, updated the moment it
// happens (hideVideo & co. below). Everything that shows videos filters by it
// (isDismissed), whatever a cache or an endpoint returns.
const store = { user: null, videos: new Set(), creators: new Set(), loaded: null, version: 0 };
const listeners = new Set();
const emit = () => { store.version += 1; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const norm = (x) => String(x || '').trim().replace(/^@/, '').toLowerCase();
const videoKey = (owner, permlink) => `${norm(owner)}/${String(permlink || '').trim()}`;

function forUser(username) {
  const u = norm(username);
  if (store.user !== u) {
    store.user = u;
    store.videos = new Set();
    store.creators = new Set();
    store.loaded = null;
  }
  return u;
}

/** Load the viewer's saved dismissals once per visit (per account). */
export function loadDismissals(username) {
  const u = forUser(username);
  if (!u) return Promise.resolve();
  if (!store.loaded) {
    store.loaded = getHidden(u).then(({ videos, creators }) => {
      if (store.user !== u) return;
      for (const v of videos) store.videos.add(videoKey(v.owner, v.permlink));
      for (const c of creators) store.creators.add(norm(c.creator));
      emit();
    });
  }
  return store.loaded;
}

/** Re-render on any dismissal change; loads the viewer's saved list. Returns a
 * version number to put in memo dependencies. */
export function useDismissals(username) {
  useEffect(() => { if (username) loadDismissals(username); }, [username]);
  return useSyncExternalStore(subscribe, () => store.version, () => 0);
}

/** True when the viewer dismissed this video or its creator. Takes a feed item
 * (author / owner + permlink, the card's own key). */
export function isDismissed(video) {
  if (!video || (!store.videos.size && !store.creators.size)) return false;
  const people = [video.author?.username || video.author, video.owner].filter(Boolean).map(norm);
  if (people.some((p) => store.creators.has(p))) return true;
  return people.some((p) => store.videos.has(`${p}/${String(video.permlink || '').trim()}`));
}

// A save that failed is tried once more a little later; the video stays hidden
// for this visit either way (the list above), so a hiccup never brings it back.
const retryOnce = (fn) => fn().then((ok) => (ok ? ok : new Promise((r) => { setTimeout(() => r(fn()), 3000); })));

// Only touch the shared list for the signed-in viewer it belongs to.
const mine = (username) => {
  const u = norm(username);
  if (u && store.user !== u) forUser(u);
  return !!u;
};

/** Mark a single video "not interested". Idempotent. */
export async function hideVideo(username, owner, permlink) {
  if (!username || !owner || !permlink) return false;
  if (mine(username)) { store.videos.add(videoKey(owner, permlink)); emit(); }
  return retryOnce(async () => {
    try {
      await axios.post(`${CHECKER_URL}/user/hide-video`, { username, owner, permlink });
      return true;
    } catch (err) {
      console.error('hideVideo failed:', err);
      return false;
    }
  });
}

/** Undo a "not interested". */
export async function unhideVideo(username, owner, permlink) {
  if (!username || !owner || !permlink) return false;
  if (mine(username)) { store.videos.delete(videoKey(owner, permlink)); emit(); }
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
  if (mine(username)) { store.creators.add(norm(creator)); emit(); }
  return retryOnce(async () => {
    try {
      await axios.post(`${CHECKER_URL}/user/hide-creator`, { username, creator });
      return true;
    } catch (err) {
      console.error('hideCreator failed:', err);
      return false;
    }
  });
}

/** Undo a creator dismissal. */
export async function unhideCreator(username, creator) {
  if (!username || !creator) return false;
  if (mine(username)) { store.creators.delete(norm(creator)); emit(); }
  try {
    await axios.delete(`${CHECKER_URL}/user/hide-creator`, { data: { username, creator } });
    return true;
  } catch (err) {
    console.error('unhideCreator failed:', err);
    return false;
  }
}

/** Everything this user has dismissed (also what loadDismissals reads). */
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

/** Tests only: forget the shared list. */
export function _resetDismissals() {
  store.user = null; store.videos = new Set(); store.creators = new Set(); store.loaded = null;
  emit();
}
