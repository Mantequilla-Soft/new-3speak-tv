/**
 * How far the listener got in outside podcast episodes (External on /audio).
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
import { getCurrentProvider, Providers } from '../hive-api/aioha';
import { CHECKER_URL } from '../utils/config';

const API = `${CHECKER_URL}/podcasts`;
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';
const SYNC_MS = 20 * 1000;
const VOUCH_REUSE_MS = 20 * 3600 * 1000;
const LOCAL_MAX = 2000;

/** Same rule as the checker: the last 5 %, or the last 30 s, counts as finished. */
export const isFinished = (pos, dur) => dur > 0 && (pos >= dur * 0.95 || dur - pos <= 30);

let owner = null;          // whose progress is in `map`
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

async function fetchVouch(user) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (getCurrentProvider() === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${THREESPEAK_API}/podcasts/signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ action: 'progress', payload: 'session' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.signature || data.username !== user) return null;
    return { user, signature: data.signature, timestamp: data.timestamp };
  } catch {
    return null;
  }
}

/**
 * Our API's word for who this session is (action 'progress', payload 'session'),
 * reused for most of a day. Saving progress sends it, and so do the reads that
 * may include a private feed (the checker then knows the reader follows it).
 * One request at a time per user; null when the session can't be proven.
 */
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
  const items = [...dirty].slice(0, 20).map((id) => ({ id, pos: map.get(id)?.pos || 0, dur: map.get(id)?.dur || 0 }));
  items.forEach((it) => dirty.delete(it.id));
  const v = await sessionVouch(user);
  if (!v) return;
  try {
    await fetch(`${API}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, items, signature: v.signature, timestamp: v.timestamp }),
      keepalive,
    });
  } catch {
    items.forEach((it) => dirty.add(it.id));
  }
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
async function loadFromServer(user, query) {
  try {
    const res = await fetch(`${API}/progress?user=${encodeURIComponent(user)}&${query}`);
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
