import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import AccountImg from '../HiveAvatar/AccountImg';
import { useBoostWall } from '../../lib/boosts';
import { formatSupportTotal, formatHbd, formatSats } from '../../lib/supports';
import { formatTimeAgo, formatNumber } from '../../i18n';
import './BoostWall.scss';

// One boost's amount as it was sent: "2.000 HBD", "5 HIVE", "1,000 sats".
function amountOf(b) {
  if (b.currency === 'SATS') return formatSats(b.amount);
  if (b.currency === 'HBD') return formatHbd(b.amount);
  return `${formatNumber(b.amount, { maximumFractionDigits: 3 })} HIVE`;
}

/**
 * A post's boost wall (GET /boosts/:author/:permlink on the checker): who sent
 * what, with their message, newest first, and the Boost button (`onBoost`, left
 * out for the creator's own post). Shown in the watch page's credits card and
 * under an audio post.
 */
export default function BoostWall({ author, permlink, onBoost, className }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useBoostWall(author, permlink);
  const items = data?.items || [];
  const total = data?.count ? formatSupportTotal(data.total_hbd, data.total_sats) : null;

  return (
    <div className={cx('boost-wall', className)}>
      {total && <p className="boost-wall__total money">{t('boosts.wall.total', { amount: total })}</p>}
      {isLoading ? (
        <div className="wv2-rows is-loading" aria-busy="true"><span className="v2-skeleton is-line" /><span className="v2-skeleton is-line" /></div>
      ) : isError ? (
        <p className="boost-wall__empty">{t('boosts.wall.failed')}</p>
      ) : items.length === 0 ? (
        <p className="boost-wall__empty">{t('boosts.wall.empty')}</p>
      ) : (
        <ol className="boost-wall__list">
          {items.map((b, i) => (
            <li key={`${b.tippedAt}-${i}`} className={cx('boost-wall__item', b.boost && 'is-boost')}>
              {b.tipper
                ? <Link to={`/@${b.tipper}`} className="boost-wall__avatar" aria-hidden tabIndex={-1}><AccountImg account={b.tipper} alt="" loading="lazy" /></Link>
                : <span className="boost-wall__avatar is-bolt" aria-hidden><Icon name="bolt" size={18} /></span>}
              <div className="boost-wall__body">
                <div className="boost-wall__head">
                  {b.tipper
                    ? <Link to={`/@${b.tipper}`} className="boost-wall__name">@{b.tipper}</Link>
                    : <span className="boost-wall__name">{t('boosts.wall.lightning')}</span>}
                  <span className="money boost-wall__amount">{amountOf(b)}</span>
                </div>
                {b.message && <p className="boost-wall__msg">{b.message}</p>}
                <span className="boost-wall__meta">
                  {b.boost && <><Icon name="rocket_launch" size={14} /> {t('boosts.wall.boost')} · </>}
                  {b.stream && <>{t('boosts.wall.streamed')} · </>}
                  {formatTimeAgo(b.tippedAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="boost-wall__note">{t('boosts.wall.note')}</p>
      {onBoost && (
        <Button variant="danger" size={44} block icon="rocket_launch" className="boost-wall__btn" title={t('boosts.buttonTitle')} onClick={onBoost}>
          {t('boosts.button')}
        </Button>
      )}
    </div>
  );
}
