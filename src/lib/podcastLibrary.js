/**
 * The listener's own podcast library (Mine on /audio?type=external): the smart
 * filters on episode lists, the "New" inbox, and the shows whose new episodes
 * go to the queue by themselves. Pure rules here, kept in this browser per
 * account; components/Podcasts/PodcastsTab.jsx shows them.
 */

const DAY_MS = 24 * 3600 * 1000;

/** Not started: never played, or stopped in the first seconds. */
export const isUnplayed = (p) => !p || (!p.done && !(p.pos >= 5));
/** Started and not finished. */
export const isInProgress = (p) => !!p && !p.done && p.pos >= 5;

// ─── The "New" inbox ──────────────────────────────────────────────────────────
//
// New = not played yet and published since the earlier of: your last visit to
// Mine, or a week ago. So a daily listener sees the last week's unplayed
// episodes, and someone back after three weeks sees everything since they were
// last here (that is what they missed), never more than INBOX_MAX_DAYS back.
// Playing an episode takes it out. The bell's "seen" time (lib/podcasts.js
// markPodcastNotificationsSeen) is not reused: opening Mine should not clear the
// bell, and the bell only counts shows with notifications on.

export const INBOX_DAYS = 7;
export const INBOX_MAX_DAYS = 30;

/** The publish time after which an episode counts as new. */
export function inboxSince(lastVisit, now = Date.now()) {
  const week = now - INBOX_DAYS * DAY_MS;
  const floor = now - INBOX_MAX_DAYS * DAY_MS;
  return Math.max(floor, lastVisit > 0 ? Math.min(lastVisit, week) : week);
}

export function isInboxEpisode(ep, progress, lastVisit, now = Date.now()) {
  if (!isUnplayed(progress)) return false;
  const at = ep?.published_at ? Date.parse(ep.published_at) : NaN;
  return Number.isFinite(at) && at > inboxSince(lastVisit, now) && at <= now + DAY_MS;
}

const visitKey = (user) => `pod-mine-visit:${user || '~anon'}`;

/** When this account last opened Mine here (ms), 0 for never. */
export function readMineVisit(user) {
  try { return Number(localStorage.getItem(visitKey(user))) || 0; } catch { return 0; }
}

export function markMineVisit(user, at = Date.now()) {
  try { localStorage.setItem(visitKey(user), String(at)); } catch { /* storage off */ }
}

// ─── Filters ──────────────────────────────────────────────────────────────────

/**
 * Does `ep` pass the listening filter? `ctx`: { progressOf(id), isDownloaded(id),
 * lastVisit, now } (progressOf from lib/podcastProgress.js, isDownloaded from
 * lib/podcastDownloads.js).
 */
export function matchesListenFilter(ep, filter, ctx) {
  const p = () => ctx.progressOf(ep.id);
  switch (filter) {
    case 'new': return isInboxEpisode(ep, p(), ctx.lastVisit, ctx.now);
    case 'unplayed': return isUnplayed(p());
    case 'inProgress': return isInProgress(p());
    case 'downloaded': return ctx.isDownloaded(ep.id);
    default: return true;
  }
}

/** The seasons among `episodes`, lowest first. */
export function seasonsOf(episodes) {
  return [...new Set((episodes || []).map((e) => Number(e.season)).filter((n) => n > 0))].sort((a, b) => a - b);
}

/** Is one of this show's live streams on air? (the LIVE mark on Mine's show cards) */
export const isLiveNow = (feed) => (feed?.live || []).some((l) => l?.status === 'live');

/** The newest trailer (episodes come newest first), or null. */
export const trailerOf = (episodes) => (episodes || []).find((e) => e.episode_type === 'trailer') || null;

// ─── New episodes straight to the queue ───────────────────────────────────────
//
// Per show and per account, in this browser: { feeds: { [feedId]: onSince }, added: [ids] }.
// onSince is when the switch was turned on; only episodes that came out after it
// count, so turning it on never floods the queue with the back catalogue. The
// /latest list has no "first seen" time, so the publish date stands in for it.

const AUTO_KEY = (user) => `pod-autoqueue:${user || '~anon'}`;
const ADDED_MAX = 500;

export function readAutoQueue(user) {
  try {
    const v = JSON.parse(localStorage.getItem(AUTO_KEY(user)) || 'null');
    return { feeds: v?.feeds && typeof v.feeds === 'object' ? v.feeds : {}, added: Array.isArray(v?.added) ? v.added : [] };
  } catch {
    return { feeds: {}, added: [] };
  }
}

function writeAutoQueue(user, value) {
  try { localStorage.setItem(AUTO_KEY(user), JSON.stringify(value)); } catch { /* storage off */ }
}

export const autoQueueOn = (user, feedId) => !!readAutoQueue(user).feeds[feedId];

export function setAutoQueue(user, feedId, on, now = Date.now()) {
  const v = readAutoQueue(user);
  if (on) v.feeds[feedId] = now; else delete v.feeds[feedId];
  writeAutoQueue(user, v);
}

/** Remember episodes that went to the queue, so each goes there once. */
export function markAutoQueued(user, ids) {
  if (!ids.length) return;
  const v = readAutoQueue(user);
  v.added = [...new Set([...v.added, ...ids])].slice(-ADDED_MAX);
  writeAutoQueue(user, v);
}

/**
 * The episodes to put at the end of the queue now, oldest first: from a show
 * with the switch on, out after it was turned on, not played, not queued, not
 * playing and never added before.
 * `ctx`: { progressOf(id), queuedIds: Set, currentId }.
 */
export function pickAutoQueue(episodes, settings, ctx) {
  const added = new Set(settings.added || []);
  const out = [];
  for (const ep of episodes || []) {
    const onSince = settings.feeds?.[ep.feed_id];
    if (!onSince || added.has(ep.id) || ctx.queuedIds?.has(ep.id) || ctx.currentId === ep.id) continue;
    const at = Date.parse(ep.first_seen_at || ep.published_at || '');
    if (!(at > onSince) || !isUnplayed(ctx.progressOf(ep.id))) continue;
    out.push({ ep, at });
    added.add(ep.id);
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.ep);
}

// ─── Small formatting ─────────────────────────────────────────────────────────

/** 754 → "12:34", 3723 → "1:02:03". */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** 1536000 → "1.5 MB". */
export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} kB`;
  return `${b} B`;
}

/** A link to an episode page that starts at `t` (and stops at `end`), absolute. */
export function episodeShareUrl(origin, path, t, end) {
  const qs = [];
  if (Number(t) > 0) qs.push(`t=${Math.floor(Number(t))}`);
  if (Number(end) > Number(t || 0)) qs.push(`end=${Math.ceil(Number(end))}`);
  return `${origin}${path}${qs.length ? `${path.includes('?') ? '&' : '?'}${qs.join('&')}` : ''}`;
}

/** The ?t= / &end= of a deep link: { t, end } in seconds (null when absent or bad). */
export function deepLinkTimes(params) {
  const num = (v) => (v != null && /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : null);
  const t = num(params.get('t'));
  const end = num(params.get('end'));
  return { t: t > 0 ? t : null, end: end != null && end > (t || 0) ? end : null };
}
