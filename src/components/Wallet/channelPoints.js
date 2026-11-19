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
};

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
