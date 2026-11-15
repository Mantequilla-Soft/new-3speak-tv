/**
 * Notification levels per followed creator (the bell on a channel page) and the
 * checker's own notification feed ("went live", collab invites), both on the
 * checker (routes/notify.js) with the session vouch (lib/podcastProgress.js).
 *
 *   all         everything: videos, shorts, stories, audio, going live (the default)
 *   highlights  videos, audio and going live; no shorts and no stories
 *   off         nothing from this creator, and no place in "Live now" on Home
 *
 * The account-wide push switches (Settings > Notifications) still apply on top.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { CHECKER_URL } from '../utils/config';
import { sessionVouch } from './podcastProgress';

export const LEVELS = ['all', 'highlights', 'off'];
export const DEFAULT_LEVEL = 'all';
const HIGHLIGHT_KINDS = new Set(['videos', 'audio', 'live', 'podcasts']);

/** Same rule as the checker (utils/notifyLevels.js). */
export function levelAllows(level, kind) {
  if (level === 'off') return false;
  if (level === 'highlights') return HIGHLIGHT_KINDS.has(kind);
  return true;
}

async function post(path, user, body = {}) {
  const v = await sessionVouch(user);
  if (!v) throw new Error('not signed in');
  const res = await fetch(`${CHECKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, user, signature: v.signature, timestamp: v.timestamp }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** { creator: 'highlights' | 'off' }; a creator not in it is at 'all'. */
export async function fetchNotifyLevels(user) {
  if (!user) return {};
  return (await post('/notify/levels', user)).levels || {};
}

export async function saveNotifyLevel(user, creator, level) {
  return (await post('/notify/level', user, { creator, level })).level;
}

const levelsKey = (user) => ['notify-levels', user];

/** The signed-in viewer's levels as a plain object (empty while loading or signed out). */
export function useNotifyLevels(user) {
  const { data } = useQuery({
    queryKey: levelsKey(user),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchNotifyLevels(user),
  });
  return data || {};
}

export const levelOf = (levels, creator) => (levels && levels[String(creator || '').toLowerCase()]) || DEFAULT_LEVEL;

/** Save one level, optimistic, rolled back when the checker says no. */
export function useSetNotifyLevel(user) {
  const qc = useQueryClient();
  return async (creator, level) => {
    const key = levelsKey(user);
    const before = qc.getQueryData(key) || {};
    const next = { ...before };
    if (level === DEFAULT_LEVEL) delete next[creator]; else next[creator] = level;
    qc.setQueryData(key, next);
    try {
      await saveNotifyLevel(user, creator, level);
    } catch (err) {
      qc.setQueryData(key, before);
      throw err;
    }
    // Feeds that read the levels (bell, Live now) follow on their next poll.
    qc.invalidateQueries({ queryKey: ['checker-notifications', user] });
  };
}

// ─── The checker's notification feed ────────────────────────────────────────
// Not Hive notifications: injected next to the Hive list like the 24h stories,
// so they keep their own "seen until" in this browser.

const SEEN_KEY = (user) => `checker-notifs-seen:${user}`;
const listeners = new Set();
const readSeen = (user) => {
  try { return Number(localStorage.getItem(SEEN_KEY(user))) || 0; } catch { return 0; }
};
const subscribeSeen = (fn) => {
  listeners.add(fn);
  const onStorage = (e) => { if (String(e.key || '').startsWith('checker-notifs-seen:')) fn(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
};

export function markCheckerNotificationsSeen(user) {
  if (!user) return;
  try { localStorage.setItem(SEEN_KEY(user), String(Date.now())); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

export async function fetchCheckerNotifications(user) {
  if (!user) return [];
  return (await post('/notify/feed', user, { limit: 20 })).notifications || [];
}

/** [{ id, type, actor, title, url, thumbnail, at, seen, ... }], newest first. */
export function useCheckerNotifications(user) {
  const seenAt = useSyncExternalStore(subscribeSeen, () => (user ? readSeen(user) : 0), () => 0);
  const { data } = useQuery({
    queryKey: ['checker-notifications', user],
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
    queryFn: () => fetchCheckerNotifications(user),
  });
  const items = (data || []).map((n) => ({ ...n, seen: new Date(n.at).getTime() <= seenAt }));
  return { items, unseenCount: items.filter((n) => !n.seen).length };
}
