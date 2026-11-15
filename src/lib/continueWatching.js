/**
 * Continue watching (the home strip): what the viewer left between 10 % and 75 %,
 * from the checker (POST /feeds/continue-watching). The checker keeps where each
 * video was left only for viewers opted into viewer rewards; for anyone else it
 * answers `enabled: false` and the strip stays away.
 *
 * Both calls carry the session vouch the podcast progress already holds
 * (lib/podcastProgress.js sessionVouch, reused for most of a day).
 */
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';
import { fetchIncubationPost } from './incubation';

const API = `${CHECKER_URL}/feeds/continue-watching`;

/** { enabled, videos }; each video a feed card plus `progress` and `_progressKey`. */
export async function fetchContinueWatching(user) {
  if (!user) return { enabled: false, videos: [] };
  const v = await sessionVouch(user);
  if (!v) return { enabled: false, videos: [] };
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, signature: v.signature, timestamp: v.timestamp }),
  });
  if (!res.ok) throw new Error(`continue watching: ${res.status}`);
  const data = await res.json();
  // A warm-up user's video has its post off-chain, so its title is looked up
  // there, as the watch history page does; one that is not found is left out.
  const videos = await Promise.all((data.videos || []).map(async (it) => {
    if (!it._unlinked) return it;
    try {
      const post = (await fetchIncubationPost(it.author, it.permlink))?.post;
      return post?.title ? { ...it, title: post.title, _incubation: true } : null;
    } catch {
      return null;
    }
  }));
  return { enabled: data.enabled === true, videos: videos.filter(Boolean) };
}

/** Off the strip (and back with `hidden: false`, for Undo). `key` is `_progressKey`. */
export async function hideFromContinueWatching(user, key, hidden = true) {
  const v = await sessionVouch(user);
  if (!v) throw new Error('not signed in');
  const slash = String(key).indexOf('/');
  const res = await fetch(`${API}/hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user, owner: key.slice(0, slash), permlink: key.slice(slash + 1), hidden, signature: v.signature, timestamp: v.timestamp,
    }),
  });
  if (!res.ok) throw new Error(`continue watching hide: ${res.status}`);
}
