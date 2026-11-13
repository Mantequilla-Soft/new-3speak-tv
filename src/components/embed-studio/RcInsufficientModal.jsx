import { useEffect, useState } from 'react';
import { formatDuration } from '../../utils/rcCheck';
import { useTranslation, Trans } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import { Button, Icon, Progress } from '../v2/ui';
import './RcInsufficientModal.scss';

/**
 * Shown before an upload when the user doesn't have enough Resource Credits (RC)
 * to publish a post on Hive. Explains what RC is and — when waiting will help —
 * a live estimate of when their RC will have regenerated enough.
 *
 * Built on the v2 dialog (DialogShell): a bottom sheet on phones, Escape closes
 * only this window when it sits over another (the audio upload).
 *
 * Props:
 *   isOpen       boolean
 *   onClose      () => void
 *   status       result of checkPostingRc(): { percentage, secondsUntilEnough, canEverAfford, ... }
 *   onRecheck    () => void   re-run the RC check (RC regenerates over time)
 *   rechecking   boolean
 */
export default function RcInsufficientModal({ isOpen, onClose, status, onRecheck, rechecking }) {
  const { t } = useTranslation();
  // Live countdown so the "ready in ~X" estimate ticks down while the modal is open.
  const [remaining, setRemaining] = useState(status?.secondsUntilEnough ?? 0);

  useEffect(() => {
    setRemaining(status?.secondsUntilEnough ?? 0);
  }, [status?.secondsUntilEnough]);

  useEffect(() => {
    if (!isOpen || !Number.isFinite(remaining) || remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => (Number.isFinite(r) && r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [isOpen, remaining]);

  if (!isOpen || !status) return null;

  const pct = Math.max(0, Math.min(100, status.percentage ?? 0));
  const canEverAfford = status.canEverAfford !== false;

  return (
    <DialogShell
      open
      onClose={onClose}
      title={t('upload.rc.title')}
      width={460}
      zIndex={1100}
      className="rc-modal-content"
      bodyClassName="rc-modal-body"
      footer={(
        <>
          <Button variant="secondary" size={44} onClick={onClose}>{t('common.actions.close')}</Button>
          {canEverAfford && (
            <Button variant="primary" size={44} onClick={onRecheck} disabled={rechecking} loading={rechecking} trailing="refresh" className="is-next">
              {rechecking ? t('upload.rc.checking') : t('upload.rc.recheck')}
            </Button>
          )}
        </>
      )}
    >
      <div className="rc-modal-lead">
        <span className="rc-modal-icon"><Icon name="bolt" size={24} fill /></span>
        <p className="rc-modal-text">
          <Trans i18nKey="upload.rc.explanation" components={{ b: <strong /> }} />
        </p>
      </div>

      <div className="rc-meter">
        <span className="rc-meter-label num">{t('upload.rc.available', { percent: pct.toFixed(0) })}</span>
        <Progress value={pct} tone="cyan" label={t('upload.rc.meterAria', { percent: pct.toFixed(0) })} />
      </div>

      {canEverAfford ? (
        <div className="rc-eta">
          <span className="rc-eta-label">{t('upload.rc.estimatedReadyIn')}</span>
          <span className="rc-eta-value">{formatDuration(remaining)}</span>
          <span className="rc-eta-hint">{t('upload.rc.refillsHint')}</span>
        </div>
      ) : (
        <div className="rc-eta rc-eta--blocked">
          <span className="rc-eta-hint">
            <Trans
              i18nKey="upload.rc.blockedHint"
              components={{ discordLink: <a href="https://discord.com/invite/NSFS2VGj83" target="_blank" rel="noopener noreferrer" /> }}
            />
          </span>
        </div>
      )}
    </DialogShell>
  );
}
