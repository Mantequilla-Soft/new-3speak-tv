/**
 * Episodes saved in this browser for listening without a connection.
 *
 * The audio is kept as a Blob in IndexedDB (database `podcast-downloads`: the
 * files in `files`, one small row per episode in `meta`), so it is per browser,
 * not per account: signed out works too, and signing in or out keeps it. The
 * player asks isDownloaded() (synchronous) and then plays localAudioUrl()
 * instead of the network address (src/components/GlobalAudioPlayer).
 *
 * Where the audio comes from:
 * - an outside episode: straight from the podcast's host when it allows other
 *   sites to read it (CORS), else through the checker
 *   (routes/podcasts.js /episode/:id/download), which has a size cap (413) and a
 *   rate limit (429);
 * - a 3Speak audio: our audio gateway, which allows CORS.
 *
 * Errors carry a `code` ('too_large', 'rate_limited' (also the checker's 503
 * busy), 'storage', 'failed',
 * 'cancelled', 'no_source') that the page turns into a message.
 */
import { useSyncExternalStore } from 'react';
import { CHECKER_URL } from '../utils/config';
import { sessionVouch, lastVouchUser } from './podcastProgress';

const API = `${CHECKER_URL}/podcasts`;
const AUDIO_GATEWAY = 'https://ipfs-audio.3speak.tv/ipfs';
const DB_NAME = 'podcast-downloads';
const MIRROR_KEY = 'podcast-downloads-ids';
// Progress for a host that sends no length: guessed from the episode's
// duration at 128 kbit/s, and never shown as done before it is.
const GUESS_BYTES_PER_SEC = 16000;
const EMIT_EVERY_MS = 250;

export function downloadError(code, status) {
  const err = new Error(code);
  err.code = code;
  if (status) err.status = status;
  return err;
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('aborted'));
});

/** The store, a thin wrapper over IndexedDB. Null where there is none (old browsers, tests). */
function idbBackend() {
  if (typeof indexedDB === 'undefined') return null;
  let opening = null;
  const open = () => {
    opening = opening || new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => { opening = null; reject(r.error); };
    });
    return opening;
  };
  return {
    async list() {
      const db = await open();
      return req(db.transaction('meta').objectStore('meta').getAll());
    },
    async put(meta, blob) {
      const db = await open();
      const tx = db.transaction(['files', 'meta'], 'readwrite');
      tx.objectStore('files').put(blob, meta.id);
      tx.objectStore('meta').put(meta);
      return done(tx);
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction(['files', 'meta'], 'readwrite');
      tx.objectStore('files').delete(id);
      tx.objectStore('meta').delete(id);
      return done(tx);
    },
    async blob(id) {
      const db = await open();
      return req(db.transaction('files').objectStore('files').get(id));
    },
  };
}

// ─── What is saved ────────────────────────────────────────────────────────────

let backend = null;
let index = new Map();       // id → { id, track, bytes, type, savedAt }
let loaded = false;
let ready = Promise.resolve();
let mirror = readMirror();   // the ids saved last time, until the store has answered
const jobs = new Map();      // id → { promise, ctrl }
let progress = {};           // id → 0..1 while downloading
let estimate = null;         // navigator.storage.estimate(): { usage, quota }
let persistAsked = false;
const listeners = new Set();
let snapshot = null;
let emitTimer = null;

function readMirror() {
  try { return new Set(JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]')); } catch { return new Set(); }
}
function writeMirror() {
  mirror = new Set(index.keys());
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify([...mirror])); } catch { /* storage off */ }
}

function emit() {
  clearTimeout(emitTimer);
  emitTimer = null;
  snapshot = null;
  listeners.forEach((fn) => fn());
}
// Download progress changes many times a second; the page needs a few frames.
function emitSoon() {
  if (!emitTimer) emitTimer = setTimeout(emit, EMIT_EVERY_MS);
}

async function refreshEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) { estimate = { usage: e.usage || 0, quota: e.quota || 0 }; emit(); }
  } catch { /* not offered */ }
}

function load(store) {
  backend = store;
  index = new Map();
  loaded = false;
  ready = (async () => {
    try {
      for (const m of (backend ? await backend.list() : [])) if (m?.id) index.set(m.id, m);
    } catch { /* blocked storage: nothing saved here */ }
    loaded = true;
    writeMirror();
    emit();
    refreshEstimate();
  })();
  return ready;
}

load(idbBackend());

/** Tests: swap the store for an in-memory one and start over. */
export function _useBackendForTests(store) {
  jobs.clear();
  progress = {};
  persistAsked = false;
  return load(store);
}

// ─── The interface the player relies on ───────────────────────────────────────

/**
 * True when the track with this id is saved here. Synchronous: from the store's
 * index once it has loaded, before that from the list kept in localStorage.
 */
export function isDownloaded(id) {
  if (!id) return false;
  return loaded ? index.has(id) : mirror.has(id);
}

/**
 * A fresh object URL for the saved audio of this track, or null. The caller owns
 * it and revokes it when done (the player does when it moves on): one shared URL
 * would die for everyone the first time someone revoked it.
 */
