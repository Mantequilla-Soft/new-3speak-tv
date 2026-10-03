import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { MdShare, MdEdit, MdFlag, MdPlaylistAdd } from 'react-icons/md';
import { Repeat2 } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import './EditVideoHintModal.scss';

/**
 * Educational popup shown when a user clicks "Edit Video" on their profile.
 *
 * It teaches that any of their own videos can be edited from the video page via
 * the pen button. We render a faithful (non-interactive) mock of the watch-page
 * action row — Share · Reshare · Edit · Report · Playlist · Tip — and draw the
 * eye to the pen with a scale + shimmer animation.
 *
 * Props:
 *   isOpen     boolean
 *   onClose    () => void
 */
export default function EditVideoHintModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return createPortal(
    <div className="evh-overlay" onClick={onClose}>
      <div className="evh-content" onClick={(e) => e.stopPropagation()}>
        <button className="evh-close" onClick={onClose} aria-label={t('common.actions.close')}>
          <IoClose size={22} />
        </button>

        <h3 className="evh-title">{t('modals.editVideoHint.title')}</h3>
        <p className="evh-text">
          <Trans i18nKey="modals.editVideoHint.text" components={{ strong: <strong /> }} />
        </p>

        {/* Mock of the real watch-page action row (.info-buttons-right). These
            buttons are decorative — only the pen is highlighted. */}
        <div className="evh-mock" aria-hidden="true">
          <span className="evh-btn"><MdShare size={16} /></span>
          <span className="evh-btn"><Repeat2 size={16} /></span>

          <span className="evh-btn evh-btn--pen" title={t('modals.editVideoHint.penTitle')}>
            <MdEdit size={17} />
            <span className="evh-shimmer" />
          </span>

          <span className="evh-btn"><MdFlag size={16} /></span>
          <span className="evh-btn"><MdPlaylistAdd size={18} /></span>
          <span className="evh-btn evh-btn--tip">{t('modals.editVideoHint.tip')}</span>
        </div>

        <p className="evh-caption">
          <span className="evh-caption-dot" /> {t('modals.editVideoHint.caption')}
        </p>

        <div className="evh-actions">
          <button type="button" className="evh-cta evh-cta--primary" onClick={onClose}>
            {t('modals.editVideoHint.gotIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
