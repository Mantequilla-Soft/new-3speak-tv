import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../v2/ui';
import { formatDate, formatNumber } from '../../i18n';
import { usePointsAwardsConfig, usePointsPromoteQuote } from './channelPoints';
import { buildEarnGroups } from './pointsEarn';
import { buildSpendRows } from './pointsSpend';
import './PointsCard.scss';

/**
 * The wallet's channel points card: the balance (one across all 3Speak
 * streams), until when it is kept and how points are earned. The movements are
 * in the Activity list (its Points filter, PointsHistory); the button here
 * opens it. `info` comes from usePointsInfo; nothing shows without it. With
 * 3Speak Points on Magi, `info.token` says how many are on chain already. The
 * "How to earn" list (collapsed) is grouped and reads the award amounts from
 * the live server (usePointsAwardsConfig, pointsEarn.js). On your own wallet,
 * "What you can do with your points" lists the ways to spend them with a button
 * for each one the balance covers (pointsSpend.js).
 */
export default function PointsCard({ info, own, onShowHistory }) {
  const { t } = useTranslation();
  const awardsConfig = usePointsAwardsConfig(!!info);
  const promoteQuote = usePointsPromoteQuote(!!info && !!own);
  if (!info) return null;
  const spend = own ? buildSpendRows(t, { balance: info.balance, boostMin: info.boostMin, promote: promoteQuote }) : [];
  // The ways to earn, grouped, with what the live server pays for each.
  const groups = buildEarnGroups(t, info.earn, awardsConfig);
  // 3Speak Points (3SP) on Magi: what is there now, and earnings on the way.
  const token = info.token && typeof info.token.onChain === 'number' ? info.token : null;

  return (
    <div className="wallet-v2__card points-card">
      <div className="wallet-v2__card-head">
        <b>{t('wallet.points.title')}</b>
        <span className="points-card__balance num">{formatNumber(info.balance)}</span>
      </div>
      <div className="wallet-v2__card-sub">
        {t('wallet.points.subAll')}
        {own && (
          <> {info.expiresAt
            ? t('wallet.points.keptUntil', { date: formatDate(info.expiresAt) })
            : t('wallet.points.startsAt', { count: info.start, n: formatNumber(info.start) })}</>
        )}
      </div>

      {token && (
        <div className="points-card__token">
          {t('wallet.points.token.onChain', { n: formatNumber(token.onChain) })}
          {token.unminted > 0 && <> {t('wallet.points.token.onTheWay', { n: formatNumber(token.unminted) })}</>}
        </div>
      )}

      {spend.length > 0 && (
        <section className="points-card__spend" aria-label={t('wallet.points.spend.title')}>
          <h4>{t('wallet.points.spend.title')}</h4>
          <ul>
            {spend.map((r) => (
              <li key={r.key} className={r.missing > 0 ? 'is-locked' : undefined}>
                <span className="points-card__spend-text">
                  <span>{r.label}</span>
                  <span className="num">{r.rate}</span>
                </span>
                {r.missing > 0
                  ? <span className="points-card__spend-missing num">{r.missingText}</span>
                  : <Button as={Link} to={r.to} variant="secondary" size={36}>{r.action}</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="points-card__earn">
        <summary>{t('wallet.points.earnTitle')}</summary>
        {groups.map((g) => (
          <section key={g.id} className="points-card__group" aria-label={g.title}>
            <h4>{g.title}</h4>
            <dl>
              {g.rows.map((r) => (
                <div key={r.key}><dt>{r.label}</dt><dd className="num">{r.rate}</dd></div>
              ))}
            </dl>
            {g.note && <p className="points-card__note">{g.note}</p>}
          </section>
        ))}
      </details>

      {onShowHistory && (
        <Button variant="ghost" size={36} icon="history" onClick={onShowHistory} className="points-card__more">
          {t('wallet.points.historyTitle')}
        </Button>
      )}
    </div>
  );
}
