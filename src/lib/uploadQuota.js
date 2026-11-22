// ⏳ Daily upload limits for the free plan (owner's rules, 2026-11-20).
//
// Non-Pro Hive accounts: 1 regular video + 3 Shorts per rolling 24 hours
// (stories count as Shorts, stream VODs never count), and 2 audio uploads per
// rolling 24 hours, each at most 15 minutes. YouTube / TikTok imports count as
// videos; Narrate and Audio Editor exports go out through the audio uploader, so
// they count as audio. 3Speak Pro has no limits.
//
// Warm-up accounts (no Hive account yet, owner 2026-11-22): 3 regular videos +
// 3 Shorts per rolling 24 hours, counted under the warm-up handle, and no audio
// limit. The embed API answers `plan: 'warmup'` for them. Uploads made during
// the warm-up never count for the Hive account it turns into (the embed API
// leaves them out), so publishing the backlog after graduation is never held up.
//
// The backends decide and enforce; this module only reads their answer so the
// UI can say so before a file is picked, and turns their refusals into a
// message the creator understands:
//   video  GET  {EMBED_API_URL}/uploads/quota?owner=<name>          (X-API-Key)
//          POST {base}/uploads/token over the limit → 429 { code: 'daily_upload_limit', kind, limit, used, next_at }
//   audio  GET  {THREESPEAK_AUDIO_API_URL}/api/audio/quota          (X-API-Key, X-User)
//          POST /api/audio/upload → 413 { code: 'audio_too_long', max_seconds, duration }
//                                 → 429 { code: 'daily_audio_limit', limit, used, next_at }
//
// 🚨 FAIL OPEN. The limits ship behind backend flags, default off, and until a
// backend deploys its quota route answers 404. Any failure to read a quota means
// "no limit known": nothing is shown and nothing is blocked. Only an answer with
// `enabled: true` ever limits anything.
// Read at call time, not import time: modules that only need the refusal
// helpers below (utils/audioUpload.js) never touch these.
import * as config from '../utils/config';

export const VIDEO_LIMIT_CODE = 'daily_upload_limit';
export const AUDIO_LIMIT_CODE = 'daily_audio_limit';
export const AUDIO_TOO_LONG_CODE = 'audio_too_long';
/** Used for wording when a refusal or counter does not say how long a file may be. */
export const DEFAULT_AUDIO_MAX_SECONDS = 15 * 60;

const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** A timestamp (ISO string, seconds or ms) as ms, or null. */
export function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null;
  const n = Number(v);
  if (Number.isFinite(n)) return toMs(n);
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

/** One kind's counter → { limit, used, remaining, nextAt }, or null when it says nothing usable. */
function normEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const limit = num(raw.limit);
  if (!Number.isFinite(limit) || limit < 0) return null;
  const used = Number.isFinite(num(raw.used)) ? Math.max(0, num(raw.used)) : 0;
  const remaining = Number.isFinite(num(raw.remaining)) ? Math.max(0, num(raw.remaining)) : Math.max(0, limit - used);
  return { limit, used, remaining, nextAt: toMs(raw.next_at ?? raw.nextAt) };
}

/** Which limit the embed API applied: 'warmup' for a warm-up account, else the free plan. */
const planOf = (raw) => (raw === 'warmup' ? 'warmup' : 'free');

/**
 * The embed API's quota answer → null (no limit known: off, unreadable) |
 * { exempt: true, reason } | { exempt: false, plan, video, short }. Each
 * counter carries the `plan` too, so its wording follows it.
 */
export function normalizeVideoQuota(data) {
  if (!data || typeof data !== 'object' || data.enabled !== true) return null;
  if (data.exempt) return { exempt: true, reason: data.reason || null };
  const plan = planOf(data.plan);
  const withPlan = (entry) => (entry ? { ...entry, plan } : null);
  return { exempt: false, reason: null, plan, video: withPlan(normEntry(data.video)), short: withPlan(normEntry(data.short)) };
}

