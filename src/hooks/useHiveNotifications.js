import { useState, useEffect, useCallback, useRef } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import axios from 'axios';
import { HIVE_API_URL } from '../utils/config';
import { customJsonWithAioha } from '../hive-api/aioha';
import { KeyTypes } from '@aioha/aioha';

/**
 * Hive notification shape from `bridge.account_notifications`:
 *   { id, type, score, date, msg, url }
 *
 * Known `type` values we surface: reply, reply_comment, mention, vote,
 * follow, reblog, transfer, delegate_vests, receive_vesting, powerdown,
 * subscribe, pin_post, unpin_post, set_role, set_label, set_props,
 * set_role_label, inactive_witness.
 */

// Canonical categories for the UI filters
// labelKey is an i18n key: translate at render with t(cat.labelKey).
export const NOTIF_CATEGORIES = {
  all: { labelKey: 'notifications.categories.all', types: null },
  replies: { labelKey: 'notifications.categories.replies', types: ['reply', 'reply_comment'] },
  mentions: { labelKey: 'notifications.categories.mentions', types: ['mention'] },
  votes: { labelKey: 'notifications.categories.votes', types: ['vote'] },
  reblogs: { labelKey: 'notifications.categories.reblogs', types: ['reblog'] },
  follows: { labelKey: 'notifications.categories.follows', types: ['follow'] },
  transfers: { labelKey: 'notifications.categories.transfers', types: ['transfer'] },
};

const POLL_INTERVAL_MS = 60_000;

async function fetchNotifications(account, limit = 50, lastId = null) {
  const params = { account, limit };
  if (lastId != null) params.last_id = lastId;
  const res = await axios.post(getHiveUrl(), {
    jsonrpc: '2.0',
    method: 'bridge.account_notifications',
    params,
    id: 1,
  });
  if (res.data?.error) throw new Error(res.data.error.message || 'RPC error');
  return Array.isArray(res.data?.result) ? res.data.result : [];
}

/** Fetch Hive's on-chain unread state: { lastread, unread } */
async function fetchUnreadState(account) {
  const res = await axios.post(getHiveUrl(), {
    jsonrpc: '2.0',
    method: 'bridge.unread_notifications',
    params: { account },
    id: 1,
  });
  if (res.data?.error) throw new Error(res.data.error.message || 'RPC error');
  return res.data?.result || { lastread: '1970-01-01T00:00:00', unread: 0 };
}

/** Parse a Hive date string into a Date object. */
function parseHiveDate(dateStr) {
  if (!dateStr) return new Date(0);
  return new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
}

/**
 * React hook that returns the user's Hive notifications along with the
 * on-chain unread count from `bridge.unread_notifications`.
 *
 * Mark-as-read broadcasts a `custom_json` with `id: "notify"` and
 * `json: ["setLastRead", {"date": "..."}]` — the same protocol that
 * PeakD, Ecency, and other frontends use, so read state syncs across
 * all Hive apps.
 *
 * @param {string|null|undefined} user - logged-in Hive account
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {boolean} [opts.poll=true] - re-fetch every POLL_INTERVAL_MS
 */
