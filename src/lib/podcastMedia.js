/**
 * Chapters and transcripts of outside podcast episodes. Feeds link them
 * (podcast:chapters, podcast:transcript, psc:chapters) on hosts that rarely
 * allow other sites to read them, so the checker fetches and normalises them
 * (3speakchecks routes/podcasts.js /episode/:id/chapters and /transcript).
 */
import { CHECKER_URL } from '../utils/config';
// The namespace, for vouchQuery (lib/podcasts.js): a private feed's chapters and
// transcript need the same proof of following as its episodes.
import * as podcastsLib from './podcasts';

const API = `${CHECKER_URL}/podcasts`;
const cache = new Map();

async function getOnce(key, url) {
  if (cache.has(key)) return cache.get(key);
  const p = fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  cache.set(key, p);
  const data = await p;
  // A failure is not remembered: the next track change tries again.
  if (!data) cache.delete(key);
  return data;
}

// "vu=&vts=&vsig=" for an episode of a private feed, '' otherwise (or when
// there's no proof to give: the checker then answers 404, which reads as none).
async function vouchFor(opts) {
  if (!opts?.private || typeof podcastsLib.vouchQuery !== 'function') return '';
  try {
    const q = await podcastsLib.vouchQuery();
    return typeof q === 'string' ? q.replace(/^[?&]/, '') : '';
  } catch { return ''; }
}

const withQuery = (url, q) => (q ? `${url}${url.includes('?') ? '&' : '?'}${q}` : url);

/**
 * [{ start, end?, title, img?, url? }] sorted by start, or [] when there are none.
 * `{ private: true }` for an episode of a private feed.
 */
export async function fetchChapters(episodeId, opts) {
  if (!episodeId) return [];
  const url = withQuery(`${API}/episode/${encodeURIComponent(episodeId)}/chapters`, await vouchFor(opts));
  const data = await getOnce(`c:${episodeId}`, url);
  return Array.isArray(data?.chapters) ? data.chapters : [];
}

/**
 * { lang, languages, cues: [{ start, end, text, speaker? }] } for one language
 * (the feed's first when none is asked for), or null. `{ private: true }` as
 * for fetchChapters.
 */
export async function fetchTranscript(episodeId, lang, opts) {
  if (!episodeId) return null;
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const url = withQuery(`${API}/episode/${encodeURIComponent(episodeId)}/transcript${q}`, await vouchFor(opts));
  const data = await getOnce(`t:${episodeId}:${lang || ''}`, url);
  return Array.isArray(data?.cues) ? data : null;
}

/** The chapter playing at `time` (seconds), or null. */
export function chapterAt(chapters, time) {
  let cur = null;
  for (const c of chapters || []) {
    if (c.start <= time) cur = c; else break;
  }
  return cur && (cur.end == null || time < cur.end) ? cur : null;
}
