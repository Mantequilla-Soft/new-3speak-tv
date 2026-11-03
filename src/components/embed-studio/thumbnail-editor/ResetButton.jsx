import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';

/** Reset, asked in place ("Reset all edits? Reset / Cancel") rather than in a second popup. */
export default function ResetButton({ onReset, disabled }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="thumb-btn" onClick={() => setConfirming(true)} disabled={disabled}>
        <RotateCcw size={15} aria-hidden="true" />
        {t('upload.thumbnail.reset')}
      </button>
    );
  }
  return (
    <div className="thumb-confirm" role="alertdialog" aria-label={t('upload.thumbnail.resetConfirm')}>
      <span>{t('upload.thumbnail.resetConfirm')}</span>
      <button
        type="button"
        className="thumb-btn thumb-btn--danger"
        onClick={() => { onReset(); setConfirming(false); }}
        autoFocus
      >
        {t('upload.thumbnail.reset')}
      </button>
      <button type="button" className="thumb-btn" onClick={() => setConfirming(false)}>
        {t('common.actions.cancel')}
      </button>
    </div>
  );
}
