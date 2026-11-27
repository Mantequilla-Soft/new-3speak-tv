import { useEffect, useState } from 'react';
import { defaultEndpoint } from '../../utils/hangoutsEndpoints';

// Channel points from the live server's public routes (hangouts
// routes/points): the balance card (PointsCard) and the movements in the
// wallet's Activity list (PointsHistory) read them from here.

export const POINTS_PAGE = 20;

// Ledger kinds (hangouts lib/pointsLedger.ts) to their icon and label key.
export const POINTS_KIND = {
  watch: { icon: 'visibility', key: 'watch' },
  stream: { icon: 'videocam', key: 'stream' },
  chat: { icon: 'chat', key: 'chat' },
  raid: { icon: 'groups', key: 'raid' },
  battle: { icon: 'swords', key: 'battle' },
  boost: { icon: 'rocket_launch', key: 'boost' },
  spend: { icon: 'rocket_launch', key: 'spend' },
  refund: { icon: 'undo', key: 'refund' },
  prediction: { icon: 'casino', key: 'prediction' },
  expire: { icon: 'hourglass_empty', key: 'expire' },
  login: { icon: 'login', key: 'login' },
  rank: { icon: 'emoji_events', key: 'rank' },
  remix: { icon: 'movie_edit', key: 'remix', ref: 'post' },
  // The earn ideas (hangouts lib/pointsAwards.ts). `ref` says what the
  // movement's ref is: a post (author/permlink), an account, a playlist, a
  // community; nothing links for the others.
  streak: { icon: 'local_fire_department', key: 'streak' },
  week5: { icon: 'event_repeat', key: 'week5' },
  anniv: { icon: 'event', key: 'anniv' },
  first5: { icon: 'play_circle', key: 'first5' },
  vodtime: { icon: 'smart_display', key: 'vodtime' },
  finish: { icon: 'check_circle', key: 'finish', ref: 'post' },
  listen: { icon: 'headphones', key: 'listen' },
  premiere: { icon: 'theaters', key: 'premiere', ref: 'post' },
  playlist: { icon: 'playlist_play', key: 'playlist', ref: 'playlist' },
  first: { icon: 'stars', key: 'first' },
  reach: { icon: 'trending_up', key: 'reach', ref: 'post' },
  storystreak: { icon: 'auto_stories', key: 'storystreak' },
  challenge: { icon: 'trophy', key: 'challenge', ref: 'post' },
  collab: { icon: 'diversity_3', key: 'collab', ref: 'user' },
  premheld: { icon: 'schedule', key: 'premheld' },
  clip: { icon: 'content_cut', key: 'clip', ref: 'user' },
  tag: { icon: 'sell', key: 'tag', ref: 'post' },
  pollvote: { icon: 'how_to_vote', key: 'pollvote' },
  reply: { icon: 'reply', key: 'reply', ref: 'user' },
  community: { icon: 'communities', key: 'community', ref: 'community' },
  tip: { icon: 'volunteer_activism', key: 'tip', ref: 'user' },
  remixed: { icon: 'call_split', key: 'remixed', ref: 'post' },
  raided: { icon: 'group_add', key: 'raided', ref: 'user' },
  followers: { icon: 'person_add', key: 'followers' },
  peak10: { icon: 'monitoring', key: 'peak10' },
  referral: { icon: 'redeem', key: 'referral', ref: 'user' },
  invited: { icon: 'how_to_reg', key: 'invited', ref: 'user' },
  pwa: { icon: 'install_mobile', key: 'pwa' },
  party: { icon: 'celebration', key: 'party' },
  quest: { icon: 'checklist', key: 'quest' },
};

const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const POST_RE = /^([a-z][a-z0-9.-]{2,15})\/([^\s/]+)$/;

/** Who a movement names: a remix's ref is the source post (author/permlink). */
export function pointsRefUser(item) {
  const ref = item?.ref || '';
  return POINTS_KIND[item?.kind]?.ref === 'post' ? ref.split('/')[0] : ref;
}

/**
 * Where a movement's ref leads, or null: { type: 'post', author, permlink },
 * { type: 'user', user }, { type: 'playlist', id } or { type: 'community', id }.
 * Only for the kinds whose ref is one (POINTS_KIND[kind].ref), and only when it
 * looks like one, so an id-shaped ref of another kind never becomes a link.
 */
export function pointsRefLink(item) {
  const ref = String(item?.ref || '');
  switch (POINTS_KIND[item?.kind]?.ref) {
    case 'post': {
      const m = POST_RE.exec(ref);
      return m ? { type: 'post', author: m[1], permlink: m[2] } : null;
    }
    case 'user': return ACCOUNT_RE.test(ref) ? { type: 'user', user: ref } : null;
    case 'playlist': return /^[\w-]{1,64}$/.test(ref) ? { type: 'playlist', id: ref } : null;
    case 'community': return /^hive-\d{1,9}$/.test(ref) ? { type: 'community', id: ref } : null;
    default: return null;
  }
}

