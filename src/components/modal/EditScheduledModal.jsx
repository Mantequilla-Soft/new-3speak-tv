import ScheduledPostEditor from '../studio/ScheduledPostEditor';
import { useTranslation } from 'react-i18next';
import DialogShell from './DialogShell';
import './EditScheduledModal.scss';

/**
 * The scheduled-post editor shown as a popup over the watch page (so the author
 * stays on the video they came from instead of being sent to /draft).
 *
 * Props:
 *   isOpen       boolean
 *   permlink     scheduled post permlink
 *   onClose      () => void  — close without changes (overlay / ✕)
 *   onSaved      (changes) => void — after a successful save
 *   onCancelled  () => void  — after the post is cancelled
 */
export default function EditScheduledModal({ isOpen, permlink, onClose, onSaved, onCancelled }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  // The v2 dialog (design 17d / 44c edit scheduled post); the editor inside is
  // the studio's ScheduledPostEditor, fitted to the dialog body below.
  return (
    <DialogShell
      onClose={onClose}
      title={t('studio.scheduled.title')}
      width={720}
      zIndex={1100}
      overlayClassName="esm-overlay"
      className="esm-content"
      bodyClassName="esm-body"
    >
      <ScheduledPostEditor
        permlink={permlink}
        onClose={onClose}
        onSaved={onSaved}
        onCancelled={onCancelled}
        showBack={false}
      />
    </DialogShell>
  );
}
