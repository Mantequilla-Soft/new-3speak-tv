/**
 * How far the listener got in outside podcast episodes (External on /audio) and
 * in 3Speak's own audio tracks (keyed by their embed-audio _id; a playlist cover
 * leaves out the finished ones, components/AudioPlaylistTile).
 *
 * The global audio player reports the position of an `external` track as it plays
 * (recordProgress); tiles read it back as a bar and a "listened" mark, and an
 * episode resumes where it was left (resumePosition). It is kept per account on
 * the checker (routes/podcasts.js /progress, a small row per episode played,
 * dropped after 180 days) so it follows the listener across devices, and in this
 * browser so it shows instantly and works signed out too.
 *
 * Saving to the checker happens at most every SYNC_MS, on pause and on leaving
 * the page, with one vouch from our API reused for up to a day: the player never
 * asks the wallet for anything.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { CHECKER_URL } from '../utils/config';
import { fetchSessionVouch } from './sessionVouch';

const API = `${CHECKER_URL}/podcasts`;
const SYNC_MS = 20 * 1000;
const VOUCH_REUSE_MS = 20 * 3600 * 1000;
const LOCAL_MAX = 2000;

/** Same rule as the checker: the last 5 %, or the last 30 s, counts as finished. */
export const isFinished = (pos, dur) => dur > 0 && (pos >= dur * 0.95 || dur - pos <= 30);

let owner;                 // whose progress is in `map` (null: signed out; unset until first asked)
let map = new Map();       // episodeId → { pos, dur, done, at }
let version = 0;
const listeners = new Set();
const dirty = new Set();
let timer = null;
let vouch = null;          // { user, signature, timestamp }

const localKey = (user) => `podcast-progress:${user || '~anon'}`;

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function switchOwner(user) {
  const u = user || null;
  if (u === owner) return;
  // Unsaved positions belong to the account that played them: send them under
  // that account now, never in the next account's save. Played signed out they
  // stay in this browser only, as they always do.
  if (owner && dirty.size) {
    const prev = owner;
    const items = [...dirty].map((id) => itemOf(map, id));
    for (let i = 0; i < items.length; i += 20) postProgress(prev, items.slice(i, i + 20)).catch(() => {});
  }
  dirty.clear();
  owner = u;
  map = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(localKey(u)) || '{}');
    for (const [id, p] of Object.entries(saved)) map.set(id, p);
  } catch { /* nothing saved */ }
  emit();
}

