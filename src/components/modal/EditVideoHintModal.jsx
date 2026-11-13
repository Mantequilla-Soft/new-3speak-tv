import { useTranslation, Trans } from 'react-i18next';
import DialogShell from './DialogShell';
import { Icon } from '../v2/Icon';
import './EditVideoHintModal.scss';

/**
 * Educational popup shown when a user clicks "Edit Video" on their profile
 * (design 19g / 43b, the edit-video hint): a cyan hint card with the pen in a
 * cyan icon well, the title, one sentence and "Got it".
 *
 * It teaches that any of their own videos can be edited from the video page via
 * the pen button.
 *
 * Props:
 *   isOpen     boolean
 *   onClose    () => void
 */
export default function EditVideoHintModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <DialogShell
      onClose={onClose}
      title={t('modals.editVideoHint.title')}
      width={420}
      zIndex={1100}
      overlayClassName="evh-overlay"
      className="evh-content"
    >
      <div className="evh-card">
        <span className="evh-icon" aria-hidden="true" title={t('modals.editVideoHint.penTitle')}>
          <Icon name="edit" size={24} />
        </span>
        <div className="evh-body">
          <b className="evh-title" aria-hidden="true">{t('modals.editVideoHint.title')}</b>
          <p className="evh-text">
            <Trans i18nKey="modals.editVideoHint.text" components={{ strong: <strong /> }} />
          </p>
          <button type="button" className="evh-got" onClick={onClose}>{t('modals.editVideoHint.gotIt')}</button>
        </div>
      </div>
    </DialogShell>
  );
}
