import { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { getHiveUrl } from './hiveNode';

// Median HIVE price (HBD per 1 HIVE) from the chain's price feed, fetched once
// per session and shared by every caller. One in-flight request at a time.
let cachedHivePrice = null;
let inflight = null;

export async function fetchHivePrice() {
  if (cachedHivePrice != null) return cachedHivePrice;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(getHiveUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_current_median_history_price', params: [], id: 1 }),
      });
      const j = await res.json();
      const base = parseFloat(j?.result?.base);    // e.g. "0.240 HBD"
      const quote = parseFloat(j?.result?.quote);  // e.g. "1.000 HIVE"
      if (base > 0 && quote > 0) cachedHivePrice = base / quote;
    } catch { /* ignore: callers keep showing the placeholder */ }
    inflight = null;
    return cachedHivePrice;
  })();
  return inflight;
}

export function useHivePrice(enabled = true) {
  const [price, setPrice] = useState(cachedHivePrice);
  useEffect(() => {
    if (!enabled || price != null) return undefined;
    let alive = true;
    fetchHivePrice().then((p) => { if (alive && p != null) setPrice(p); });
    return () => { alive = false; };
  }, [enabled, price]);
  return price;
}

function compact(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(2);
}

/**
 * Post rewards are stored as their HBD (dollar) value. Guests and warm-up
 * accounts (no Hive account, so `user` is null) see the HIVE amount instead;
 * only a signed-in Hive account sees the dollar figure.
 *
 * Returns { inHive, unit, ready, toUnit(hbd), format(hbd) }: `format` gives the
 * number without the unit (`unit` is '$' or 'HIVE'), '…' while the price loads.
 */
export function useRewardDisplay() {
  const user = useAppStore((s) => s.user);
  const inHive = !user;
  const price = useHivePrice(inHive);
  const ready = !inHive || price != null;

  const toUnit = (hbd) => {
    const n = Number(hbd);
    if (!Number.isFinite(n)) return null;
    if (!inHive) return n;
    return price ? n / price : null;
  };

  const format = (hbd) => {
    const v = toUnit(hbd);
    return v == null ? '…' : compact(v);
  };

  // Display label: "$1.23" for a Hive account, otherwise the bare HIVE amount
  // "4.56" (no unit after it).
  const label = (hbd) => {
    const n = format(hbd);
    if (n === '…') return n;
    return inHive ? n : `$${n}`;
  };

  return { inHive, unit: inHive ? 'HIVE' : '$', ready, toUnit, format, label };
}
