import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { BsLightningChargeFill } from 'react-icons/bs';
import { formatDuration } from '../../utils/rcCheck';
import { useTranslation, Trans } from 'react-i18next';
import './RcInsufficientModal.scss';

/**
 * Shown before an upload when the user doesn't have enough Resource Credits (RC)
 * to publish a post on Hive. Explains what RC is and — when waiting will help —
 * a live estimate of when their RC will have regenerated enough.
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

  return createPortal(
    <div className="rc-modal-overlay" onClick={onClose}>
      <div className="rc-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="rc-close-btn" onClick={onClose} aria-label={t('common.actions.close')}>
          <IoClose size={22} />
        </button>

        <div className="rc-modal-icon">
          <BsLightningChargeFill />
        </div>

        <h3 className="rc-modal-title">{t('upload.rc.title')}</h3>

        <p className="rc-modal-text">
          <Trans i18nKey="upload.rc.explanation" components={{ b: <strong /> }} />
        </p>

        <div className="rc-meter" aria-label={t('upload.rc.meterAria', { percent: pct.toFixed(0) })}>
          <div className="rc-meter-bar">
            <div className="rc-meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="rc-meter-label">{t('upload.rc.available', { percent: pct.toFixed(0) })}</span>
        </div>

        {canEverAfford ? (
          <div className="rc-eta">
            <span className="rc-eta-label">{t('upload.rc.estimatedReadyIn')}</span>
            <span className="rc-eta-value">{formatDuration(remaining)}</span>
            <span className="rc-eta-hint">
              {t('upload.rc.refillsHint')}
            </span>
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

        <div className="rc-modal-actions">
          {canEverAfford && (
            <button
              type="button"
              className="rc-btn rc-btn--primary"
              onClick={onRecheck}
              disabled={rechecking}
            >
              {rechecking ? t('upload.rc.checking') : t('upload.rc.recheck')}
            </button>
          )}
          <button type="button" className="rc-btn rc-btn--ghost" onClick={onClose}>
            {t('common.actions.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
