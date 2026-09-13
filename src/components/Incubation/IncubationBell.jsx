import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IoIosNotifications } from 'react-icons/io';
import { FaHeart, FaReply } from 'react-icons/fa';
import { useAppStore } from '../../lib/store';
import {
  fetchIncubationNotifications, markIncubationNotificationsRead, handleAvatar,
} from '../../lib/incubation';
// The trigger wears NotificationBell's own classes, so it is styled by rules
// already proven in this exact nav slot rather than by a second set of my own
// that has to re-derive the size, colour and hover of a nav icon button. Its
// stylesheet is imported here too, so those rules are present whichever bell
// the nav decides to render.
import '../nav/NotificationBell.scss';
import './IncubationBell.scss';

const REFRESH_MS = 60 * 1000;

function when(at) {
  const secs = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * The notification bell for someone with no Hive account.
 *
 * A SIBLING of NotificationBell rather than a branch inside it. That component
 * is built end to end around bridge.account_notifications -- grouping, whale
 * detection, push subscriptions, 3Speak post resolution -- and none of it
 * applies to a feed derived from two collections. Threading a second source
 * through it would have made both harder to follow.
 *
 * Renders for incubating users only, in the slot the Hive bell occupies for
 * everyone else.
 */
export default function IncubationBell() {
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  const load = useCallback(() => {
    if (!incubationHandle) return;
    fetchIncubationNotifications()
      .then((d) => setData({ items: d.items || [], unread: d.unread || 0 }))
      .catch(() => { /* the bell is not worth an error in the nav */ });
  }, [incubationHandle]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!incubationHandle) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Cleared on open, not on close: the list is on screen the moment it opens,
    // so that is when it has been seen.
    if (next && data.unread > 0) {
      setData((d) => ({ ...d, unread: 0 }));
      markIncubationNotificationsRead().catch(() => { /* it will clear next time */ });
    }
  };

  return (
    <div className="notif-bell-wrapper inc-bell" ref={ref}>
      <button
        type="button"
        className="notif-bell-btn"
        title="Notifications"
        onClick={toggle}
        aria-label={data.unread ? `Notifications, ${data.unread} unread` : 'Notifications'}
      >
        <IoIosNotifications size={22} />
        {data.unread > 0 && <span className="inc-bell-dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>

      {open && (
        <div className="inc-bell-menu">
          <header>Notifications</header>
          {data.items.length === 0 ? (
            <p className="inc-bell-empty">
              Nothing yet. When someone replies to your videos or likes them, it shows up here.
            </p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={`${n.type}-${n.replyPermlink || n.permlink}-${n.at}`}>
                  <Link
                    to={`/watch?v=${incubationHandle}/${n.permlink}`}
                    onClick={() => setOpen(false)}
                  >
                    <img
                      src={n.actor.onChain
                        ? `https://images.hive.blog/u/${n.actor.name}/avatar/small`
                        : handleAvatar(n.actor.name)}
                      alt=""
                      onError={(e) => { e.target.src = handleAvatar(n.actor.name); }}
                    />
                    <span className="inc-bell-text">
                      <span className="inc-bell-line">
                        {n.type === 'reply'
                          ? <FaReply size={11} aria-hidden="true" />
                          : <FaHeart size={11} aria-hidden="true" />}
                        <strong>@{n.actor.name}</strong>
                        {n.type === 'reply' ? ' replied to your post' : ' liked your post'}
                      </span>
                      {n.excerpt && <span className="inc-bell-excerpt">{n.excerpt}</span>}
                      <span className="inc-bell-when">{when(n.at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
