/**
 * The chapters of a 3Speak post, for any player: the timeline's chapters in its
 * json_metadata (utils/videoTimeline.js, video.chapters or audio.chapters), else
 * a list of timestamped lines in the text (utils/timestamps.js parseChapters, as
 * the audio editor writes them: "0:00 Intro"). The checker serves the same list
 * as a podcast chapters file (3speakchecks utils/postMeta.js).
 *
 * Returns [{ start, end, title }] in seconds, or [] (fewer than two chapters,
 * or the duration not known yet).
 */
import { parseChapters } from './timestamps';
import { parseJsonMetadata, normalizeChapters, chaptersWithEnds, MIN_META_CHAPTERS } from './videoTimeline';

export function chaptersOfPost({ body, json_metadata: raw, duration } = {}) {
  const total = Number(duration) || 0;
  if (total <= 0) return [];
  const meta = typeof raw === 'object' && raw ? raw : parseJsonMetadata(raw);
  for (const block of [meta?.video, meta?.audio]) {
    const list = normalizeChapters(block?.chapters, { duration: total });
    if (list.length >= MIN_META_CHAPTERS) return chaptersWithEnds(list, total);
  }
  return parseChapters(body, total);
}
