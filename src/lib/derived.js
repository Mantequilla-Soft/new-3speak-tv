/**
 * "Made from this": every post made from another one says so in one place,
 *
 *   json_metadata['3speak'].source = { kind, author, permlink, start?, end? }
 *
 * next to the feature's own older marker (audiogram, remixChain, streamClip,
 * tts.source), and is registered with the checker right after publishing
 * (3speakchecks routes/derived.js, which reads it back from Hive). The source
 * post then lists it in its "Made from this" rail (components/MadeFromThis).
 *
 * `author/permlink` is always the source's HIVE post: a stream's VOD is
 * host/room (the live server publishes it under the room name).
 */
import axios from 'axios';
import { CHECKER_URL } from '../utils/config';
import { watchPath } from '../utils/urls';

/** Every kind; keep in step with 3speakchecks utils/derivedSource.js KINDS. */
export const DERIVED_KINDS = [
  'audiogram', 'stream_clip', 'clip', 'remix', 'reaction', 'narration',
  'recap', 'audio_version', 'quote', 'teaser',
];

const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK_RE = /^[a-z0-9-]{1,255}$/;
const MAX_SECONDS = 24 * 3600;

const seconds = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_SECONDS ? Math.round(n * 10) / 10 : null;
};

/** A clean source, or null when anything is off (then nothing is written). */
export function derivedSource({ kind, author, permlink, start, end } = {}) {
  const a = typeof author === 'string' ? author.trim().toLowerCase().replace(/^@/, '') : '';
  const p = typeof permlink === 'string' ? permlink.trim() : '';
  if (!DERIVED_KINDS.includes(kind) || !ACCOUNT_RE.test(a) || !PERMLINK_RE.test(p)) return null;
  // A snaps container is where Shorts are posted, never what one is made from.
  if (a === 'peak.snaps' || /^snap-container-/.test(p)) return null;
  const out = { kind, author: a, permlink: p };
  const s = seconds(start);
  const e = seconds(end);
  if (s !== null) out.start = s;
  if (e !== null && (s === null || e > s)) out.end = e;
  return out;
}

/** `meta` with the source in its '3speak' block (a copy; `meta` itself is untouched). */
export function withSource(meta, source) {
  const s = source ? derivedSource(source) : null;
  if (!s) return meta;
  return { ...meta, '3speak': { ...(meta?.['3speak'] || {}), source: s } };
}

/**
 * What a post was made from, read from its json_metadata (object or string):
 * the `3speak.source` every derived post now writes, else a stream clip's own
 * block (older clips). A clean source or null.
 */
export function madeFromMeta(meta) {
  let jm = meta;
  if (typeof jm === 'string') {
    try { jm = JSON.parse(jm || '{}'); } catch { return null; }
  }
  if (!jm || typeof jm !== 'object') return null;
  const src = jm['3speak']?.source;
  if (src && typeof src === 'object') return derivedSource(src);
  const clip = jm.video?.streamClip;
  if (clip && typeof clip === 'object') {
    return derivedSource({ kind: clip.recap ? 'recap' : 'stream_clip', author: clip.host, permlink: clip.room, start: clip.offset });
  }
  return null;
}

/** `author/permlink` -> { author, permlink } or null. */
export function splitRef(ref) {
  const m = typeof ref === 'string' && ref.match(/^@?([a-z0-9.-]+)\/([a-z0-9-]+)$/);
  return m ? { author: m[1], permlink: m[2] } : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tell the checker a just-published post was made from another. Best effort: a
 * fresh post can take a few blocks to be readable (404 + retry), anything else
 * ends it. Never throws; true when it is indexed.
 */
export async function registerDerived(author, permlink, { attempts = 6, delayMs = 3000, post = axios.post } = {}) {
  if (!author || !permlink) return false;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await post(`${CHECKER_URL}/derived/register`, { author, permlink }, { timeout: 15000 });
      return res?.data?.success === true;
    } catch (err) {
      const status = err?.response?.status;
      if (!err?.response?.data?.retry && status && status < 500) return false;
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}

/** Register without waiting for it (the publish flow carries on). */
export function registerDerivedLater(author, permlink, opts) {
  registerDerived(author, permlink, opts).catch(() => {});
}

/**
 * What was made from author/permlink:
 * { items: [{ author, permlink, kind, media, title, thumbnail, duration, start?, end?, created }], counts, total },
 * or the empty list when the checker can't be reached. `by` + `media` + `order: 'start'`:
 * one creator's posts of one kind in the order of the source (a virtual series).
 */
export async function fetchDerived(author, permlink, { limit = 24, signal, by = null, media = null, order = null } = {}) {
  const empty = { items: [], counts: {}, total: 0 };
  if (!author || !permlink) return empty;
  const q = new URLSearchParams({ limit: String(limit) });
  if (by) q.set('by', by);
  if (media) q.set('media', media);
  if (order) q.set('order', order);
  try {
    const res = await fetch(`${CHECKER_URL}/derived/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}?${q}`, { signal });
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      items: Array.isArray(data?.items) ? data.items.filter((i) => i && i.author && i.permlink && DERIVED_KINDS.includes(i.kind)) : [],
      counts: data?.counts && typeof data.counts === 'object' ? data.counts : {},
      total: Number(data?.total) || 0,
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return empty;
  }
}

/** Where a derived item opens, in the app. */
export function derivedHref(item) {
  const ref = `${item.author}/${item.permlink}`;
  switch (item.media) {
    case 'short': return `/shorts?v=${ref}`;
    case 'audio': return `/audio/${ref}`;
    case 'video': return watchPath(item.author, item.permlink);
    default: return `/post/${ref}`;
  }
}

/**
 * Where a Short sits among the Shorts its creator cut from the same source
 * (`items` in source order): { part, total, next } or null when it is not one
 * of at least two.
 */
export function sourceSeriesPosition(items, author, permlink) {
  const list = Array.isArray(items) ? items : [];
  const i = list.findIndex((x) => x.author === author && x.permlink === permlink);
  if (i < 0 || list.length < 2) return null;
  return { part: i + 1, total: list.length, next: list[i + 1] || null };
}
