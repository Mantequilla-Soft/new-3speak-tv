/**
 * The pure parts of the global audio player: playback speed, the sleep timer,
 * chapter markers, timestamp and clip links, the skip-silence detector and the
 * per-host CORS cache. No DOM, no React, so they can be tested on their own
 * (tests/unit/lib/audioPlayerMath.test.js).
 */

// ─── Time ─────────────────────────────────────────────────────────────────────

export function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const s = Math.floor(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Seconds from a `t=` / `end=` link value: "83", "83.5", "1:23", "1:02:03" or
 * "1h2m3s". null when it isn't a time.
 */
export function parseTimeParam(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    return s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  }
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (m && (m[1] || m[2] || m[3])) return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return null;
}

/** A live item whose stream is HLS (by its type, or an .m3u8 address). */
export function isHlsTrack(track) {
  if (!track) return false;
  if (/mpegurl/i.test(String(track.mime || track.type || ''))) return true;
  return /\.m3u8(\?|#|$)/i.test(String(track.src || ''));
}

// ─── Playback speed ───────────────────────────────────────────────────────────

// Up to 2x: faster than that, speech stops being worth listening to.
export const SPEEDS = [0.5, 0.8, 1, 1.2, 1.5, 1.8, 2];
export const SPEED_KEY = '3speak-audio-speed';

/** One of SPEEDS (the nearest), or 1 for anything that isn't a number. */
export function normalizeSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return SPEEDS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1);
}

/** "1.5×" style label, without a trailing ".0". */
export const formatSpeed = (v) => `${Number(v).toString()}×`;

// ─── Skip buttons ─────────────────────────────────────────────────────────────

export const SKIP_BACK = 15;
export const SKIP_FORWARD = 30;

/** Where a skip by `delta` seconds lands, kept inside 0..duration (when known). */
export function skipTarget(current, delta, duration) {
  const to = (Number(current) || 0) + delta;
  const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.max(0, Math.min(max, to));
}

// ─── Sleep timer ──────────────────────────────────────────────────────────────

// Minutes, plus 'end' for "at the end of this episode". 0 = off.
export const SLEEP_OPTIONS = [0, 5, 15, 30, 45, 60, 'end'];
export const SLEEP_FADE_MS = 8000;

/** A timer that runs `minutes` from `now`, or one that waits for the episode to end. */
export function startSleepTimer(option, now) {
  if (option === 'end') return { mode: 'end' };
  const m = Number(option);
  if (!Number.isFinite(m) || m <= 0) return null;
  return { mode: 'minutes', minutes: m, endsAt: now + m * 60000 };
}

/**
 * Milliseconds of listening left before the timer stops playback. For "end of
 * episode" that is the rest of the episode at the current speed. null when it
 * can't be told (no timer, or no duration yet).
 */
export function sleepRemainingMs(timer, { now, currentTime, duration, rate = 1 }) {
  if (!timer) return null;
  if (timer.mode === 'minutes') return Math.max(0, timer.endsAt - now);
  if (timer.mode === 'end') {
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const r = rate > 0 ? rate : 1;
    return Math.max(0, ((duration - (currentTime || 0)) / r) * 1000);
  }
  return null;
}

/** The volume factor (0..1) for the fade over the last few seconds. */
export function sleepFadeFactor(remainingMs, fadeMs = SLEEP_FADE_MS) {
  if (remainingMs == null || remainingMs >= fadeMs) return 1;
  return Math.max(0, Math.min(1, remainingMs / fadeMs));
}

// ─── Chapters ─────────────────────────────────────────────────────────────────

/**
 * Where each chapter starts along the timeline, as a fraction 0..1. The first
 * chapter (at 0) and anything past the end draw no marker.
 */
export function chapterMarkers(chapters, duration) {
  if (!Array.isArray(chapters) || !(duration > 0)) return [];
  return chapters
    .filter((c) => Number.isFinite(c?.start) && c.start > 0 && c.start < duration)
    .map((c) => c.start / duration);
}

/** Index of the chapter playing at `time` (the last one started), or -1. */
export function chapterIndexAt(chapters, time) {
  let idx = -1;
  for (let i = 0; i < (chapters || []).length; i++) {
    if (chapters[i].start <= time) idx = i; else break;
  }
  return idx;
}

/**
 * Where "previous chapter" and "next chapter" go from `time`. Like the
 * previous-track button, previous first restarts the current chapter when it
 * has been playing for more than 3 seconds. null where there is nowhere to go.
 */
export function chapterJumps(chapters, time) {
  const list = chapters || [];
  const i = chapterIndexAt(list, time);
  const next = i + 1 < list.length ? list[i + 1].start : null;
  let prev = null;
  if (i >= 0 && time - list[i].start > 3) prev = list[i].start;
  else if (i > 0) prev = list[i - 1].start;
  else if (i === 0) prev = list[0].start;
  return { index: i, prev, next };
}

// ─── Timestamp and clip links ─────────────────────────────────────────────────

