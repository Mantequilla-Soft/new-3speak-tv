import { useTranslation } from 'react-i18next';
import { Banner, Button, StatusPill } from '../v2/ui';
import { cx } from '../v2/helpers';
import './OriginalContentNotice.scss';

/**
 * The upload rule, shown wherever something gets uploaded (owner 2026-11-12):
 * 3Speak is for original content, and copyrighted material must not earn
 * rewards. Two ways to comply: don't upload it, or decline the payout.
 *
 * `onDecline` adds a button that sets this upload's rewards to "Decline
 * payout"; `declined` swaps it for a "Payout declined" pill. Without
 * `onDecline` (a step before there are rewards to set) it is the note alone.
 */
export default function OriginalContentNotice({ onDecline, declined = false, className }) {
  const { t } = useTranslation();
  let action = null;
  if (onDecline) {
    action = declined
      ? <StatusPill tone="muted" caps={false} icon="check" className="original-notice__done">{t('upload.originalOnly.declined')}</StatusPill>
      : <Button variant="secondary" size={36} icon="money_off" className="original-notice__btn" onClick={onDecline}>{t('upload.originalOnly.decline')}</Button>;
  }
  return (
    <Banner tone="warn" icon="copyright" title={t('upload.originalOnly.title')} action={action} className={cx('original-notice', className)}>
      {t('upload.originalOnly.body')}
    </Banner>
  );
}
