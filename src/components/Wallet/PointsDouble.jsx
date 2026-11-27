import { useTranslation } from 'react-i18next';
import { Banner, Icon } from '../v2/ui';
import { formatDate } from '../../i18n';
import { usePointsDouble } from './channelPoints';
import './PointsCard.scss';

// When the double points window ends, in the reader's time: "Sun, 23:59".
const endsAt = (d) => formatDate(d, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Double points (hangouts GET /points/events): while every earning pays twice,
 * a banner in the wallet with the end time. Nothing otherwise, also when the
 * live server has no such route.
 */
export default function PointsDoubleBanner() {
  const { t } = useTranslation();
  const double = usePointsDouble();
  if (!double) return null;
  return (
    <Banner tone="info" icon="bolt" title={t('wallet.points.double.title')} className="points-double">
      {double.until
        ? t('wallet.points.double.until', { time: endsAt(double.until) })
        : t('wallet.points.double.now')}
    </Banner>
  );
}

/** The same as one short line, for pages where people earn (the Live page). */
export function PointsDoubleHint({ className = '' }) {
  const { t } = useTranslation();
  const double = usePointsDouble();
  if (!double) return null;
  return (
    <span className={`points-double-hint ${className}`.trim()} role="status">
      <Icon name="bolt" size={16} fill />
      {double.until
        ? t('wallet.points.double.hintUntil', { time: endsAt(double.until) })
        : t('wallet.points.double.title')}
    </span>
  );
}
