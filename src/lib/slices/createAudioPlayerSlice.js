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

const SS_NOW_KEY = 'audio-now-playing';
const SS_QUEUE_KEY = 'audio-queue';

function loadInitial() {
  try {
    const now = sessionStorage.getItem(SS_NOW_KEY);
    const q = sessionStorage.getItem(SS_QUEUE_KEY);
    return {
      audioCurrent: now ? JSON.parse(now) : null,
      audioQueue: q ? JSON.parse(q) : [],
    };
  } catch {
    return { audioCurrent: null, audioQueue: [] };
  }
}

function persistNow(track) {
  try {
    if (track) sessionStorage.setItem(SS_NOW_KEY, JSON.stringify(track));
    else sessionStorage.removeItem(SS_NOW_KEY);
  } catch {}
}
function persistQueue(queue) {
  try { sessionStorage.setItem(SS_QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

export const createAudioPlayerSlice = (set, get) => {
  const init = loadInitial();
  return {
    audioCurrent: init.audioCurrent,
    audioQueue: init.audioQueue,
    audioAutoplayList: [],
    audioIsPlaying: false,
    audioCurrentTime: 0,
    audioDuration: 0,
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
