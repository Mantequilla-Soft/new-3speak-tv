import React from 'react';
import "./VerifyAuthModal.scss";
import { useTranslation } from "react-i18next";
import { Dialog, Icon } from "../v2/ui";

// Shown while the posting-authority grant is checked. It closes itself, so
// it has no close button and ignores Escape.
function VerifyAuthModal({ isOpen }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!isOpen} title={t('modals.verifyAuth.title')} head={false} dismissible={false} width={400}>
      <div className="verify-auth" role="status">
        <Icon name="progress_activity" size={24} className="v2-spin" />
        <div>
          <b>{t('modals.verifyAuth.title')}</b>
          <p>{t('modals.verifyAuth.text')}</p>
        </div>
      </div>
    </Dialog>
  );
}

export default VerifyAuthModal;