export async function localAudioUrl(id) {
  if (!id) return null;
  await ready;
  if (!backend || !index.has(id)) return null;
  try {
    const blob = await backend.blob(id);
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/**
 * Where to fetch a track's audio, in order: [{ url, checker }]. A private
 * feed's audio may sit behind its login, so it only comes through the checker,
 * with the session vouch (`vouch`, 'vu=..&vts=..&vsig=..').
 */
export function sourcesFor(track, vouch = '') {
  if (!track?._id || track.live) return [];
  if (!track.external) {
    return track.audio_cid ? [{ url: `${AUDIO_GATEWAY}/${track.audio_cid}`, checker: false }] : [];
  }
  const out = [];
  const viaChecker = `${API}/episode/${encodeURIComponent(track._id)}/download`;
  if (track.private) return [{ url: vouch ? `${viaChecker}?${vouch}` : viaChecker, checker: true }];
  if (/^https?:\/\//i.test(track.src || '')) out.push({ url: track.src, checker: false });
  out.push({ url: viaChecker, checker: true });
  return out;
}

// The vouch a private feed's download needs (see lib/podcasts.js vouchQuery).
async function vouchFor(track) {
  const user = track?.private ? lastVouchUser() : null;
  const v = user ? await sessionVouch(user) : null;
  return v ? String(new URLSearchParams({ vu: user, vts: String(v.timestamp), vsig: v.signature })) : '';
}

// A host that answers with a web page (a login, an error) did not give us audio.
const looksLikeAudio = (res) => !/^text\/|json/i.test(res.headers.get('content-type') || '');

async function openSource(track, signal) {
  const sources = sourcesFor(track, await vouchFor(track));
  if (!sources.length) throw downloadError('no_source');
  let last = downloadError('failed');
  for (const s of sources) {
    let res;
    try {
      res = await fetch(s.url, { mode: 'cors', credentials: 'omit', signal });
    } catch (err) {
      // CORS refused or the network failed: try the next way.
      if (err?.name === 'AbortError') throw downloadError('cancelled');
      continue;
    }
    if (res.ok && looksLikeAudio(res)) return res;
    if (s.checker && res.status === 413) last = downloadError('too_large', 413);
    // 429: this address asked too often; 503: the checker is busy with other downloads.
    else if (s.checker && (res.status === 429 || res.status === 503)) last = downloadError('rate_limited', res.status);
    else last = downloadError('failed', res.status);
  }
  throw last;
}

async function readAll(res, id, track, signal) {
  const type = (res.headers.get('content-type') || '').split(';')[0].trim() || track.mime || 'audio/mpeg';
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body?.getReader) return new Blob([await res.blob()], { type });
  const guess = total || (track.duration > 0 ? track.duration * GUESS_BYTES_PER_SEC : 0);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  const stop = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      received += value.byteLength;
      if (guess) {
        progress = { ...progress, [id]: Math.min(0.99, received / guess) };
        emitSoon();
      }
    }
  } catch (err) {
    if (signal.aborted) throw downloadError('cancelled');
    throw err?.code ? err : downloadError('failed');
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (signal.aborted) throw downloadError('cancelled');
  if (total && received < total) throw downloadError('failed');
  return new Blob(chunks, { type });
}

// Ask the browser not to clear saved episodes when space runs low. Once, on the
// first download; the browser may say no, and downloads work all the same.
async function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) await navigator.storage.persist();
  } catch { /* not offered */ }
}

// What the Downloads list needs to show and play a track later, without
// anything only the current page knows.
const storedTrack = (track) => JSON.parse(JSON.stringify(track));

/** Save a track (an outside episode or a 3Speak audio). Resolves when done. */
export async function downloadTrack(track) {
  const id = track?._id;
  if (!id || track.live) throw downloadError('no_source');
  // Registered before anything is awaited, so a second click joins this one.
  if (jobs.has(id)) return jobs.get(id).promise;
  const ctrl = new AbortController();
  const promise = (async () => {
    await ready;
    if (index.has(id)) return;
    if (!backend) throw downloadError('storage');
    askPersist();
    const res = await openSource(track, ctrl.signal);
    const blob = await readAll(res, id, track, ctrl.signal);
    const meta = { id, track: storedTrack(track), bytes: blob.size, type: blob.type, savedAt: Date.now() };
    try {
      await backend.put(meta, blob);
    } catch {
      throw downloadError('storage');
    }
    index.set(id, meta);
    writeMirror();
    refreshEstimate();
  })().finally(() => {
    jobs.delete(id);
    const { [id]: _gone, ...rest } = progress;
    progress = rest;
    emit();
  });
  jobs.set(id, { promise, ctrl });
  progress = { ...progress, [id]: 0 };
  emit();
  return promise;
}

/** Stop a download that is running. Its downloadTrack() rejects with code 'cancelled'. */
export function cancelDownload(id) {
  jobs.get(id)?.ctrl.abort();
}

/** Forget a saved track. */
export async function removeDownload(id) {
  if (!id) return;
  cancelDownload(id);
  await ready;
  if (backend) {
    try { await backend.remove(id); } catch { /* gone already */ }
  }
  index.delete(id);
  writeMirror();
  emit();
  refreshEstimate();
}

// ─── React ────────────────────────────────────────────────────────────────────

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const EMPTY = { items: [], progress: {}, usedBytes: 0, estimate: null, ready: false };

function getSnapshot() {
  if (!snapshot) {
    const items = [...index.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    snapshot = {
      items,
      progress,
      usedBytes: items.reduce((n, m) => n + (m.bytes || 0), 0),
      // How much this site keeps in the browser in all (the app's caches too) and may keep.
      estimate,
      ready: loaded,
    };
  }
  return snapshot;
}

/**
 * React hook: { items: [{ id, track, bytes, savedAt }], progress: { [id]: 0..1 }, usedBytes,
 * estimate: { usage, quota } | null, ready }. Re-renders when any of it changes.
 */
export function useDownloads() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
