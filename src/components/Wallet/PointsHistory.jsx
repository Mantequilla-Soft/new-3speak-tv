import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import { formatDate, formatNumber, formatTimeAgoCompact } from '../../i18n';
import { POINTS_KIND, fetchPointsHistory } from './channelPoints';
import Skeleton from './Skeleton';

/**
 * The channel points movements, as the wallet's Activity list draws them (its
 * Points filter): newest first, each linked to the custom_json that logged it
 * on Hive, "Show more" paging back.
 */
export default function PointsHistory({ user, ttlDays }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let gone = false;
    setItems(null);
    setNext(null);
    setFailed(false);
    fetchPointsHistory(user).then((h) => {
      if (gone) return;
      setItems(h.items || []);
      setNext(h.next ?? null);
    }).catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; };
  }, [user]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const h = await fetchPointsHistory(user, next);
      setItems((cur) => [...(cur || []), ...(h.items || [])]);
      setNext(h.next ?? null);
    } catch { /* keep what is shown */ } finally {
      setLoadingMore(false);
    }
  };

  if (failed) return <div className="v2-failure" role="alert"><b>{t('wallet.history.loadFailed')}</b></div>;
  if (!items) return <Skeleton />;
  if (!items.length) return <EmptyState icon="receipt_long" title={t('wallet.activity.emptyTitle')}>{t('wallet.points.empty')}</EmptyState>;

  return (
    <>
      {items.map((it) => {
        const k = POINTS_KIND[it.kind] || POINTS_KIND.watch;
        const up = it.delta > 0;
        const at = new Date(it.at);
        return (
          <div key={it.id} className="trx__row">
            <span className={cx('trx__icon', up && 'is-in')}><Icon name={k.icon} size={24} /></span>
            <div className="trx__body">
              <b>{t(`wallet.points.history.${k.key}`, { user: it.ref || '', days: ttlDays })}</b>
              <span>
                <time dateTime={at.toISOString()} title={formatDate(at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}>
                  {formatTimeAgoCompact(at)}
                </time>
                {it.tx && (
                  <> · <a href={`https://hivehub.dev/tx/${it.tx}`} target="_blank" rel="noopener noreferrer">{t('wallet.points.onHive')}</a></>
                )}
              </span>
            </div>
            <span className={cx('trx__amt', up && 'is-in')}>{up ? '+' : '−'}{formatNumber(Math.abs(it.delta))}</span>
          </div>
        );
      })}
      {next && (
        <Button variant="ghost" size={36} loading={loadingMore} disabled={loadingMore} onClick={more} className="trx__more">
          {t('wallet.points.more')}
        </Button>
      )}
    </>
  );
}
