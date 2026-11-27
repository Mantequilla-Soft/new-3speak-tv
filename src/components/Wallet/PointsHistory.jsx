import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import { formatDate, formatNumber, formatTimeAgoCompact } from '../../i18n';
import { POINTS_KIND, fetchPointsHistory, pointsPromoteRef, pointsRefLink, pointsRefUser } from './channelPoints';
import { questTitle } from './pointsEarn';
import Skeleton from './Skeleton';

const FIRST_TYPES = ['video', 'short', 'story', 'podcast', 'stream'];
const isCount = (v) => /^\d{1,7}$/.test(String(v ?? ''));

/** The label key and values of a movement whose label needs its ref. */
function kindLabel(t, i18n, it, k, ttlDays) {
  const base = `wallet.points.history.${k.key}`;
  const ref = String(it.ref ?? '');
  switch (it.kind) {
    case 'streak': return isCount(ref) ? t(base, { n: formatNumber(Number(ref)) }) : t('wallet.points.history.streakAny');
    case 'anniv': return isCount(ref) ? t(base, { n: formatNumber(Number(ref)) }) : t('wallet.points.history.annivAny');
    case 'followers': return isCount(ref) ? t(base, { n: formatNumber(Number(ref)) }) : t('wallet.points.history.followersAny');
    case 'first': return t(FIRST_TYPES.includes(ref) ? `wallet.points.history.firstOf.${ref}` : 'wallet.points.history.firstOf.any');
    case 'quest': return t(base, { title: questTitle(t, i18n, { id: ref }) });
    default: break;
  }
  return t(base, { user: pointsRefUser(it), days: ttlDays });
}

/** The link under a movement whose ref is a post, an account, a playlist or a community. */
function RefLink({ link }) {
  const { t } = useTranslation();
  if (!link) return null;
  if (link.type === 'post') return <Link to={`/watch?v=${link.author}/${link.permlink}`}>{t('wallet.points.openVideo')}</Link>;
  if (link.type === 'user') return <Link to={`/@${link.user}`}>{t('wallet.points.openProfile')}</Link>;
  if (link.type === 'playlist') return <Link to={`/playlist/${encodeURIComponent(link.id)}`}>{t('wallet.points.openPlaylist')}</Link>;
  if (link.type === 'community') return <Link to={`/community/${link.id}`}>{t('wallet.points.openCommunity')}</Link>;
  return null;
}

/**
 * The channel points movements, as the wallet's Activity list draws them (its
 * Points filter): newest first, each linked to the custom_json that logged it
 * on Hive, "Show more" paging back.
 */
export default function PointsHistory({ user, ttlDays }) {
  const { t, i18n } = useTranslation();
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
        // Points spent on promoting a video (or given back when that failed).
        const promo = pointsPromoteRef(it);
        const label = promo
          ? t(it.kind === 'refund' ? 'wallet.points.history.promoteRefund' : 'wallet.points.history.promote', { user: promo.author })
          : kindLabel(t, i18n, it, k, ttlDays);
        const link = promo ? null : pointsRefLink(it);
        return (
          <div key={it.id} className="trx__row">
            <span className={cx('trx__icon', up && 'is-in')}><Icon name={promo && it.kind !== 'refund' ? 'campaign' : k.icon} size={24} /></span>
            <div className="trx__body">
              <b>{label}</b>
              <span>
                <time dateTime={at.toISOString()} title={formatDate(at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}>
                  {formatTimeAgoCompact(at)}
                </time>
                {promo && (
                  <> · <Link to={`/watch?v=${promo.author}/${promo.permlink}`}>{t('wallet.points.openVideo')}</Link></>
                )}
                {link && <> · <RefLink link={link} /></>}
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
