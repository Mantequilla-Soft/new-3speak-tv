import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import { defaultEndpoint } from '../../utils/hangoutsEndpoints';
import { formatDate, formatNumber, formatTimeAgo } from '../../i18n';
import './PointsCard.scss';

const PAGE = 8;

// Ledger kinds (hangouts lib/pointsLedger.ts) to their icon and label key.
const KIND = {
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

/**
 * The wallet's channel points: the balance (one across all 3Speak streams),
 * until when it is kept, how points are earned, and the movements, each one
 * linked to the custom_json that logged it on Hive. Read from the live
 * server's public routes; hidden when that server does not have them.
 */
export default function PointsCard({ user, own }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const api = defaultEndpoint().api;

  const loadHistory = useCallback(async (before) => {
    const q = new URLSearchParams({ limit: String(PAGE), ...(before ? { before: String(before) } : {}) });
    const r = await fetch(`${api}/users/${encodeURIComponent(user)}/points/history?${q}`);
    if (!r.ok) throw new Error(`history ${r.status}`);
    return r.json();
  }, [api, user]);

  useEffect(() => {
    if (!api || !user) return undefined;
    let gone = false;
    setInfo(null);
    setItems([]);
    setNext(null);
    (async () => {
      try {
        const r = await fetch(`${api}/users/${encodeURIComponent(user)}/points`);
        if (!r.ok) return;
        const body = await r.json();
        if (gone || typeof body?.balance !== 'number') return;
        setInfo(body);
        const h = await loadHistory();
        if (gone) return;
        setItems(h.items || []);
        setNext(h.next ?? null);
      } catch { /* no points on this server: the card stays hidden */ }
    })();
    return () => { gone = true; };
  }, [api, user, loadHistory]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const h = await loadHistory(next);
      setItems((cur) => [...cur, ...(h.items || [])]);
      setNext(h.next ?? null);
    } catch { /* keep what is shown */ } finally {
      setLoadingMore(false);
    }
  };

  if (!info) return null;
  const e = info.earn || {};
  const rates = [
    { label: t('wallet.points.earn.watch'), rate: t('wallet.points.rate.perMinute', { n: formatNumber(e.watchPerMin) }) },
    { label: t('wallet.points.earn.chat'), rate: t('wallet.points.rate.perWord', { n: formatNumber(e.chatPerWord) }) },
    { label: t('wallet.points.earn.stream'), rate: t('wallet.points.rate.perMinute', { n: formatNumber(e.streamPerMin) }) },
    { label: t('wallet.points.earn.raid'), rate: formatNumber(e.raid) },
    { label: t('wallet.points.earn.boost'), rate: t('wallet.points.rate.upTo', { n: formatNumber(e.boostMax) }) },
  ];

  return (
    <div className="wallet-v2__card points-card">
      <div className="wallet-v2__card-head">
        <b>{t('wallet.points.title')}</b>
        <span className="points-card__balance num">{formatNumber(info.balance)}</span>
      </div>
      <div className="wallet-v2__card-sub">
        {t('wallet.points.sub')}
        {own && (
          <> {info.expiresAt
            ? t('wallet.points.keptUntil', { date: formatDate(info.expiresAt) })
            : t('wallet.points.startsAt', { count: info.start, n: formatNumber(info.start) })}</>
        )}
      </div>

      <details className="points-card__earn">
        <summary>{t('wallet.points.earnTitle')}</summary>
        <dl>
          {rates.map((r) => (
            <div key={r.label}><dt>{r.label}</dt><dd className="num">{r.rate}</dd></div>
          ))}
        </dl>
      </details>

      <div className="points-card__history" aria-label={t('wallet.points.historyTitle')}>
        {items.length === 0 ? (
          <p className="points-card__empty">{t('wallet.points.empty')}</p>
        ) : items.map((it) => {
          const k = KIND[it.kind] || KIND.watch;
          const up = it.delta > 0;
          return (
            <div key={it.id} className="points-card__row">
              <span className={cx('points-card__icon', up && 'is-in')}><Icon name={k.icon} size={18} /></span>
              <div className="points-card__body">
                <b>{t(`wallet.points.history.${k.key}`, { user: it.ref || '', days: info.ttlDays })}</b>
                <span>
                  {formatTimeAgo(it.at)}
                  {it.tx && (
                    <> · <a href={`https://hivehub.dev/tx/${it.tx}`} target="_blank" rel="noopener noreferrer">{t('wallet.points.onHive')}</a></>
                  )}
                </span>
              </div>
              <span className={cx('points-card__amt num', up && 'is-in')}>{up ? '+' : '−'}{formatNumber(Math.abs(it.delta))}</span>
            </div>
          );
        })}
      </div>
      {next && (
        <Button variant="ghost" size={36} loading={loadingMore} disabled={loadingMore} onClick={more} className="points-card__more">
          {t('wallet.points.more')}
        </Button>
      )}
    </div>
  );
}