function saveLocal() {
  try {
    const entries = [...map.entries()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, LOCAL_MAX);
    localStorage.setItem(localKey(owner), JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage full or private mode */ }
}

/** { pos, dur, pct (0..100), done } for an episode, or null when never played. */
export function progressOf(id) {
  const p = map.get(id);
  if (!p) return null;
  const pct = p.done ? 100 : p.dur > 0 ? Math.min(100, Math.round((p.pos / p.dur) * 100)) : 0;
  return { ...p, pct };
}

/** Where to start an episode again: a few seconds before where it was left. */
export function resumePosition(user, id) {
  switchOwner(user);
  const p = map.get(id);
  if (!p || p.done || !(p.pos > 15)) return 0;
  return Math.max(0, p.pos - 3);
}

// A failed vouch (no session our API can prove, the API down) is remembered for
// a few minutes, so the reads that ask for it (lib/podcasts.js) don't each try again.
const VOUCH_RETRY_MS = 5 * 60 * 1000;
let vouchFailed = null;    // { user, at }
let vouchInFlight = null;  // { user, promise }

// The shared helper (lib/sessionVouch.js), with this module's action word.
const fetchVouch = (user) => fetchSessionVouch('progress', user);

/**
 * Our API's word for who this session is (action 'progress', payload 'session'),
 * reused for most of a day. Saving progress sends it, and so do the reads that
 * may include a private feed (the checker then knows the reader follows it).
 * One request at a time per user; null when the session can't be proven.
 */
/** Whose session the last good vouch was for (the signed-in listener), or null. */
export const lastVouchUser = () => vouch?.user || null;

export async function sessionVouch(user) {
  if (!user) return null;
  if (vouch && vouch.user === user && Date.now() - vouch.timestamp < VOUCH_REUSE_MS) return vouch;
  if (vouchFailed && vouchFailed.user === user && Date.now() - vouchFailed.at < VOUCH_RETRY_MS) return null;
  if (vouchInFlight?.user === user) return vouchInFlight.promise;
  const promise = fetchVouch(user).then((v) => {
    if (v) { vouch = v; vouchFailed = null; } else vouchFailed = { user, at: Date.now() };
    vouchInFlight = null;
    return v;
  });
  vouchInFlight = { user, promise };
  return promise;
}

/** Send what changed since the last save. Signed out, progress stays in this browser. */
export async function flushProgress({ keepalive = false } = {}) {
  clearTimeout(timer);
  timer = null;
  const user = owner;
  if (!user || !dirty.size) return;
  const items = [...dirty].slice(0, 20).map((id) => itemOf(map, id));
  items.forEach((it) => dirty.delete(it.id));
  try {
    await postProgress(user, items, { keepalive });
  } catch {
    // Still the same listener: try these again next time.
    if (owner === user) items.forEach((it) => dirty.add(it.id));
  }
}

const itemOf = (m, id) => ({ id, pos: m.get(id)?.pos || 0, dur: m.get(id)?.dur || 0 });

/** One save of `items` for `user`. Quietly nothing when the session can't be proven. */
async function postProgress(user, items, { keepalive = false } = {}) {
  const v = await sessionVouch(user);
  if (!v) return;
  await fetch(`${API}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, items, signature: v.signature, timestamp: v.timestamp }),
    keepalive,
  });
}

/** The player's report: `id` is at `pos` of `dur` seconds. */
export function recordProgress(user, id, pos, dur) {
  if (!id || !Number.isFinite(pos) || !(dur > 0)) return;
  switchOwner(user);
  const prev = map.get(id);
  const p = { pos: Math.round(pos), dur: Math.round(dur), done: !!prev?.done || isFinished(pos, dur), at: Date.now() };
  // A tick that moves nothing visible (same second, same state) changes nothing.
  if (prev && prev.pos === p.pos && prev.done === p.done) return;
  map.set(id, p);
  dirty.add(id);
  if (!prev || prev.done !== p.done || Math.abs((prev.pos || 0) - p.pos) >= 5) {
    saveLocal();
    emit();
  }
  if (!timer) timer = setTimeout(() => flushProgress(), SYNC_MS);
}

/** Merge what the checker has (another device may have played further). */
async function loadFromServer(user, query, { timeoutMs } = {}) {
  try {
    const signal = timeoutMs && typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetch(`${API}/progress?user=${encodeURIComponent(user)}&${query}`, { signal });
    const data = await res.json();
    if (owner !== user || !data?.progress) return;
    let changed = false;
    for (const [id, p] of Object.entries(data.progress)) {
      const mine = map.get(id);
      // The furthest position wins; a finished mark is never undone.
      if (!mine || p.pos > mine.pos || (p.done && !mine.done)) {
        map.set(id, { pos: Math.max(p.pos, mine?.pos || 0), dur: p.dur || mine?.dur || 0, done: !!p.done || !!mine?.done, at: mine?.at || 0 });
        changed = true;
      }
    }
    if (changed) { saveLocal(); emit(); }
  } catch { /* the local copy still works */ }
}

/**
 * Bring this browser's copy up to date for `ids` (what another device played),
 * for a decision made right now. Waits at most a moment; the local copy is used
 * when the checker is slow or down. Read the result with progressOf().
 */
export async function loadProgressFor(user, ids) {
  switchOwner(user);
  if (!user) return;
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  const chunks = [];
  for (let i = 0; i < list.length; i += 150) chunks.push(list.slice(i, i + 150));
  await Promise.all(chunks.map((c) => loadFromServer(user, `ids=${c.map(encodeURIComponent).join(',')}`, { timeoutMs: 2500 })));
}

// Tiles that need progress for their tracks (playlist covers) ask through
// wantProgressFor; the ids asked within a moment go out together, each id once
// per signed-in listener and page load.
let wanted = { user: null, ids: new Set(), asked: new Set(), timer: null };

/** Load `user`'s progress for `ids` soon, batched with other tiles' asks. */
export function wantProgressFor(user, ids) {
  if (!user || !ids?.length) return;
  if (wanted.user !== user) {
    clearTimeout(wanted.timer);
    wanted = { user, ids: new Set(), asked: new Set(), timer: null };
  }
  ids.forEach((id) => { if (id && !wanted.asked.has(String(id))) wanted.ids.add(String(id)); });
  if (!wanted.ids.size || wanted.timer) return;
  wanted.timer = setTimeout(() => {
    const list = [...wanted.ids];
    list.forEach((id) => wanted.asked.add(id));
    wanted.ids.clear();
    wanted.timer = null;
    loadProgressFor(user, list);
  }, 150);
}

/** Has `user` played `id` to the end (the last 5 %, or the last 30 s)? */
export function isListened(user, id) {
  switchOwner(user);
  return !!map.get(id)?.done;
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/**
 * Re-renders when any progress changes; loads the user's progress for one show
 * (`feedId`) or a list of episode ids from the checker. Read values with progressOf().
 */
export function usePodcastProgress(user, { feedId, ids } = {}) {
  switchOwner(user);
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  const idKey = ids ? ids.join(',') : '';
  useEffect(() => {
    if (!user) return;
    if (feedId) loadFromServer(user, `feed=${feedId}`);
    else if (idKey) loadFromServer(user, `ids=${idKey}`);
  }, [user, feedId, idKey]);
  return v;
}

// Leaving the page: send the last position along.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flushProgress({ keepalive: true }); });
}

/**
 * Continue listening (the audio page's Mine): what `user` left half way, newest
 * first, from the checker (routes/podcasts.js /progress/recent). Each item is
 * { id, kind: 'episode' | 'track', pos, dur, at } plus `episode` + `feed` or
 * `track`. Their own listening history, so it goes with the session vouch.
 * Empty when the session can't be proven.
 */
export async function fetchContinueListening(user) {
  if (!user) return [];
  const v = await sessionVouch(user);
  if (!v) return [];
  const res = await fetch(`${API}/progress/recent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, signature: v.signature, timestamp: v.timestamp }),
  });
  if (!res.ok) throw new Error(`continue listening: ${res.status}`);
  const data = await res.json();
  // Seed this browser's copy, so the bars and the resume spot agree with it.
  let changed = false;
  for (const it of data.items || []) {
    const mine = map.get(it.id);
    if (owner === user && (!mine || it.pos > mine.pos) && !mine?.done) {
      map.set(it.id, { pos: it.pos, dur: it.dur || mine?.dur || 0, done: false, at: mine?.at || 0 });
      changed = true;
    }
  }
  if (changed) { saveLocal(); emit(); }
  return data.items || [];
}

/**
 * Remove `id` from `user`'s Continue listening, or bring it back (`hidden` false,
 * the Undo). Only that list changes: the position and the listen history stay.
 */
export async function hideFromContinue(user, id, hidden = true) {
  const v = await sessionVouch(user);
  if (!v) throw new Error('not signed in');
  const res = await fetch(`${API}/progress/hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, id, hidden, signature: v.signature, timestamp: v.timestamp }),
  });
  if (!res.ok) throw new Error(`continue listening hide: ${res.status}`);
}
