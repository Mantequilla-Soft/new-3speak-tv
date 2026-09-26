import { useEffect, useState } from 'react';
import { getVideoTagsV2, getCachedTagsV2 } from '../../utils/tagsV2';
import './AiBadge.scss';

/**
 * Small "AI" marker for content the transcription pipeline flagged as
 * AI-generated (`ai_generated_v2` in the checker's subtitles-tags collection,
 * served as `aiGenerated` by GET /transcription-tags).
 *
 * Renders NOTHING unless the checker said true, so it is safe to drop next to any
 * title: a video the detector has not reached yet (the backfill was still running
 * on 2026-09-23) looks exactly as it did before.
 *
 * The lookup is the one the watch page and the shorts panel already prefetch, and
 * utils/tagsV2 caches and de-dupes it, so mounting this costs no extra request.
 *
 * Props:
 *   author, permlink — the HIVE pair; the checker maps it to the asset row.
 *   className        — layout tweak at the callsite; pass `ai-badge--on-video`
 *                      when it sits on top of a video rather than on the page.
 */
export default function AiBadge({ author, permlink, className, title = 'Detected as AI-generated' }) {
  // Seeded from the cache so a video whose tags are already known paints the badge
  // on the first frame instead of popping in. Callsites pass a `key` of the
  // author/permlink pair, so switching video remounts this and the seed runs again
  // -- that is what stops the previous video's answer lingering for a frame.
  const [flagged, setFlagged] = useState(() => getCachedTagsV2(author, permlink)?.aiGenerated === true);

  useEffect(() => {
    if (!author || !permlink) return undefined;
    let alive = true;
    getVideoTagsV2(author, permlink)
      .then((r) => { if (alive) setFlagged(r?.aiGenerated === true); })
      .catch(() => { /* never throws, but keep the badge silent either way */ });
    return () => { alive = false; };
  }, [author, permlink]);

  if (!flagged) return null;

  return <AiPill className={className} title={title} />;
}

/**
 * The pill alone, for callers that already know the answer — feed cards, which
 * look their flags up in one batch (utils/aiFlags) instead of one request each.
 */
export function AiPill({ className, title = 'Detected as AI-generated' }) {
  return (
    <span
      className={`ai-badge${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
    >
      AI
    </span>
  );
}
