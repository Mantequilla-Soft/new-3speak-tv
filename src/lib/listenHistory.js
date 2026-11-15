/**
 * What the global audio player puts into the watch history (/watched, Audio tab).
 *
 * A track joins the history once it was really listened to (30 s, or half of a
 * shorter track, the rule a play uses), and only while "Save history" is on.
 * Each track is recorded ONCE per day per listener: the player calls this on
 * every timeupdate, and the history service counts every call as another watch.
 * The spot reached is not sent: the history reads it from the listening
 * progress the player already saves (lib/podcastProgress.js).
 *
 * Which key a track is recorded under:
 * - 3Speak audio: its owner + asset permlink, as it always was;
 * - an episode of a 3Speak feed followed as a podcast (a NaPodPoMo playlist,
 *   say): its Hive post, owner + post permlink, so it shows as the 3Speak track;
 * - any other outside episode: PODCAST_HISTORY_AUTHOR + the episode id, which
 *   the checker turns into an episode card (routes/watchedFeed.js).
 * Live streams and private feeds are never recorded (history is public).
 */
import { useAppStore } from './store';
import { recordWatch } from '../utils/watchHistory';

// Must match PODCAST_AUTHOR in the checker's routes/watchedFeed.js.
export const PODCAST_HISTORY_AUTHOR = '_podcast';

const EPISODE_ID_RE = /^[0-9a-f]{24}:[A-Za-z0-9_-]{16}$/;
const RETRY_MS = 60 * 1000;
const STORE_KEY = 'listen-history-days';

/** The history key `{ author, permlink }` for a track, or null when it is never recorded. */
export function historyKeyOf(track) {
  if (!track || track.live || track.private) return null;
  if (!track.external) {
    return track.owner && track.permlink ? { author: track.owner, permlink: track.permlink } : null;
  }
  if (track.owner && track.post_permlink) return { author: track.owner, permlink: track.post_permlink };
  return EPISODE_ID_RE.test(String(track._id || '')) ? { author: PODCAST_HISTORY_AUTHOR, permlink: track._id } : null;
}

/** Listened long enough to count: 30 s, or half of a shorter track. */
export const listenedEnough = (pos, dur) => pos >= Math.min(30, dur > 0 ? dur / 2 : 30);

const dayOf = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// `<user>|<author>/<permlink>` -> the local day it was recorded on, or a retry
// time after a failed call. Kept in localStorage too, so a reload the same day
// does not count the track again. Only today's entries are kept.
let marks = null;
function loadMarks(today) {
  if (marks && marks.day === today) return marks.map;
  let saved = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && raw.day === today && raw.map && typeof raw.map === 'object') saved = raw.map;
  } catch { /* storage blocked: memory only */ }
  marks = { day: today, map: saved };
  return marks.map;
}
function saveMarks() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(marks)); } catch { /* memory only */ }
}

/**
 * Call on every timeupdate with the position and length: records the track the
 * first time it qualifies today, and does nothing (cheaply) every other time.
 */
export function noteListen(track, pos, dur, now = Date.now()) {
  const key = historyKeyOf(track);
  if (!key || !listenedEnough(pos, dur)) return;
  const { user, incubationHandle, watchHistoryEnabled } = useAppStore.getState();
  const who = user || incubationHandle;
  if (!who || watchHistoryEnabled === false) return;

  const today = dayOf(now);
  const map = loadMarks(today);
  const id = `${who}|${key.author}/${key.permlink}`;
  const mark = map[id];
  if (mark === today || (typeof mark === 'number' && now < mark)) return;
  map[id] = today;
  saveMarks();
  Promise.resolve(recordWatch(who, key.author, key.permlink, { short: false })).then((ok) => {
    if (ok || !marks || marks.day !== today) return;
    marks.map[id] = now + RETRY_MS;
    saveMarks();
  });
}

/** Tests only: forget what was recorded. */
export function _resetListenHistory() {
  marks = null;
}
