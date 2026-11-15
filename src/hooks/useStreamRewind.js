import { useCallback, useEffect, useState } from 'react';

/**
 * Rewind during a live stream (H14): is the host's DVR running, and is the
 * viewer rewinding? GET /rooms/:room/dvr/rewind on the stream's hangouts server
 * says, with the playlist of the last minutes (components/openpods/StreamRewind.jsx
 * plays it). A DVR that stops ends a rewind too.
 *
 * -> { available, windowSec, playlistUrl, active, open, close }
 */
export function useStreamRewind(api, room, token) {
  const [info, setInfo] = useState(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!api || !room) return undefined;
    let alive = true;
    const base = api.replace(/\/+$/, '');
    const check = () => {
      fetch(`${base}/rooms/${encodeURIComponent(room)}/dvr/rewind`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setInfo(d?.available ? { playlistUrl: `${base}${d.playlist}`, windowSec: Number(d.windowSec) || 0 } : null); })
        .catch(() => { if (alive) setInfo(null); });
    };
    check();
    // The DVR starts when the host goes live; check again now and then.
    const timer = setInterval(check, 20000);
    return () => { alive = false; clearInterval(timer); };
  }, [api, room, token]);
  const open = useCallback(() => setActive(true), []);
  const close = useCallback(() => setActive(false), []);
  return { available: !!info, windowSec: info?.windowSec || 0, playlistUrl: info?.playlistUrl || null, active: active && !!info, open, close };
}