/** The audio API's quota answer, the same way; `audio` also carries `maxSeconds`. */
export function normalizeAudioQuota(data) {
  if (!data || typeof data !== 'object' || data.enabled !== true) return null;
  if (data.exempt) return { exempt: true, reason: data.reason || null };
  // The service answers nulls for limit / remaining / next_at / max_seconds to
  // exempt accounts and to everyone while the limits are off: a null limit is
  // no counter, a null max_seconds no length limit.
  const entry = normEntry(data.audio);
  if (entry) {
    const max = num(data.audio.max_seconds ?? data.audio.maxSeconds);
    entry.maxSeconds = Number.isFinite(max) && max > 0 ? max : null;
  }
  return { exempt: false, reason: null, audio: entry };
}

async function getJson(url, headers) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { headers, signal: ctrl?.signal });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The video and Short counters for a Hive account or a warm-up handle. null = no limit known. */
export async function fetchVideoQuota(owner) {
  const base = String(config.EMBED_API_URL || '').replace(/\/+$/, '');
  if (!owner || !base) return null;
  const key = config.EMBED_API_KEY;
  const data = await getJson(
    `${base}/uploads/quota?owner=${encodeURIComponent(owner)}`,
    key ? { 'X-API-Key': key } : {},
  );
  return normalizeVideoQuota(data);
}

/** The free-plan audio counter for a Hive account. null = no limit known. */
export async function fetchAudioQuota(user) {
  const base = String(config.THREESPEAK_AUDIO_API_URL || '').replace(/\/+$/, '');
  if (!user || !base) return null;
  const key = config.THREESPEAK_API_KEY;
  const data = await getJson(`${base}/api/audio/quota`, {
    ...(key ? { 'X-API-Key': key } : {}),
    'X-User': user,
  });
  return normalizeAudioQuota(data);
}

// ── Cache + refresh ──────────────────────────────────────────────────────────
// One read per account and kind a minute, shared by every screen that shows it.
// refreshUploadQuota() drops it and tells every mounted useUploadQuota to read
// again: called after each upload that went through, and after a refusal.
const cache = new Map(); // `${kind}:${user}` → { value: Promise, expires }
const listeners = new Set();

