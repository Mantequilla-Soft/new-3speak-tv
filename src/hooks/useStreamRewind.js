import { useCallback, useEffect, useState } from 'react';

// How often a showing tab asks, and how long it waits after a 404 (rewind off).
export const POLL_MS = 20 * 1000;
export const OFF_MS = 2 * 60 * 1000;

/**
 * Rewind during a live stream (H14): is the host's DVR running, and is the
 * viewer rewinding? GET /rooms/:room/dvr/rewind on the stream's hangouts server
 * says, with the playlist of the last minutes (components/openpods/StreamRewind.jsx
 * plays it). A DVR that stops ends a rewind too.
 *
 * -> { available, windowSec, playlistUrl, active, open, close }
 *
 * Asked every POLL_MS while the tab shows; a hidden tab asks again only once it
 * is back. A server or room without rewind answers 404 (it is off by default),
 * and then the next ask waits OFF_MS.
 */
export function useStreamRewind(api, room, token) {
  const [info, setInfo] = useState(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!api || !room) return undefined;
    let alive = true;
    let timer = null;
    let waitingForTab = false;
    const base = api.replace(/\/+$/, '');
    const later = (ms) => { if (alive) timer = setTimeout(check, ms); };
    function check() {
      timer = null;
      if (!alive) return;
      if (document.hidden) { waitingForTab = true; return; }
      fetch(`${base}/rooms/${encodeURIComponent(room)}/dvr/rewind`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((r) => {
          if (r.status === 404) return { off: true };
          return r.ok ? r.json() : null;
        })
        .then((d) => {
          if (!alive) return;
          setInfo(d?.available ? { playlistUrl: `${base}${d.playlist}`, windowSec: Number(d.windowSec) || 0 } : null);
          // The DVR starts when the host goes live; check again now and then.
          later(d?.off ? OFF_MS : POLL_MS);
        })
        .catch(() => { if (alive) { setInfo(null); later(POLL_MS); } });
    }
    const onVisibility = () => {
      if (document.hidden || !waitingForTab) return;
      waitingForTab = false;
      check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    check();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, room, token]);
  const open = useCallback(() => setActive(true), []);
  const close = useCallback(() => setActive(false), []);
  return { available: !!info, windowSec: info?.windowSec || 0, playlistUrl: info?.playlistUrl || null, active: active && !!info, open, close };
}

