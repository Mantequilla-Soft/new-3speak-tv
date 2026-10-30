/**
 * Global audio-player state.
 *
 * Lets any page (Audio page, profile audio tab, playlist view, ...)
 * trigger playback in the single <GlobalAudioPlayer /> mounted at the app root.
 *
 * Track shape (matches `embed-audio` documents from the checker):
 *   { _id, owner, permlink, title, audio_cid, thumbnail_url, duration,
 *     plays, createdAt, post_permlink?, subtitle_languages? }
 */

// localStorage, so the player comes back after the browser was closed: the
// same track, paused, at the spot the listener left it (audioRestoredAt).
const LS_NOW_KEY = 'audio-now-playing';
const LS_QUEUE_KEY = 'audio-queue';
const LS_POS_KEY = 'audio-now-position';

function readKey(key) {
  // Older builds kept these in sessionStorage; pick them up once.
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

function loadInitial() {
  try {
    const now = readKey(LS_NOW_KEY);
    const q = readKey(LS_QUEUE_KEY);
    const track = now ? JSON.parse(now) : null;
    const pos = track ? JSON.parse(localStorage.getItem(LS_POS_KEY) || 'null') : null;
    const at = pos?.id === track?._id && Number.isFinite(pos?.t) ? pos.t : 0;
    return {
      audioCurrent: track,
      audioQueue: q ? JSON.parse(q) : [],
      audioRestoredAt: track ? at : null,
    };
  } catch {
    return { audioCurrent: null, audioQueue: [], audioRestoredAt: null };
  }
}

function persistNow(track) {
  try {
    sessionStorage.removeItem(LS_NOW_KEY);
    localStorage.removeItem(LS_POS_KEY);
    if (track) localStorage.setItem(LS_NOW_KEY, JSON.stringify(track));
    else localStorage.removeItem(LS_NOW_KEY);
  } catch { /* storage unavailable */ }
}
function persistQueue(queue) {
  try {
    sessionStorage.removeItem(LS_QUEUE_KEY);
    localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(queue));
  } catch { /* storage unavailable */ }
}
// Where the listener is in the current track. Written by the player while it
// plays and when the page goes away.
export function persistAudioPosition(id, t) {
  try {
    if (id && Number.isFinite(t)) localStorage.setItem(LS_POS_KEY, JSON.stringify({ id, t: Math.floor(t) }));
  } catch { /* storage unavailable */ }
}

export const createAudioPlayerSlice = (set, get) => {
  const init = loadInitial();
  return {
    audioCurrent: init.audioCurrent,
    audioQueue: init.audioQueue,
    audioAutoplayList: init.audioCurrent ? [init.audioCurrent] : [],
    audioIsPlaying: false,
    // Set when the page opened with a track from the last visit: the player
    // loads it paused and seeks here instead of starting it. null otherwise.
    audioRestoredAt: init.audioRestoredAt,
    audioCurrentTime: init.audioRestoredAt || 0,
    audioDuration: Number(init.audioCurrent?.duration) || 0,
    audioExpanded: false,
    audioShowQueue: false,
    // Bumps every time we (re)issue a play command for the same track,
    // so the GlobalAudioPlayer knows to re-seek/replay even if audioCurrent ref didn't change.
    audioPlayNonce: 0,
    // Cross-component imperative requests — pages outside the player call these,
    // GlobalAudioPlayer subscribes to the nonce and applies the action to its <audio> ref.
    audioToggleNonce: 0,
    audioSeekNonce: 0,
    audioPendingSeek: 0,

    audioPlay: (track, contextItems) => {
      if (!track) return;
      persistNow(track);
      set((s) => ({
        audioCurrent: track,
        audioAutoplayList: Array.isArray(contextItems) ? contextItems : [track],
        audioRestoredAt: null,
        audioCurrentTime: 0,
        // Source of truth for the timeline: the duration stored in the
        // embed-audio doc (Mongo). Don't probe the <audio> element.
        audioDuration: Number(track.duration) || 0,
        audioPlayNonce: s.audioPlayNonce + 1,
      }));
    },
    audioStop: () => {
      persistNow(null);
      set({
        audioCurrent: null,
        audioIsPlaying: false,
        audioRestoredAt: null,
        audioCurrentTime: 0,
        audioDuration: 0,
        audioAutoplayList: [],
        audioExpanded: false,
      });
    },
    audioRequestPlayPauseToggle: () => {
      // Flip a flag; the GlobalAudioPlayer reads it via subscribe and toggles the <audio> element
      set((s) => ({ audioPlayNonce: s.audioPlayNonce + 1, audioIsPlaying: !s.audioIsPlaying }));
    },
    audioSetIsPlaying: (v) => set({ audioIsPlaying: !!v }),
    audioClearRestored: () => set({ audioRestoredAt: null }),
    audioSetCurrentTime: (t) => set({ audioCurrentTime: t }),
    audioSetDuration: (d) => set({ audioDuration: d }),
    audioSetExpanded: (v) => set((s) => ({ audioExpanded: typeof v === 'function' ? v(s.audioExpanded) : v })),
    audioSetShowQueue: (v) => set((s) => ({ audioShowQueue: typeof v === 'function' ? v(s.audioShowQueue) : v })),
    audioSetAutoplayList: (list) => set({ audioAutoplayList: Array.isArray(list) ? list : [] }),

    audioAddToQueue: (item) => {
      const cur = get().audioQueue;
      if (cur.some((i) => i._id === item._id)) return;
      const next = [...cur, item];
      persistQueue(next);
      set({ audioQueue: next });
    },
    // Play `track` now WITHOUT losing what was playing: that one goes into the
    // queue if it isn't there yet, `track` lands right after it and starts. The
    // player then carries on through the queue, and Previous goes back to the
    // interrupted item. Used by the outside podcasts (components/Podcasts).
    audioPlayQueued: (track) => {
      if (!track) return;
      const { audioCurrent, audioQueue } = get();
      const queue = audioQueue.filter((i) => i._id !== track._id);
      if (audioCurrent && audioCurrent._id !== track._id && !queue.some((i) => i._id === audioCurrent._id)) {
        queue.push(audioCurrent);
      }
      const at = audioCurrent ? queue.findIndex((i) => i._id === audioCurrent._id) : -1;
      if (at >= 0) queue.splice(at + 1, 0, track); else queue.push(track);
      persistQueue(queue);
      set({ audioQueue: queue });
      get().audioPlay(track, queue);
    },
    audioRemoveFromQueue: (id) => {
      const next = get().audioQueue.filter((i) => i._id !== id);
      persistQueue(next);
      set({ audioQueue: next });
    },
    audioClearQueue: () => {
      persistQueue([]);
      set({ audioQueue: [] });
    },
    audioMoveInQueue: (from, to) => {
      const n = [...get().audioQueue];
      const [m] = n.splice(from, 1);
      n.splice(to, 0, m);
      persistQueue(n);
      set({ audioQueue: n });
    },
    audioRequestToggle: () => set((s) => ({ audioToggleNonce: s.audioToggleNonce + 1 })),
    audioRequestSeek: (t) => set((s) => ({ audioPendingSeek: t, audioSeekNonce: s.audioSeekNonce + 1 })),
  };
};
