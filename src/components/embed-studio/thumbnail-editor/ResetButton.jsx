import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../v2/ui';

/** Reset, asked in place ("Reset all edits? Reset / Cancel") rather than in a second popup. */
// `compact`: a 40 icon tile (the editor head, 23c), the label for screen readers.
export default function ResetButton({ onReset, disabled, compact = false }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    if (compact) {
      return (
        <IconButton icon="undo" size={40} variant="secondary" className="thumb-modal__headbtn" label={t('upload.thumbnail.reset')} onClick={() => setConfirming(true)} disabled={disabled} />
      );
    }
    return (
      <Button variant="ghost" size={40} icon="restart_alt" className="thumb-btn" onClick={() => setConfirming(true)} disabled={disabled}>
        {t('upload.thumbnail.reset')}
      </Button>
    );
  }
  return (
    <div className="thumb-confirm" role="alertdialog" aria-label={t('upload.thumbnail.resetConfirm')}>
      <span>{t('upload.thumbnail.resetConfirm')}</span>
      <Button
        variant="danger"
        size={40}
        className="thumb-btn thumb-btn--danger"
        onClick={() => { onReset(); setConfirming(false); }}
        autoFocus
      >
        {t('upload.thumbnail.reset')}
      </Button>
      <Button variant="secondary" size={40} className="thumb-btn" onClick={() => setConfirming(false)}>
        {t('common.actions.cancel')}
      </Button>
    </div>
  );
}
