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
let waiters = [];             // resolve after the NEXT flush
let inflight = Promise.resolve(); // settles when every started flush has
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
  const run = doFlush();
  inflight = Promise.all([inflight, run]);
}

async function doFlush() {
  const keys = [...queued];
  queued.clear();
  const done = waiters;
  waiters = [];
  for (let i = 0; i < keys.length; i += BATCH_MAX) {
    const chunk = keys.slice(i, i + BATCH_MAX);
    try {
      const res = await axios.post(`${CHECKER_URL}/transcription-tags/ai-batch`, { keys: chunk });
      const hit = new Set(Array.isArray(res.data?.flagged) ? res.data.flagged : []);
      chunk.forEach((k) => flags.set(k, hit.has(k)));
    } catch {
      /* decorative: leave them unknown */
    }
  }
  if (keys.length) notify();
  done.forEach((fn) => fn());
}

/** Queue lookups for any of these keys we have not asked about yet. */
export function requestAiFlags(keys) {
  let added = false;
  for (const k of keys || []) {
    if (!k || attempted.has(k)) continue;
    attempted.add(k);
    queued.add(k);
    added = true;
  }
  if (added && !timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Resolves once every key has an answer (or its batch failed). Never rejects. */
export function loadAiFlags(keys) {
  requestAiFlags(keys);
  // Keys asked for earlier may still be in flight (a shorts rail on the page
  // asked first), so wait for those batches as well as the one just queued.
  const current = inflight;
  const next = timer ? new Promise((resolve) => { waiters.push(resolve); }) : null;
  return Promise.all([current, next]).then(() => inflight).then(() => {});
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