/** `url` with `t=` (and `end=` for a clip) added, whole seconds. */
export function withTimestamp(url, t, end) {
  const params = [];
  const from = Math.max(0, Math.floor(Number(t) || 0));
  if (from > 0) params.push(`t=${from}`);
  if (end != null && Number.isFinite(Number(end))) {
    const to = Math.ceil(Number(end));
    if (to > from) params.push(`end=${to}`);
  }
  if (!params.length) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`;
}

export const CLIP_MIN = 15;
export const CLIP_MAX = 90;

/** A clip of `length` seconds (kept to 15..90) starting at `start`, cut at the end of the episode. */
export function clipRange(start, length, duration) {
  const len = Math.max(CLIP_MIN, Math.min(CLIP_MAX, Math.round(Number(length) || CLIP_MIN)));
  const from = Math.max(0, Math.floor(Number(start) || 0));
  let to = from + len;
  if (Number.isFinite(duration) && duration > 0) to = Math.min(to, Math.ceil(duration));
  return { start: from, end: Math.max(from + 1, to) };
}

// ─── Skip silence ─────────────────────────────────────────────────────────────

export const SILENCE_DB = -45;
export const SILENCE_HOLD_MS = 300;

/** The speed used to rush through a pause: 2.5 times the chosen one, at most 4×. */
export const skipRate = (speed) => Math.min(4, (Number(speed) || 1) * 2.5);

/**
 * Loudness of a block of samples in dBFS, corrected for the element's own
 * volume (the analyser hears the audio after it, so a quiet volume would look
 * like silence). -Infinity for true silence or a muted element.
 */
export function levelDb(samples, volume = 1) {
  if (!samples?.length || !(volume > 0)) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms) - 20 * Math.log10(volume);
}

/**
 * The skip-silence state machine. Fed the current level every few dozen
 * milliseconds, it says whether to rush: once the level has stayed under the
 * threshold for `holdMs`, until it comes back above it (with a little headroom
 * so it doesn't flicker on the edge).
 */
export function createSilenceDetector({ thresholdDb = SILENCE_DB, holdMs = SILENCE_HOLD_MS, releaseDb = thresholdDb + 3 } = {}) {
  let belowSince = null;
  let skipping = false;
  return {
    update(db, now) {
      if (skipping) {
        if (db > releaseDb) { skipping = false; belowSince = null; }
      } else if (db < thresholdDb) {
        if (belowSince == null) belowSince = now;
        if (now - belowSince >= holdMs) skipping = true;
      } else {
        belowSince = null;
      }
      return skipping;
    },
    reset() { belowSince = null; skipping = false; },
    get skipping() { return skipping; },
  };
}

/** Listening time saved by `wallMs` played at `rate` instead of `speed`. */
export function savedMs(wallMs, rate, speed) {
  if (!(wallMs > 0) || !(rate > speed) || !(speed > 0)) return 0;
  return wallMs * (rate / speed - 1);
}

/** "1 h 2 min", "3 min 4 s", "12 s" for the time-saved line. */
export function fmtSaved(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${s} s`;
}

// ─── CORS per host ────────────────────────────────────────────────────────────
// Web Audio can only read an element whose source allows CORS (otherwise it
// plays silence, and the element can never be taken out of the graph again).
// Outside podcast hosts are tried once and remembered here.

export const CORS_CACHE_KEY = '3speak-audio-cors';
const CORS_OK_TTL = 30 * 86400000;
const CORS_BAD_TTL = 3 * 86400000;
// Sources known to allow CORS: our own audio gateways (AUDIO_GATEWAYS in
// GlobalAudioPlayer.jsx), which send access-control-allow-origin: *.
export const CORS_HOSTS = ['ipfs-audio.3speak.tv', 'ipfs-3speak.b-cdn.net'];

export function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

function readMap(storage) {
  try {
    const m = JSON.parse(storage?.getItem(CORS_CACHE_KEY) || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}

/**
 * Whether `url` can go through Web Audio: true, false, or null when this host
 * hasn't been tried (or the answer is too old). Blob URLs and our own origin
 * always can.
 */
export function corsKnown(url, { storage, now = Date.now(), origin } = {}) {
  if (!url) return false;
  if (url.startsWith('blob:')) return true;
  const host = hostOf(url);
  if (!host) return false;
  if (CORS_HOSTS.includes(host)) return true;
  if (origin && hostOf(origin) === host) return true;
  const hit = readMap(storage)[host];
  if (!hit || !Number.isFinite(hit.at)) return null;
  const ttl = hit.ok ? CORS_OK_TTL : CORS_BAD_TTL;
  return now - hit.at < ttl ? !!hit.ok : null;
}

/** Remember the answer for this URL's host. */
export function rememberCors(url, ok, { storage, now = Date.now() } = {}) {
  const host = hostOf(url);
  if (!host || !storage) return;
  const m = readMap(storage);
  m[host] = { ok: !!ok, at: now };
  // A few hundred hosts at most; keep the newest 200.
  const entries = Object.entries(m).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
  try { storage.setItem(CORS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* storage full or off */ }
}
