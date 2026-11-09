import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ModalHeader from '../ModalHeader/ModalHeader';
import MarkdownComposer from '../studio/MarkdownComposer';

/**
 * The text of a Short made from an audiogram, written in our own post editor
 * (toolbar, emoji, GIFs, images, preview) over the audio editor. The editor
 * asks for it (edit-text, see EditorModal) and gets the text back on Done;
 * Cancel, X and Esc leave it as it was. A Short is a reply like a snap, so the
 * preview renders like one.
 */
export default function ShortTextModal({ value, maxLength = 5000, onDone, onCancel }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value || '');
  return (
    <div className="short-text-modal-overlay" onClick={onCancel}>
      <div className="short-text-modal" role="dialog" aria-modal="true" aria-labelledby="short-text-title" onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={t('modals.editor.shortText.title')} titleId="short-text-title" onClose={onCancel} />
        <p className="short-text-modal-hint">{t('modals.editor.shortText.hint')}</p>
        <div className="short-text-modal-composer">
          <MarkdownComposer
            value={text}
            onChange={(v) => setText(String(v ?? '').slice(0, maxLength))}
            placeholder={t('modals.editor.shortText.placeholder')}
            previewContext="snap"
          />
        </div>
        <div className="short-text-modal-actions">
          <button type="button" className="short-text-modal-btn" onClick={onCancel}>{t('common.actions.cancel')}</button>
          <button type="button" className="short-text-modal-btn primary" onClick={() => onDone(text)}>{t('common.actions.done')}</button>
        </div>
      </div>
    </div>
  );
}
