import React from 'react';
import "./VerifyAuthModal.scss";

function VerifyAuthModal({ isOpen }) {
  if (!isOpen) return null;

  return (
    <div className="verify-auth-modal">
      <div className="modal-overlay"></div>
      <div className="modal-card">
        <div className="spinner"></div>
        <h3>Verifying Authorization</h3>
        <p>Please wait while we verify that authorization was granted...</p>
      </div>
    </div>
  );
}

export default VerifyAuthModal;