/**
 * The video a promotion spend (or its refund) was for: hangouts logs those with
 * the ref 'promote:<author>/<permlink>'. null for every other movement.
 */
export function pointsPromoteRef(item) {
  const m = /^promote:([^/]+)\/(.+)$/.exec(item?.ref || '');
  return m ? { author: m[1], permlink: m[2] } : null;
}

/** One page of `user`'s movements, newest first: { items, next }. */
export async function fetchPointsHistory(user, before) {
  const api = defaultEndpoint().api;
  const q = new URLSearchParams({ limit: String(POINTS_PAGE), ...(before ? { before: String(before) } : {}) });
  const r = await fetch(`${api}/users/${encodeURIComponent(user)}/points/history?${q}`);
  if (!r.ok) throw new Error(`history ${r.status}`);
  return r.json();
}

/**
 * `user`'s balance, expiry and earning rates, or null while loading and when
 * the live server has no points routes (then nothing about points shows).
 */
export function usePointsInfo(user) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const api = defaultEndpoint().api;
    setInfo(null);
    if (!api || !user) return undefined;
    let gone = false;
    (async () => {
      try {
        const r = await fetch(`${api}/users/${encodeURIComponent(user)}/points`);
        if (!r.ok) return;
        const body = await r.json();
        if (!gone && typeof body?.balance === 'number') setInfo(body);
      } catch { /* no points on this server */ }
    })();
    return () => { gone = true; };
  }, [user]);
  return info;
}

/**
 * GET `path` on the live server as JSON, or null: no live server, a server
 * without the route (an older one) or any failure. Points extras show nothing
 * then, never an error.
 */
async function fetchPointsJson(path, signal) {
  const api = defaultEndpoint().api;
  if (!api) return null;
  try {
    const r = await fetch(`${api}${path}`, signal ? { signal } : undefined);
    if (!r.ok) return null;
    const body = await r.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/**
 * The body of GET `path` (null while loading, without it and for no path),
 * passed through `select` when it arrives. A body read for an older path never
 * shows for the new one.
 */
const asIs = (b) => b;

// `select` must be stable (a module-level function).
function usePointsJson(path, select = asIs) {
  const [state, setState] = useState({ path: null, data: null });
  useEffect(() => {
    if (!path) return undefined;
    let gone = false;
    fetchPointsJson(path).then((body) => {
      if (!gone) setState({ path, data: body ? select(body) : null });
    });
    return () => { gone = true; };
  }, [path, select]);
  return path && state.path === path ? state.data : null;
}

/**
 * What every award is worth (hangouts GET /points/awards/config), for the earn
 * explainer on the points card; null without it. `enabled` false skips it.
 */
export function usePointsAwardsConfig(enabled = true) {
  return usePointsJson(enabled ? '/points/awards/config' : null);
}

/** `{ active, until }` from a /points/events body while double points run, else null. */
export function readPointsDouble(body, now = Date.now()) {
  const d = body?.double;
  if (!d || d.active !== true) return null;
  const until = d.until ? new Date(d.until) : null;
  const validUntil = until && !Number.isNaN(until.getTime()) ? until : null;
  if (validUntil && validUntil.getTime() <= now) return null;
  return { active: true, until: validUntil };
}

/**
 * The double points window (hangouts GET /points/events): { active, until? }
 * while every earning pays twice, else null (also without the route).
 */
export function usePointsDouble(enabled = true) {
  return usePointsJson(enabled ? '/points/events' : null, readPointsDouble);
}

/** The quests of a /points/quests body, cleaned up, or null without them. */
export function readPointsQuests(body) {
  if (!body || !Array.isArray(body.quests)) return null;
  const quests = body.quests
    .filter((q) => q && typeof q.id === 'string' && Number(q.target) > 0)
    .map((q) => ({
      id: q.id,
      kind: q.kind,
      target: Number(q.target),
      progress: Math.max(0, Number(q.progress) || 0),
      done: q.done === true,
      points: Number(q.points) || 0,
      titleKey: typeof q.title_key === 'string' ? q.title_key : '',
    }));
  return { week: body.week ?? null, quests };
}

/**
 * `user`'s weekly quests (hangouts GET /points/quests?user=):
 * { week, quests: [{ id, kind, target, progress, done, points, titleKey }] },
 * or null while loading, for nobody and without the route.
 */
export function usePointsQuests(user) {
  return usePointsJson(user ? `/points/quests?user=${encodeURIComponent(user)}` : null, readPointsQuests);
}

/** `{ per24h, maxDays }` from a /points/promote/quote body when promoting with points is on, else null. */
export function readPromoteQuote(body) {
  const per24h = Number(body?.per24h);
  return body?.enabled && per24h > 0 ? { per24h, maxDays: Number(body.maxDays) || 7 } : null;
}

/** What promoting a video costs in points (hangouts GET /points/promote/quote), or null. */
export function usePointsPromoteQuote(enabled = true) {
  return usePointsJson(enabled ? '/points/promote/quote' : null, readPromoteQuote);
}
