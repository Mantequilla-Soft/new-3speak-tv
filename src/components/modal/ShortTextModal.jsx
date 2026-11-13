import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DialogShell from './DialogShell';
import { Button } from '../v2/ui';
import MarkdownComposer from '../studio/MarkdownComposer';
import './ShortTextModal.scss';

/**
 * The text of a Short made from an audiogram, written in our own post editor
 * (toolbar, emoji, GIFs, images, preview) over the audio editor (design 19g).
 * The editor asks for it (edit-text, see EditorModal) and gets the text back on
 * Done; Cancel, X and Esc leave it as it was. A Short is a reply like a snap, so
 * the preview renders like one. The overlay keeps its class: EditorModal lets
 * keys inside .short-text-modal-overlay through to the composer.
 */
export default function ShortTextModal({ value, maxLength = 5000, onDone, onCancel }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value || '');
  return (
    <DialogShell
      onClose={onCancel}
      tone="accent"
      title={t('modals.editor.shortText.title')}
      headExtra={<span className="short-text-count num" aria-hidden="true">{text.length}/{maxLength}</span>}
      sub={t('modals.editor.shortText.hint')}
      width={720}
      // Over the audio editor (EditorModal sits at 100050).
      zIndex={100060}
      overlayClassName="short-text-modal-overlay"
      className="short-text-modal"
      footer={(
        <>
          <Button variant="secondary" size={44} trailing="close" className="short-text-btn" onClick={onCancel}>{t('common.actions.cancel')}</Button>
          <Button variant="primary" size={44} trailing="check" className="short-text-btn" onClick={() => onDone(text)}>{t('common.actions.done')}</Button>
        </>
      )}
    >
      <div className="short-text-modal-composer">
        <MarkdownComposer
          value={text}
          onChange={(v) => setText(String(v ?? '').slice(0, maxLength))}
          placeholder={t('modals.editor.shortText.placeholder')}
          previewContext="snap"
        />
      </div>
    </DialogShell>
  );
}
