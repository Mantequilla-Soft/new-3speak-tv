import { useEffect, useMemo, useSyncExternalStore } from 'react';
import axios from 'axios';
import { CHECKER_URL } from './config';

/**
 * Which videos the transcription pipeline flagged as AI-generated, for FEEDS.
 *
 * The watch page and the shorts panel ask per video (utils/tagsV2). A feed would
 * be one request per card, so every card on screen queues its key here and they
 * go out together as one POST /transcription-tags/ai-batch a moment later. Drives
 * the AI pill on feed cards and the "Hide AI-generated" setting.
 *
 * A key may be the hive author/permlink OR the owner + asset permlink; the checker
 * tries both. Answers are cached for the page load. A failed batch is not retried
 * (the badge is decorative), so an outage reads as "not flagged", never as AI.
 */

const BATCH_MAX = 200;
const FLUSH_MS = 30;

const flags = new Map();      // key -> true | false
const queued = new Set();
const attempted = new Set();  // asked already, answer or not: never ask twice
const pending = new Map();    // key -> promise of the batch that answers it
let batch = null;             // the batch being queued: { promise, resolve }
let timer = null;
let version = 0;
const listeners = new Set();

export const aiKey = (author, permlink) => (author && permlink
  ? `${String(author).trim().toLowerCase().replace(/^@/, '')}/${permlink}`
  : null);

/** true only when the checker said so; false for clean, unknown and not-yet-asked. */
export function isAiFlagged(author, permlink) {
  const k = aiKey(author, permlink);
  return !!k && flags.get(k) === true;
}

function notify() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function flush() {
  timer = null;
  const keys = [...queued];
  queued.clear();
  const { resolve } = batch;
  batch = null;
  doFlush(keys).then(() => {
    keys.forEach((k) => pending.delete(k));
    resolve();
  });
}

async function doFlush(keys) {
  const chunks = [];
  for (let i = 0; i < keys.length; i += BATCH_MAX) chunks.push(keys.slice(i, i + BATCH_MAX));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await axios.post(`${CHECKER_URL}/transcription-tags/ai-batch`, { keys: chunk });
      const hit = new Set(Array.isArray(res.data?.flagged) ? res.data.flagged : []);
      chunk.forEach((k) => flags.set(k, hit.has(k)));
    } catch {
      /* decorative: leave them unknown */
    }
  }));
  if (keys.length) notify();
}

/** Queue lookups for any of these keys we have not asked about yet. */
export function requestAiFlags(keys) {
  let added = false;
  for (const k of keys || []) {
    if (!k || attempted.has(k)) continue;
    if (!batch) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      batch = { promise, resolve };
    }
    attempted.add(k);
    queued.add(k);
    pending.set(k, batch.promise);
    added = true;
  }
  if (added && !timer) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * Resolves once every one of these keys has an answer (or its batch failed).
 * Waits only for the batches holding them: a key a shorts rail asked for first
 * is waited on, but not the grid's batches for other cards. Never rejects.
 */
export function loadAiFlags(keys) {
  requestAiFlags(keys);
  const waits = new Set();
  for (const k of keys || []) {
    const p = k && pending.get(k);
    if (p) waits.add(p);
  }
  return Promise.all(waits).then(() => {});
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getVersion = () => version;

/**
 * Ask about `keys` and re-render when answers arrive. Returns a counter that
 * changes whenever the cache does, for memo deps; read answers with isAiFlagged.
 */
export function useAiFlags(keys) {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const joined = useMemo(() => (keys || []).filter(Boolean).join('\n'), [keys]);
  useEffect(() => {
    if (joined) requestAiFlags(joined.split('\n'));
  }, [joined]);
  return v;
}

/**
 * The shorts swipe feed's version of the "Hide AI-generated" filter. Its list is
 * index-addressed, so a short cannot vanish mid-swipe the way a card can; the
 * page awaits this BEFORE a page of shorts goes in. Costs nothing with the
 * setting off. Like dropWatchedShorts, never empties a first page.
 */
export async function dropAiShorts(list, { allowEmpty = false, hide = false } = {}) {
  if (!hide || !Array.isArray(list) || !list.length) return list;
  const keysOf = (v) => [aiKey(v?.author, v?.permlink), aiKey(v?.author, v?.hivePermlink), aiKey(v?.user?.username, v?.hivePermlink)];
  await loadAiFlags(list.flatMap(keysOf).filter(Boolean));
  const next = list.filter((v) => !keysOf(v).some((k) => k && flags.get(k) === true));
  return (next.length || allowEmpty) ? next : list;
}
