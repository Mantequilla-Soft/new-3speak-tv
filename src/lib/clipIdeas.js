/**
 * Shorts from this video: clip ranges for a creator's own long video, picked by
 * real viewers (the checker's POST /creator-stats/clip-ideas: replays, timestamped
 * comments, stream and premiere chat, quotable transcript lines). Only the video's
 * owner gets an answer, so the call carries the session vouch the podcast progress
 * already holds (lib/podcastProgress.js sessionVouch, reused for most of a day).
 *
 * Not named "analytics": ad-blockers block that word (see lib/creatorStats.js).
 */
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';

const API = `${CHECKER_URL}/creator-stats/clip-ideas`;

/**
 * { duration, suggestions: [{ start, end, score, reasons }], signals, short },
 * or null when the session can't be proven or the video is not the user's.
 */
export async function fetchClipIdeas(user, permlink, { lang } = {}) {
  if (!user || !permlink) return null;
  const v = await sessionVouch(user);
  if (!v) return null;
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, signature: v.signature, timestamp: v.timestamp, permlink, ...(lang ? { lang } : {}) }),
  });
  if (res.status === 404 || res.status === 401) return null;
  if (!res.ok) throw new Error(`clip ideas: ${res.status}`);
  const data = await res.json();
  if (!data || data.success !== true) throw new Error((data && data.error) || 'clip ideas');
  return {
    duration: Number(data.duration) || 0,
    short: data.short === true,
    signals: data.signals || {},
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
  };
}

/** A watch-page link that opens the editor on a range (PlayVideo reads `short`). */
export const shortRangeParam = (start, end) => `${Math.max(0, Math.floor(start))}-${Math.max(0, Math.floor(end))}`;

/** The `short=S-E` range from a query string, or null. At most 2 minutes, as the editor holds. */
export function parseShortRange(search) {
  const raw = new URLSearchParams(search || '').get('short');
  const m = /^(\d{1,6})-(\d{1,6})$/.exec(raw || '');
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!(end > start) || end - start > 120) return null;
  return { start, end };
}
