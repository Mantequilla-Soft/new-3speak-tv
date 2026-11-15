/**
 * Season and episode numbers of a post: optional whole numbers the creator sets
 * on the details step (video and audio), stored in the post's own json_metadata
 * next to the rest of its block:
 *
 *   audio: { type: 'podcast', season: 2, episode: 5 }   (audio uploads)
 *   video: { ..., season: 2, episode: 5 }                (video uploads)
 *
 * The checker reads the same fields for the podcast feeds (<podcast:season>,
 * <podcast:episode>; 3speakchecks utils/postMeta.js) and copies the audio ones
 * onto the audio rows (`season`, `episode`), which is what the cards show as
 * "S2 E5". 🚨 Keep the limits in step with the checker.
 */

export const MAX_SEASON = 9999;
export const MAX_EPISODE = 99999;

/** A whole number in [1, max] from an input value or a stored one, else null. */
export function cleanNumber(value, max) {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value.trim() : value;
  if (s === '') return null;
  const n = typeof s === 'string' ? Number(s) : s;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/** { season, episode } from a post's audio or video block (or an audio row). */
export function episodeNumbersOf(block) {
  if (!block || typeof block !== 'object') return { season: null, episode: null };
  return { season: cleanNumber(block.season, MAX_SEASON), episode: cleanNumber(block.episode, MAX_EPISODE) };
}

/** { season, episode } from a whole json_metadata (string or object): audio first, then video. */
export function episodeNumbersOfMeta(meta) {
  let m = meta;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { m = null; }
  }
  if (!m || typeof m !== 'object') return { season: null, episode: null };
  for (const block of [m.audio, m.video]) {
    const n = episodeNumbersOf(block);
    if (n.season != null || n.episode != null) return n;
  }
  return { season: null, episode: null };
}

/** The fields to spread into a post's block: only the numbers that are set. */
export function episodeFields({ season, episode } = {}) {
  const s = cleanNumber(season, MAX_SEASON);
  const e = cleanNumber(episode, MAX_EPISODE);
  return { ...(s != null ? { season: s } : {}), ...(e != null ? { episode: e } : {}) };
}

/** "S2 E5", "E5", "S2" or '' (the short label cards and episode pages show). */
export function episodeLabel({ season, episode } = {}) {
  const s = cleanNumber(season, MAX_SEASON);
  const e = cleanNumber(episode, MAX_EPISODE);
  return [s != null ? `S${s}` : '', e != null ? `E${e}` : ''].filter(Boolean).join(' ');
}
