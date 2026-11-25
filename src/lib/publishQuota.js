// ⏳ Daily PUBLISH limits for the free plan (owner's rules, 2026-11-25).
//
// A free Hive account publishes at most 1 regular video and 3 Shorts per
// rolling 24 hours (stories count as Shorts). Uploading is not limited any
// more: anything over the limit is uploaded and scheduled on a free time.
// Two publishes are compared by their PUBLISH time: "publish now" is now, a
// scheduled post is its scheduledOn, so a video scheduled for tomorrow never
// counts against today. Stream VODs, audio posts and drafts never count.
// 3Speak Pro, a server exemption list and warm-up accounts are exempt.
//
// The checker decides and enforces; this module only reads its answer so the
// studio can say so before anything is sent, and turns its refusals into a
// message the creator understands:
//   GET  {SCHEDULED_CHECKER_BASE}/publish-quota/:owner?kind=video|short[&at=ISO][&exclude=permlink]
//        → { enabled, exempt, reason, kind, limit, window_hours, at, allowed,
//            conflicts: [{ permlink, title, at, scheduled }], next_free_at }
//   POST /scheduled-posts/create | update | publish over the limit
//        → 429 { code: 'daily_publish_limit', kind, limit, conflicts, next_free_at, upgrade_url }
//
// 🚨 FAIL OPEN. Until the checker deploys the route it answers 404. Any failure
// to read the quota means "no limit known": nothing is shown and nothing is
// blocked. Only an answer with `enabled: true` and `allowed: false` blocks.
import { SCHEDULED_CHECKER_BASE } from '../utils/scheduledPosts';
import { formatDateTimeLocal } from '../utils/schedulingHelpers';
import { toMs } from './uploadQuota';

export const PUBLISH_LIMIT_CODE = 'daily_publish_limit';
export const PUBLISH_KINDS = ['video', 'short'];

const CACHE_TTL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 6000;
// More than this many conflicting publishes are never spelled out one by one.
const MAX_CONFLICTS_SHOWN = 3;

const kindOf = (v, fallback = 'video') => (v === 'short' || v === 'video' ? v : fallback);
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** One publish that takes the slot → { permlink, title, at (ms), scheduled }, or null. */
function normConflict(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const at = toMs(raw.at);
  if (at === null) return null;
  return {
    permlink: raw.permlink ? String(raw.permlink) : '',
    title: raw.title ? String(raw.title) : '',
    at,
    scheduled: raw.scheduled === true,
  };
}

const normConflicts = (list) => (Array.isArray(list) ? list.map(normConflict).filter(Boolean) : []);

/**
 * The checker's answer → null (no limit known: off, unreadable) |
 * { exempt: true, reason } | { exempt: false, kind, limit, at, allowed,
 * conflicts, nextFreeAt } (times in ms).
 */
export function normalizePublishQuota(data) {
  if (!data || typeof data !== 'object' || data.enabled !== true) return null;
  if (data.exempt) return { exempt: true, reason: data.reason || null };
  // An answer that does not say whether the time is free says nothing.
  if (typeof data.allowed !== 'boolean') return null;
  const limit = num(data.limit);
  return {
    exempt: false,
    reason: null,
    kind: kindOf(data.kind),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    at: toMs(data.at),
    allowed: data.allowed,
    conflicts: normConflicts(data.conflicts),
    nextFreeAt: toMs(data.next_free_at),
  };
}

/** Does this answer hold the publish back? (null = no limit known = never.) */
export const isPublishBlocked = (q) => !!q && !q.exempt && q.allowed === false;

/** `at` as an ISO string for the query, or '' (now). Accepts ms, ISO or a datetime-local value. */
export function atParam(at) {
  if (at === null || at === undefined || at === '') return '';
  const ms = typeof at === 'number' ? at : Date.parse(String(at));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

async function getJson(url) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { signal: ctrl?.signal });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether `owner` may publish a `kind` at `at` (default now), leaving the
 * scheduled post `exclude` out (the one being rescheduled). null = no limit known.
 */
export async function fetchPublishQuota(owner, { kind = 'video', at = null, exclude = '' } = {}) {
  const base = String(SCHEDULED_CHECKER_BASE || '').replace(/\/+$/, '');
  if (!owner || !base) return null;
  const params = new URLSearchParams({ kind: kindOf(kind) });
  const iso = atParam(at);
  if (iso) params.set('at', iso);
  if (exclude) params.set('exclude', String(exclude));
  const data = await getJson(`${base}/publish-quota/${encodeURIComponent(owner)}?${params}`);
  if (!data || data.success === false) return null;
  return normalizePublishQuota(data);
}

