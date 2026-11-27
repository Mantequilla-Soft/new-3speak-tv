import { formatNumber } from '../../i18n';

/**
 * The points card's "What you can do with your points": every way to spend
 * them, with what it costs. A row the balance covers gets a button to go and do
 * it; one it does not says how many points are still missing. A way to spend
 * shows only when the live server names its price, so an older server lists
 * only what it sells:
 *   promote  a video at the top of Discover (GET /points/promote/quote, a day)
 *   boost    a points boost in a live stream (points info `boostMin` and up)
 *   predict  a stake on a prediction in a live stream (any amount from 1)
 */
export function buildSpendRows(t, { balance = 0, boostMin, promote } = {}) {
  const n = (v) => formatNumber(v);
  const rows = [];
  const add = (key, cost, rate, to, action) => {
    const missing = Math.max(0, cost - balance);
    rows.push({ key, label: t(`wallet.points.spend.${key}`), rate, to, action, cost, missing,
      missingText: missing > 0 ? t('wallet.points.spend.needMore', { n: n(missing) }) : null });
  };
  if (promote?.per24h > 0) {
    add('promote', promote.per24h, t('wallet.points.rate.perDay', { n: n(promote.per24h) }), '/profile', t('wallet.points.spend.pickVideo'));
  }
  if (boostMin > 0) add('boost', boostMin, t('wallet.points.spend.from', { n: n(boostMin) }), '/live', t('wallet.points.spend.findLive'));
  add('predict', 1, t('wallet.points.spend.anyAmount'), '/live', t('wallet.points.spend.findLive'));
  return rows;
}
