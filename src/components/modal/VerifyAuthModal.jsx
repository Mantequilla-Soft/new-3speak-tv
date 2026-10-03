import React from 'react';
import "./VerifyAuthModal.scss";
import { useTranslation } from "react-i18next";

function VerifyAuthModal({ isOpen }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="verify-auth-modal">
      <div className="modal-overlay"></div>
      <div className="modal-card">
        <div className="spinner"></div>
        <h3>{t('modals.verifyAuth.title')}</h3>
        <p>{t('modals.verifyAuth.text')}</p>
      </div>
    </div>
  );
}

export default VerifyAuthModal;