// ── Cache + refresh ──────────────────────────────────────────────────────────
// One read per account, kind, time and excluded post for half a minute, shared
// by every screen asking the same. refreshPublishQuota() drops it and tells
// every mounted usePublishQuota to read again: after a publish or a schedule
// went through, and after a refusal.
const cache = new Map();
const listeners = new Set();

export function loadPublishQuota(owner, { kind = 'video', at = null, exclude = '', fresh = false } = {}) {
  if (!owner) return Promise.resolve(null);
  const key = [String(owner).toLowerCase(), kindOf(kind), atParam(at) || 'now', exclude || ''].join('|');
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.value;
  const value = fetchPublishQuota(owner, { kind, at, exclude }).catch(() => null);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export function subscribePublishQuota(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forget what is known and have every publish quota on screen read again. */
export function refreshPublishQuota() {
  cache.clear();
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* one listener never stops the rest */ }
  }
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/**
 * A 429 from the scheduled-posts routes → { code, kind, limit, conflicts,
 * nextFreeAt, allowed: false }, or null when it is something else (a plain 429
 * from a rate limiter stays a rate limit). Shaped like a blocked quota, so the
 * same wording serves both.
 */
export function parsePublishLimit(status, body, fallbackKind = 'video') {
  const b = body && typeof body === 'object' ? body : {};
  if (status !== 429 || b.code !== PUBLISH_LIMIT_CODE) return null;
  const limit = num(b.limit);
  return {
    code: PUBLISH_LIMIT_CODE,
    exempt: false,
    kind: kindOf(b.kind, kindOf(fallbackKind)),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    allowed: false,
    conflicts: normConflicts(b.conflicts),
    nextFreeAt: toMs(b.next_free_at),
  };
}

/** parsePublishLimit for an axios error (or anything with `response`). */
export function publishLimitFromError(err, fallbackKind) {
  const res = err?.response;
  if (!res) return null;
  return parsePublishLimit(res.status, res.data, fallbackKind);
}

// ── Wording ──────────────────────────────────────────────────────────────────

/** "26 Nov 2026, 14:32" in the reader's language and time zone (the scheduling UI's format). */
export function formatPublishTime(ms, lang) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  try {
    return d.toLocaleString(lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toLocaleString();
  }
}

/** The free plan's rule for the kind: "The free plan publishes 1 video per 24 hours." */
export function publishRuleText(t, info) {
  const kind = kindOf(info?.kind);
  const count = info?.limit || (kind === 'short' ? 3 : 1);
  return t(`publishLimits.rule.${kind}`, { count });
}

/** One line per publish that takes the slot, oldest first ("“Trip” was published at …"). */
export function conflictLines(t, info, lang) {
  return (info?.conflicts || []).slice(0, MAX_CONFLICTS_SHOWN).map((c) => {
    const time = formatPublishTime(c.at, lang);
    const key = c.scheduled ? 'scheduled' : 'published';
    return c.title
      ? t(`publishLimits.conflict.${key}`, { title: c.title, time })
      : t(`publishLimits.conflict.${key}Untitled`, { time });
  });
}

/** "Earliest free time: 26 Nov 2026, 14:32." or "Pick a later time." */
export function nextFreeText(t, info, lang) {
  const time = formatPublishTime(info?.nextFreeAt, lang);
  return time ? t('publishLimits.earliest', { time }) : t('publishLimits.later');
}

/**
 * The message for a refusal or a blocked time, all in one line: what is taken,
 * the rule, what takes it, the earliest free time. `now` says whether the time
 * asked for was "publish now" (else a scheduled time).
 */
export function publishLimitMessage(t, info, lang, { now = false } = {}) {
  if (!info) return '';
  return [
    t(now ? 'publishLimits.nowTaken' : 'publishLimits.timeTaken'),
    publishRuleText(t, info),
    ...conflictLines(t, info, lang),
    nextFreeText(t, info, lang),
  ].join(' ');
}

/**
 * The earliest free time as a "YYYY-MM-DDTHH:mm" value for the schedule
 * pickers: rounded up to the next whole minute (the pickers have no seconds,
 * and rounding down could land a few seconds inside the taken window), never
 * before `min` (the pickers' own earliest, now + 15 minutes). '' without one.
 */
export function nextFreeLocalValue(nextFreeAt, minMs = 0) {
  if (!Number.isFinite(nextFreeAt)) return '';
  const minute = 60 * 1000;
  const ms = Math.ceil(Math.max(nextFreeAt, minMs || 0) / minute) * minute;
  return formatDateTimeLocal(new Date(ms));
}
