import { useTranslation, Trans } from 'react-i18next';
import DialogShell from './DialogShell';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
import './EditVideoHintModal.scss';

/**
 * Educational popup shown when a user clicks "Edit Video" on their profile
 * (design 19g / 43b, the edit-video hint).
 *
 * It teaches that any of their own videos can be edited from the video page via
 * the pen button. We render a non-interactive mock of the watch-page action
 * dock (Share · Hype · Edit · Report · Save · Tip) with the pen ringed in cyan.
 *
 * Props:
 *   isOpen     boolean
 *   onClose    () => void
 */
const MOCK = ['share', 'campaign', 'edit', 'flag', 'playlist_add'];

export default function EditVideoHintModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <DialogShell
      onClose={onClose}
      title={t('modals.editVideoHint.title')}
      width={460}
      zIndex={1100}
      overlayClassName="evh-overlay"
      className="evh-content"
      footer={<Button variant="primary" onClick={onClose}>{t('modals.editVideoHint.gotIt')}</Button>}
    >
      <p className="evh-text">
        <Trans i18nKey="modals.editVideoHint.text" components={{ strong: <strong /> }} />
      </p>

      {/* Mock of the real watch-page action dock. Decorative: only the pen is highlighted. */}
      <div className="evh-mock" aria-hidden="true">
        {MOCK.map((name) => (
          <span key={name} className={`evh-btn${name === 'edit' ? ' evh-btn--pen' : ''}`} title={name === 'edit' ? t('modals.editVideoHint.penTitle') : undefined}>
            <Icon name={name} size={20} />
          </span>
        ))}
        <span className="evh-btn evh-btn--tip"><Icon name="paid" size={20} /><span>{t('modals.editVideoHint.tip')}</span></span>
      </div>

      <p className="evh-caption">
        <span className="evh-caption-dot" /> {t('modals.editVideoHint.caption')}
      </p>
    </DialogShell>
  );
}
