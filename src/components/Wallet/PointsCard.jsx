import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import { formatDate, formatNumber } from '../../i18n';
import './PointsCard.scss';

/**
 * The wallet's channel points card: the balance (one across all 3Speak
 * streams), until when it is kept and how points are earned. The movements are
 * in the Activity list (its Points filter, PointsHistory); the button here
 * opens it. `info` comes from usePointsInfo; nothing shows without it.
 */
export default function PointsCard({ info, own, onShowHistory }) {
  const { t } = useTranslation();
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

      {onShowHistory && (
        <Button variant="ghost" size={36} icon="history" onClick={onShowHistory} className="points-card__more">
          {t('wallet.points.historyTitle')}
        </Button>
      )}
    </div>
  );
}
