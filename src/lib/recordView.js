import { getPlayerUrl } from '../utils/playerUrl';
import { resolveVideoMeta } from './videoMetaCache';

/* Count a view once playback has really started (increments the view counter via
 * the player backend's /api/view). A video lives in exactly one collection, so we
 * try 'embed' (also matches hive_permlink) then 'legacy'; whichever owns it counts,
 * and we stop. Callers dedupe per video; this only does the counting.
 *
 * Shared by the watch page and the chat's inline player. */
export async function recordView(api, author, permlink) {
  // Resolve the embed ASSET id (+ owner) the same way the player does. The URL
  // permlink is often the Hive permlink, but /api/view matches the embed *asset*
  // permlink — sending the Hive permlink would 404 and never count the view.
  let owner = author;
  let viewPermlink = permlink;
  // Shared session cache — the watch-duration session resolves the same
  // /api/embed metadata; this dedupes both into one request per video.
  const meta = await resolveVideoMeta(api, author, permlink);
  if (meta?.owner) owner = meta.owner;
  if (meta?.permlink) viewPermlink = meta.permlink;
  for (const type of ['embed', 'legacy']) {
    try {
      const res = await fetch(`${getPlayerUrl()}/api/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, permlink: viewPermlink, type }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.counted) break;
    } catch { /* try next type */ }
  }
}
