import { useEffect, useRef } from 'react';
import { getPlayerUrl } from '../utils/playerUrl';
import { useAppStore } from '../lib/store';
import { viewerRewardsName } from '../utils/viewerRewards';
import { fetchWatchToken } from '../lib/advertiseData';

// When a session could not be opened (not opted in yet, stream in standby, player
// unreachable), ask again after this long rather than on every tick.
const RETRY_MS = 60 * 1000;

/**
 * Stream-viewer rewards: watching a live stream earns from the same viewer pool as
 * videos, paid as 'stream-viewer' (owner, 2026-11-09).
 *
 * Opens a live session on the player service (POST /api/watch/start, type 'live',
 * owner = host, permlink = room) and beats every few seconds while `active` and the
 * tab is in front. The SERVER times the seconds between beats, checks the room is
 * really live, and decides what qualifies (5 min on screen, 20 min cap per stream),
 * so nothing claimed here can raise a payout.
 *
 * Only for a viewer who opted into rewards: a live session records nothing else
 * (no view-durations, no heatmap), so there is no reason to open one for anybody
 * else. viewerRewardsName() answers null on its first call while it primes, so the
 * first try after a page load usually waits one RETRY_MS.
 *
 * Hidden tab: one beat on the way out (the seconds up to then were watched), none
 * while away, and a `hidden` beat on the way back, which tells the server the gap
 * since the last beat was not watched.
 *
 * @param {object}  args
 * @param {string}  args.host    the stream's host account
 * @param {string}  args.room    the room name
 * @param {boolean} args.active  live, and the stream itself is on screen (not the pre-roll)
 */
export default function useStreamWatch({ host, room, active }) {
  const hostKey = String(host || '').toLowerCase();
  const key = hostKey && room ? `${hostKey}/${room}` : null;
  const sessionRef = useRef(null);

  useEffect(() => {
    if (!active || !key) return undefined;
    const s = { sid: null, token: null, beatMs: 5000, lastBeatAt: 0, opening: false, retryAt: 0 };
    sessionRef.current = s;
    let alive = true;

    const beat = (hidden = false) => {
      if (!s.sid) return;
      s.lastBeatAt = Date.now();
      try {
        fetch(`${getPlayerUrl()}/api/watch/beat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sid: s.sid, token: s.token, ...(hidden ? { hidden: true } : {}) }),
          keepalive: true,
        }).then((r) => {
          // The player restarted (sessions are per process) or the session expired:
          // open a fresh one on the next tick.
          if (r.status === 403 || r.status === 410) s.sid = null;
        }).catch(() => {});
      } catch { /* best-effort, never disrupt the stream */ }
    };

    const open = async () => {
      s.opening = true;
      try {
        const viewer = await viewerRewardsName();
        if (!alive) return;
        if (!viewer || viewer === hostKey) { s.retryAt = Date.now() + RETRY_MS; return; }
        const viewerToken = await fetchWatchToken(hostKey, room);
        const res = await fetch(`${getPlayerUrl()}/api/watch/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: hostKey, permlink: room, type: 'live', source: '3speak',
            private: !!useAppStore.getState().privateMode,
            viewer, viewerToken: viewerToken || undefined,
          }),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!alive) return;
        if (data?.sid) {
          Object.assign(s, { sid: data.sid, token: data.token, beatMs: (data.beatSeconds || 5) * 1000, lastBeatAt: Date.now() });
        } else {
          s.retryAt = Date.now() + RETRY_MS;          // e.g. not_live: the room is in standby
        }
      } catch {
        s.retryAt = Date.now() + RETRY_MS;
      } finally {
        s.opening = false;
      }
    };

    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const tick = setInterval(() => {
      if (!visible()) return;
      if (!s.sid) {
        if (!s.opening && Date.now() >= s.retryAt) open();
        return;
      }
      if (Date.now() - s.lastBeatAt >= s.beatMs) beat();
    }, 1000);

    const onVisibility = () => { if (visible()) beat(true); else beat(); };
    const onPageHide = () => beat();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      alive = false;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      beat();
      if (sessionRef.current === s) sessionRef.current = null;
    };
  }, [active, key, hostKey, room]);
}