function cached(kind, user, load, fresh) {
  const key = `${kind}:${String(user).toLowerCase()}`;
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.value;
  const value = load(user).catch(() => null);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** { video, audio } quotas for `user` (each null when unknown or not asked for). */
export async function loadUploadQuotas(user, { video = true, audio = true, fresh = false } = {}) {
  if (!user) return { video: null, audio: null };
  const [v, a] = await Promise.all([
    video ? cached('video', user, fetchVideoQuota, fresh) : null,
    audio ? cached('audio', user, fetchAudioQuota, fresh) : null,
  ]);
  return { video: v, audio: a };
}

export function subscribeUploadQuota(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forget what is known and have every quota on screen read again. */
export function refreshUploadQuota() {
  cache.clear();
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* one listener never stops the rest */ }
  }
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/**
 * A limit refusal from the server → { code, kind, limit, used, nextAt,
 * maxSeconds, duration }, or null when it is something else (a plain 429 from a
 * rate limiter stays a rate limit).
 */
export function parseUploadLimit(status, body, fallbackKind = 'video') {
  const b = body && typeof body === 'object' ? body : {};
  if (status === 429 && b.code === VIDEO_LIMIT_CODE) {
    return {
      code: VIDEO_LIMIT_CODE,
      kind: b.kind === 'short' ? 'short' : (b.kind === 'video' ? 'video' : fallbackKind),
      plan: planOf(b.plan),
      limit: Number.isFinite(num(b.limit)) ? num(b.limit) : null,
      used: Number.isFinite(num(b.used)) ? num(b.used) : null,
      nextAt: toMs(b.next_at),
    };
  }
  if (status === 429 && b.code === AUDIO_LIMIT_CODE) {
    return {
      code: AUDIO_LIMIT_CODE,
      kind: 'audio',
      limit: Number.isFinite(num(b.limit)) ? num(b.limit) : null,
      used: Number.isFinite(num(b.used)) ? num(b.used) : null,
      nextAt: toMs(b.next_at),
    };
  }
  if (status === 413 && b.code === AUDIO_TOO_LONG_CODE) {
    const max = num(b.max_seconds);
    return {
      code: AUDIO_TOO_LONG_CODE,
      kind: 'audio',
      maxSeconds: Number.isFinite(max) && max > 0 ? max : DEFAULT_AUDIO_MAX_SECONDS,
      duration: Number.isFinite(num(b.duration)) ? num(b.duration) : null,
    };
  }
  return null;
}

/** parseUploadLimit for an axios error. */
export function uploadLimitFromAxios(err, fallbackKind) {
  const res = err?.response;
  if (!res) return null;
  return parseUploadLimit(res.status, res.data, fallbackKind);
}

export const isUploadLimitCode = (code) => code === VIDEO_LIMIT_CODE || code === AUDIO_LIMIT_CODE || code === AUDIO_TOO_LONG_CODE;

/** An Error carrying the refusal: `code` as the server sent it, the rest under `limit`. */
export function uploadLimitError(info, message) {
  const err = new Error(message || info?.code || 'upload limit');
  err.code = info?.code;
  err.limit = info;
  return err;
}

export const isUploadLimitError = (err) => !!err && isUploadLimitCode(err.code) && !!err.limit;

// ── Wording ──────────────────────────────────────────────────────────────────

/** "14:32" when `ms` is today, else "Sat 14:32", in the reader's language and time zone. */
export function formatNextAt(ms, lang, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  try {
    return d.toLocaleString(lang || undefined, sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.toLocaleTimeString();
  }
}

/** "4:05", "1:02:03". */
export function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "Next upload at 14:32." or "Try again later." */
export function nextUploadText(t, nextAt, lang, now) {
  const time = formatNextAt(nextAt, lang, now);
  return time ? t('uploadLimits.nextAt', { time }) : t('uploadLimits.later');
}

/** The message for a refusal (or a used-up counter): what was reached and when it frees up. */
export function uploadLimitMessage(t, info, lang, now) {
  if (!info) return '';
  if (info.code === AUDIO_TOO_LONG_CODE) {
    const minutes = Math.round((info.maxSeconds || DEFAULT_AUDIO_MAX_SECONDS) / 60);
    return info.duration
      ? t('uploadLimits.tooLong', { duration: formatDuration(info.duration), minutes })
      : t('uploadLimits.tooLongPlain', { minutes });
  }
  const kind = info.kind === 'short' || info.kind === 'audio' ? info.kind : 'video';
  const reached = info.plan === 'warmup' && kind !== 'audio' ? 'reachedWarmup' : 'reached';
  return `${t(`uploadLimits.${reached}.${kind}`)} ${nextUploadText(t, info.nextAt, lang, now)}`;
}

/** A counter as a refusal-shaped object, for the same wording before anything is sent. */
export const usedUpInfo = (entry, kind) => ({
  code: kind === 'audio' ? AUDIO_LIMIT_CODE : VIDEO_LIMIT_CODE,
  kind,
  plan: entry?.plan === 'warmup' ? 'warmup' : 'free',
  limit: entry?.limit ?? null,
  used: entry?.used ?? null,
  nextAt: entry?.nextAt ?? null,
});

/** Is this counter used up? (null = no limit known = never.) */
export const isUsedUp = (entry) => !!entry && entry.remaining <= 0;

/** The Pro section of the viewer's own wallet. */
export const proPlansPath = (user) => (user ? `/wallet/${encodeURIComponent(user)}#pro` : '/');