export function useHiveNotifications(user, { limit = 50, poll = true } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);

  // On-chain unread state from Hive
  const [lastRead, setLastRead] = useState('1970-01-01T00:00:00');
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAsRead, setMarkingAsRead] = useState(false);

  const userRef = useRef(user);
  userRef.current = user;

  // Fetch unread state from Hive
  const fetchUnread = useCallback(async () => {
    if (!user) return;
    try {
      const state = await fetchUnreadState(user);
      if (userRef.current === user) {
        setLastRead(state.lastread || '1970-01-01T00:00:00');
        setUnreadCount(state.unread || 0);
      }
    } catch {
      // Non-critical — silently ignore
    }
  }, [user]);

  const refetch = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setHasMore(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNotifications(user, limit);
      if (userRef.current === user) {
        setNotifications(data);
        setHasMore(data.length >= limit);
      }
    } catch (err) {
      console.error('[notifications] fetch failed:', err);
      if (userRef.current === user) setError(err);
    } finally {
      if (userRef.current === user) setLoading(false);
    }
    // Also refresh unread count
    fetchUnread();
  }, [user, limit, fetchUnread]);

  const loadMore = useCallback(async (overrideLastId) => {
    if (!user || loadingMore || !hasMore) return;
    const oldestId = overrideLastId || notifications[notifications.length - 1]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchNotifications(user, limit, oldestId);
      if (userRef.current === user) {
        setNotifications((prev) => {
          const seen = new Set(prev.map((n) => n.id));
          const additions = data.filter((n) => !seen.has(n.id));
          return [...prev, ...additions];
        });
        setHasMore(data.length >= limit);
      }
    } catch (err) {
      console.error('[notifications] load more failed:', err);
      if (userRef.current === user) setError(err);
    } finally {
      if (userRef.current === user) setLoadingMore(false);
    }
  }, [user, limit, notifications, loadingMore, hasMore]);

  // Initial + user-change fetch
  useEffect(() => {
    setNotifications([]);
    setHasMore(true);
    setLastRead('1970-01-01T00:00:00');
    setUnreadCount(0);
    if (!user) return;
    refetch();
  }, [user, refetch]);

  // Polling
  useEffect(() => {
    if (!user || !poll) return;
    const id = setInterval(refetch, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, poll, refetch]);

  /**
   * Mark all notifications as read by broadcasting a custom_json to Hive.
   * This sets `lastread` on-chain so it syncs across all Hive frontends.
   */
  const markAllAsRead = useCallback(async () => {
    if (!user || markingAsRead || unreadCount === 0) return;
    setMarkingAsRead(true);
    try {
      // Use the newest notification's date, or current UTC time
      const newestDate = notifications.length > 0
        ? notifications[0].date
        : new Date().toISOString().replace('Z', '');

      await customJsonWithAioha(
        KeyTypes.Posting,
        'notify',
        JSON.stringify(['setLastRead', { date: newestDate }]),
        'Mark notifications as read'
      );

      // Optimistically update local state
      setLastRead(newestDate);
      setUnreadCount(0);
    } catch (err) {
      console.error('[notifications] mark all as read failed:', err);
    } finally {
      setMarkingAsRead(false);
    }
  }, [user, notifications, markingAsRead, unreadCount]);

  /**
   * Mark notifications up to a specific date as read.
   * Broadcasts the same custom_json but with that notification's date.
   */
  const markAsRead = useCallback(async (notifDate) => {
    if (!user || markingAsRead) return;
    // Only broadcast if this date is newer than the current lastRead
    const targetDate = typeof notifDate === 'string' ? notifDate : new Date().toISOString().replace('Z', '');
    if (parseHiveDate(targetDate) <= parseHiveDate(lastRead)) return;

    setMarkingAsRead(true);
    try {
      await customJsonWithAioha(
        KeyTypes.Posting,
        'notify',
        JSON.stringify(['setLastRead', { date: targetDate }]),
        'Mark notification as read'
      );

      setLastRead(targetDate);
      // Recalculate unread count from our notifications
      const newLastRead = parseHiveDate(targetDate);
      const newUnread = notifications.filter((n) => parseHiveDate(n.date) > newLastRead).length;
      setUnreadCount(newUnread);
    } catch (err) {
      console.error('[notifications] mark as read failed:', err);
    } finally {
      setMarkingAsRead(false);
    }
  }, [user, notifications, markingAsRead, lastRead]);

  /** Check if a notification is unread based on on-chain lastread */
  const isUnread = useCallback((notif) => {
    if (!notif?.date) return false;
    return parseHiveDate(notif.date) > parseHiveDate(lastRead);
  }, [lastRead]);

  return {
    notifications,
    loading,
    loadingMore,
    hasMore,
    error,
    refetch,
    loadMore,
    unreadCount,
    lastRead,
    markAllAsRead,
    markAsRead,
    markingAsRead,
    isUnread,
  };
}
