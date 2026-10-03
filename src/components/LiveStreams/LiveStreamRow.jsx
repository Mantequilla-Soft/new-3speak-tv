import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { getFollowing } from '../../utils/hiveUtils';
import './LiveStreamRow.scss';

const API_URL = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');

/**
 * A row of currently-live OpenPods standalone streams, shown at the top of a
 * feed. Cards link to /watch/<roomName> with a LIVE badge (top-right).
 * Renders nothing when nothing is live.
 *
 * `following` filters to streamers the signed-in user follows (used on the
 * Follow feed). For now the /streams endpoint includes unlisted streams so
 * they can be tested; production will filter to public.
 */
export default function LiveStreamRow({ title = 'Live now', following = false }) {
  const [streams, setStreams] = useState([]);
  const [followSet, setFollowSet] = useState(null); // null = not loaded yet
  const user = useAppStore((s) => s.user);

  // Load the follow list once when in "following" mode.
  useEffect(() => {
    let alive = true;
    if (!following) { setFollowSet(null); return undefined; }
    if (!user) { setFollowSet(new Set()); return undefined; }
    getFollowing(user, '', 1000)
      .then((list) => { if (alive) setFollowSet(new Set(list || [])); })
      .catch(() => { if (alive) setFollowSet(new Set()); });
    return () => { alive = false; };
  }, [following, user]);

  useEffect(() => {
    let alive = true;
    if (!API_URL) return undefined;
    const load = () => {
      // no-store so a stale (empty) /streams response can't be served from
      // the browser/CDN cache once streams go live.
      fetch(`${API_URL}/streams`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : []))
        .then((list) => { if (alive) setStreams((Array.isArray(list) ? list : []).filter((s) => s.live)); })
        .catch(() => { if (alive) setStreams([]); });
    };
    load();
    const t = setInterval(load, 30000); // refresh live status
    return () => { alive = false; clearInterval(t); };
  }, []);

  const visible = useMemo(() => {
    if (!following) return streams;
    if (!followSet) return []; // still loading the follow list
    return streams.filter((s) => followSet.has(s.host));
  }, [streams, following, followSet]);

  if (visible.length === 0) return null;

  return (
    <div className="live-row">
      <h2 className="live-row-title"><span className="live-row-dot" /> {title}</h2>
      <div className="live-row-grid">
        {visible.map((s) => (
          <Link key={s.name} to={`/watch/${s.name}`} className="live-card" title={s.title}>
            <div className="live-card-thumb" style={s.thumbnail ? { backgroundImage: `url(${s.thumbnail})` } : undefined}>
              {!s.thumbnail && <span className="live-card-thumb-fallback">{s.title}</span>}
              <span className="live-card-badge">● LIVE</span>
            </div>
            <div className="live-card-info">
              <img className="live-card-avatar" src={`/img/u/${s.host}/avatar/small`} alt={s.host} loading="lazy" />
              <div className="live-card-text">
                <span className="live-card-name">{s.title}</span>
                <span className="live-card-host">@{s.host}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
