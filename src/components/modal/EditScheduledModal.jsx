import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import ScheduledPostEditor from '../studio/ScheduledPostEditor';
import { useTranslation } from 'react-i18next';
import './EditScheduledModal.scss';

/**
 * The scheduled-post editor shown as a popup over the watch page (so the author
 * stays on the video they came from instead of being sent to /draft).
 *
 * Props:
 *   isOpen       boolean
 *   permlink     scheduled post permlink
 *   onClose      () => void  — close without changes (Back / overlay / ✕)
 *   onSaved      (changes) => void — after a successful save
 *   onCancelled  () => void  — after the post is cancelled
 */
export default function EditScheduledModal({ isOpen, permlink, onClose, onSaved, onCancelled }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return createPortal(
    <div className="esm-overlay" onClick={onClose}>
      <div className="esm-content" onClick={(e) => e.stopPropagation()}>
        <button className="esm-close" onClick={onClose} aria-label={t('common.actions.close')}>
          <IoClose size={22} />
        </button>
        <ScheduledPostEditor
          permlink={permlink}
          onClose={onClose}
          onSaved={onSaved}
          onCancelled={onCancelled}
        />
      </div>
    </div>,
    document.body,
  );
}
