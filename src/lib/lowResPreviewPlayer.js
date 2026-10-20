import { Player } from '@mantequilla-soft/3speak-player';
import Hls from 'hls.js';
import { getPlayerUrl } from '../utils/playerUrl';

/**
 * Shared factory for a muted, LOWEST-rendition SDK Player used for cheap video
 * previews — the hover-to-play cards on the homepage AND the scrubber seek
 * preview both use it. Zero extra storage: it reuses the video's existing
 * lowest HLS variant (produced at encode time) instead of a storyboard/GIF.
 *
 * IMPORTANT — we pick the lowest rendition by BITRATE, not by level index. The
 * old `startLevel: 0 / autoLevelCapping: 0` assumed the smallest variant is
 * first in the manifest, which is true for the legacy encoder (240p→720p) but
 * BACKWARDS for the embed encoder, which lists variants highest-first (1080p =
 * index 0). That pinned embed previews to 1080p. Instead: a tiny bandwidth
 * estimate makes ABR start on the smallest rung, and once the manifest's levels
 * are known we lock `currentLevel`/`autoLevelCapping` to the lowest-bitrate one.
 *
 * @param {HTMLVideoElement} videoEl  element to attach the player to
 * @param {object} opts
 * @param {boolean} [opts.loop]                loop (cards) vs one-shot (scrubber)
 * @param {boolean} [opts.requirePreviewRung]  when true, ABORT the stream if the
 *   preview's smallest rung isn't smaller than the rung the MAIN player is already
 *   streaming — a preview there would just re-download the exact segments playback
 *   needs (old 3Speak/embed videos bottom out at 480p). Used by the scrubber preview
 *   so it never duplicates playback.
 * @param {() => number} [opts.getPlaybackHeight]  returns the main player's current
 *   rung height (px), or 0 if unknown. The skip test compares against it; with no
 *   getter (or 0) it falls back to a static "≤360p is the only rung worth a separate
 *   stream" cutoff.
 * @param {() => void} [opts.onNoPreviewRung]  called when the stream is aborted
 *   for the reason above, so the caller can fall back (e.g. timestamp-only scrub).
 * @returns {import('@mantequilla-soft/3speak-player').Player}
 */
export function createLowResPreviewPlayer(videoEl, { loop = false, requirePreviewRung = false, getPlaybackHeight, onNoPreviewRung } = {}) {
  const player = new Player({
    apiBase: getPlayerUrl(),
    muted: true,
    loop,
    poster: false,
    debug: false,
    hlsConfig: {
      maxBufferLength: 10,
      startFragPrefetch: true,
      // 200 kbps default estimate → ABR selects the smallest variant up front,
      // before the pin below takes over (all renditions are well above this).
      abrEwmaDefaultEstimate: 200000,
      // A looping preview otherwise keeps every played segment in memory.
      backBufferLength: 10,
    },
  });
  player.attach(videoEl);

  // A rung is a real "preview rung" only if it's genuinely small — a 240p/360p
  // ladder step. A 480p+ lowest rung costs about as much as playback itself.
  const isCheapRung = (lvl) =>
    !lvl ? false : lvl.height ? lvl.height <= 360 : (lvl.bitrate || Infinity) <= 500000;

  const findLowest = (levels) => {
    if (!levels || !levels.length) return -1;
    let lo = 0;
    for (let i = 1; i < levels.length; i++) {
      if ((levels[i].bitrate || Infinity) < (levels[lo].bitrate || Infinity)) lo = i;
    }
    return lo;
  };

  // Would this preview just re-download what playback already streams? Skip if the
  // smallest rung isn't smaller than the main player's CURRENT rung. When that
  // height is unknown (native HLS, not yet settled), fall back to a static cutoff:
  // only a genuinely-small rung (≤360p) earns a separate stream.
  const wouldDuplicate = (levels, lo) => {
    const playH = (typeof getPlaybackHeight === 'function' ? getPlaybackHeight() : 0) || 0;
    const lowH = levels[lo].height || 0;
    return playH > 0 ? lowH >= playH : !isCheapRung(levels[lo]);
  };

  const pinTo = (hls, lo) => {
    if ((hls.levels || []).length < 2) return; // single rendition — nothing to choose
    hls.autoLevelCapping = lo; // ABR may never climb above the smallest
    hls.currentLevel = lo;     // and start there immediately
  };

  // Lock to the lowest-bitrate rendition as soon as the manifest's levels are
  // known — order-independent, so it's correct for both encoders. player.hls is
  // created synchronously inside load(), so it exists by the time load() resolves.
  const origLoad = player.load.bind(player);
  player.load = async (refOrSource) => {
    const res = await origLoad(refOrSource);
    const hls = player.hls;
    if (hls) {
      const pinLowest = () => {
        const levels = hls.levels || [];
        const lo = findLowest(levels);
        if (lo < 0) return;
        if (requirePreviewRung && wouldDuplicate(levels, lo)) {
          try { hls.stopLoad(); } catch { /* noop */ }
          if (onNoPreviewRung) onNoPreviewRung();
          return;
        }
        pinTo(hls, lo);
      };
      if (hls.levels && hls.levels.length) pinLowest();
      else hls.once(Hls.Events.MANIFEST_PARSED, pinLowest);
    }
    return res;
  };

  return player;
}
