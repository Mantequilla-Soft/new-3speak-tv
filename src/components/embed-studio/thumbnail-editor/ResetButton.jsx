import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../v2/ui';

/** Reset, asked in place ("Reset all edits? Reset / Cancel") rather than in a second popup. */
export default function ResetButton({ onReset, disabled }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
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
