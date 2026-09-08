import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IoIosNotifications } from 'react-icons/io';
import { MdNotificationsActive, MdNotificationsOff } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import {
  pushSupported, getPushState, enablePush, disablePush, syncPushSubscription,
} from '../../utils/webPush';
import { useHiveNotifications } from '../../hooks/useHiveNotifications';
import {
  getNotificationRoute,
  getNotificationActor,
  getNotificationTypeLabel,
  formatNotifTime,
  formatNotificationMsg,
  getNotificationPostKey,
} from '../../utils/notificationHelpers';
import {
  use3SpeakDetection,
  resolveRootPost,
  ensure3SpeakStatus,
} from '../../utils/threeSpeakDetection';
import { groupNotifications } from '../../utils/notificationGrouping';
import { useWhaleDetection } from '../../utils/whaleDetection';
import threeSpeakLogo from '../../assets/image/3S_mark.svg';
import './NotificationBell.scss';

// Every toast from this module is headed "Notifications"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Notifications');

const PREVIEW_LIMIT = 20;
const MAX_STACKED_AVATARS = 4;

function NotificationBell() {
  const { user, authenticated } = useAppStore();
  const [open, setOpen] = useState(false);

  // Browser push, opted into from here — this dropdown IS the notifications UI,
  // so it's where someone looks for "also tell me when I'm not on the site".
  const [push, setPush] = useState({ supported: false, permission: 'default', subscribed: false });
  const [pushBusy, setPushBusy] = useState(false);
  // On mount, not just when the dropdown opens. getPushState() registers the
  // service worker if the page hasn't got a live one, and the bell is on every
  // page — so a tab left over from a build whose worker failed to evaluate
  // heals itself on the next page load instead of staying permanently unable to
  // subscribe. Registering a worker needs no permission and prompts nothing.
  useEffect(() => {
    if (!pushSupported()) return;
    getPushState().then((st) => {
      setPush(st);
      // Server rows get pruned when a push service reports an endpoint gone, so
      // a browser can hold a live subscription the server has forgotten. Re-assert
      // it here rather than leaving the toggle stuck on "On" with nothing arriving.
      if (st.subscribed && user) syncPushSubscription(user);
    }).catch(() => {});
  }, [user]);

  // ...and again whenever the dropdown opens, so the switch reflects a change
  // made in Settings (or another tab) without a reload.
  useEffect(() => {
    if (!open || !pushSupported()) return;
    getPushState().then(setPush).catch(() => {});
  }, [open]);

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (push.subscribed) {
        await disablePush(user);
        toast.success('Notifications turned off for this device');
      } else {
        await enablePush(user);
        toast.success('You will be notified when creators you follow post');
      }
      setPush(await getPushState());
    } catch (err) {
      toast.error(err.message || 'Could not change notification settings');
    } finally {
      setPushBusy(false);
    }
  };
  const [hoveredId, setHoveredId] = useState(null);
  const ref = useRef(null);
  const navigate = useNavigate();

  const {
    notifications,
    loading,
    unreadCount,
    isUnread,
    markAllAsRead,
  } = useHiveNotifications(authenticated ? user : null, { limit: 60 });

  // Grouping
  const grouped = useMemo(() => groupNotifications(notifications), [notifications]);
  const preview = grouped.slice(0, PREVIEW_LIMIT);

  // 3Speak detection
  const postKeys = notifications.map(getNotificationPostKey).filter(Boolean);
  const is3SpeakMap = use3SpeakDetection(postKeys);

  const [rootIs3Speak, setRootIs3Speak] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const key of postKeys) {
        if (rootIs3Speak[key] !== undefined) continue;
        try {
          const rootKey = await resolveRootPost(key);
          const isSpeak = await ensure3SpeakStatus(rootKey);
          if (cancelled) return;
          setRootIs3Speak((prev) =>
            prev[key] === isSpeak ? prev : { ...prev, [key]: isSpeak }
          );
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postKeys.join('|')]);

  // Whale detection for all actors
  const allActors = useMemo(() => {
    const set = new Set();
    for (const n of notifications) {
      const a = getNotificationActor(n);
      if (a) set.add(a);
    }
    return [...set];
  }, [notifications]);
  const whaleMap = useWhaleDetection(allActors);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleToggle = () => {
    setOpen((prev) => !prev);
  };

  const handleRowClick = async (notif) => {
    const route = getNotificationRoute(notif);
    setOpen(false);
    if (!route) return;
    // Navigate to the actual post/comment — PostView handles
    // 3Speak redirect and parent navigation buttons
    navigate(route);
  };

  const handleGroupClick = (group) => {
    // Navigate to the first item's post
    handleRowClick(group.items[0]);
  };

  if (!authenticated || !user) return null;

  const getIs3Speak = (notif) => {
    const pk = getNotificationPostKey(notif);
    return pk ? (is3SpeakMap.get(pk) === true || rootIs3Speak[pk] === true) : false;
  };

  const getWhaleTier = (actor) => {
    if (!actor) return null;
    return whaleMap.get(actor)?.tier || null;
  };

  return (
    <div className="notif-bell-wrapper" ref={ref}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
      >
        <IoIosNotifications size={22} />
        {unreadCount > 0 && (
          <span className="notif-bell-dot" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="notif-dropdown" role="menu">
          <div className="notif-dropdown-header">
            <span className="notif-dropdown-title">Notifications</span>
            <div className="notif-dropdown-actions">
              {pushSupported() && authenticated && (
                <button
                  type="button"
                  className={`notif-push-toggle${push.subscribed ? ' on' : ''}`}
                  onClick={togglePush}
                  disabled={pushBusy || push.permission === 'denied' || push.worker === false}
                  title={push.permission === 'denied'
                    ? 'Notifications are blocked for this site in your browser settings'
                    : push.worker === false
                      ? 'This build has no service worker, so notifications cannot be registered here'
                      : push.subscribed
                        ? 'Stop notifying this device'
                        : 'Get notified when creators you follow post'}
                >
                  {push.subscribed ? <MdNotificationsActive size={15} /> : <MdNotificationsOff size={15} />}
                  <span>{push.subscribed ? 'On' : 'Notify me'}</span>
                </button>
              )}
              <Link
                to="/notifications"
                className="notif-dropdown-seeall"
                onClick={() => setOpen(false)}
              >
                See all
              </Link>
            </div>
          </div>

          {loading && notifications.length === 0 && (
            <div className="notif-dropdown-empty">Loading…</div>
          )}

          {!loading && notifications.length === 0 && (
            <div className="notif-dropdown-empty">You have no notifications yet.</div>
          )}

          {preview.length > 0 && (
            <ul className="notif-list">
              {preview.map((group) => {
                if (group.type === 'group') {
                  return (
                    <GroupRow
                      key={group.id}
                      group={group}
                      isUnread={isUnread}
                      is3Speak={getIs3Speak(group.items[0])}
                      getWhaleTier={getWhaleTier}
                      onClick={() => handleGroupClick(group)}
                      hovered={hoveredId === group.id}
                      onHover={() => setHoveredId(group.id)}
                      onLeave={() => setHoveredId(null)}
                    />
                  );
                }
                const n = group.notification;
                const actor = getNotificationActor(n);
                const tier = getWhaleTier(actor);
                const unread = isUnread(n);
                const is3Speak = getIs3Speak(n);
                return (
                  <li
                    key={group.id}
                    className={`notif-row${unread ? ' notif-row-unread' : ''}${tier ? ` notif-${tier}` : ''}`}
                    onClick={() => handleRowClick(n)}
                  >
                    <div className="notif-avatar-wrap">
                      {actor && (
                        <NotifAvatar actor={actor} />
                      )}
                      {tier && <span className={`notif-tier-badge notif-tier-${tier}`}>{tier === 'whale' ? '🐋' : '🐬'}</span>}
                    </div>
                    <div className="notif-body">
                      <div className="notif-msg">
                        {formatNotificationMsg(n.msg) || getNotificationTypeLabel(n.type)}
                      </div>
                      <div className="notif-meta">
                        <span className="notif-type">{getNotificationTypeLabel(n.type)}</span>
                        <span className="notif-dot">·</span>
                        <span className="notif-time">{formatNotifTime(n.date)}</span>
                      </div>
                    </div>
                    {is3Speak && (
                      <img className="notif-3speak-icon" src={threeSpeakLogo} alt="3Speak" title="3Speak video" />
                    )}
                    {unread && <span className="notif-unread-dot" aria-hidden="true" />}
                    {/* No hover tooltip on single rows: it repeated `n.msg`, which is
                        already the row's own text above, and restated a tier the
                        badge beside the avatar already shows. It covered the rows
                        below it to tell you nothing new. The GROUPED row keeps its
                        tooltip because that one does add something: the collapsed
                        row says "2 Follows" without naming who. */}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders a collapsed group row (votes or follows). */
/**
 * A notification's actor avatar, with a visible fallback.
 *
 * The hive avatar proxy doesn't always answer — on some networks and mobile
 * browsers (tracking protection, DNS filtering) the request just fails. The old
 * handler set `visibility: hidden`, which left a blank 32px hole in the row and
 * made the tier badge look like it was floating on its own. Falling back to the
 * account's initial keeps the row's shape and still says who it was.
 */
function NotifAvatar({ actor, className = 'notif-avatar', style }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`${className} notif-avatar-fallback`} style={style} aria-label={actor}>
        {String(actor || '?').charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={className}
      style={style}
      src={`https://images.hive.blog/u/${actor}/avatar/small`}
      alt={actor}
      onError={() => setFailed(true)}
    />
  );
}

function GroupRow({ group, isUnread, is3Speak, getWhaleTier, onClick, hovered, onHover, onLeave }) {
  const { actors = [], items, notifType, date } = group;
  const hasUnread = items.some((n) => isUnread(n));
  const topActors = actors.slice(0, MAX_STACKED_AVATARS);
  const remaining = actors.length - MAX_STACKED_AVATARS;

  // Check if any actor in the group is a whale/orca
  const topTier = actors.reduce((best, a) => {
    const t = getWhaleTier(a);
    if (t === 'whale') return 'whale';
    if (t === 'orca' && best !== 'whale') return 'orca';
    return best;
  }, null);

  let label;
  if (notifType === 'vote') {
    const names = actors.length <= 2 ? actors.map((a) => `@${a}`).join(' and ') : `@${actors[0]} and ${actors.length - 1} others`;
    label = `${names} voted on your post`;
    if (group.totalValue > 0) label += ` ($${group.totalValue.toFixed(2)})`;
  } else if (notifType === 'follow') {
    const names = actors.length <= 2 ? actors.map((a) => `@${a}`).join(' and ') : `@${actors[0]} and ${actors.length - 1} others`;
    label = `${names} followed you`;
  } else {
    label = `${items.length} ${notifType} notifications`;
  }

  return (
    <li
      className={`notif-row notif-row-group${hasUnread ? ' notif-row-unread' : ''}${topTier ? ` notif-${topTier}` : ''}`}
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <div className="notif-avatar-stack">
        {topActors.map((actor, i) => (
          <NotifAvatar
            key={actor}
            actor={actor}
            className="notif-stacked-avatar"
            style={{ zIndex: MAX_STACKED_AVATARS - i, marginLeft: i === 0 ? 0 : -10 }}
          />
        ))}
        {remaining > 0 && <span className="notif-avatar-more">+{remaining}</span>}
      </div>
      <div className="notif-body">
        <div className="notif-msg">{label}</div>
        <div className="notif-meta">
          <span className="notif-type">{items.length} {notifType}s</span>
          <span className="notif-dot">·</span>
          <span className="notif-time">{formatNotifTime(date)}</span>
          {topTier && <span className="notif-meta-tier">{topTier === 'whale' ? '🐋' : '🐬'}</span>}
        </div>
      </div>
      {is3Speak && (
        <img className="notif-3speak-icon" src={threeSpeakLogo} alt="3Speak" title="3Speak video" />
      )}
      {hasUnread && <span className="notif-unread-dot" aria-hidden="true" />}

      {hovered && (
        <div className="notif-tooltip notif-tooltip-group">
          <div className="notif-tooltip-msg">{label}</div>
          {topTier && (
            <span className="notif-tooltip-tier">
              Includes {topTier === 'whale' ? '🐋 whale' : '🐬 orca'} account(s)
            </span>
          )}
          <div className="notif-tooltip-actors">
            {actors.slice(0, 8).map((a) => {
              const t = getWhaleTier(a);
              return <span key={a} className={t ? `notif-tooltip-actor-${t}` : ''}>@{a}{t ? (t === 'whale' ? ' 🐋' : ' 🐬') : ''}</span>;
            })}
            {actors.length > 8 && <span>and {actors.length - 8} more…</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export default NotificationBell;
