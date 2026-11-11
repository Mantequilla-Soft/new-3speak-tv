import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '../components/v2/Icon';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../lib/store';
import { adWizardEnabledFor } from '../utils/config';
import AdWizardFrame from '../components/ads/AdWizardFrame';

// The Ad Wizard on its own, full screen (beta: config.adWizardEnabledFor). For making an ad without a
// booking; inside a booking it opens from the creative upload on /advertise instead.
export default function AdWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAppStore();
  if (!adWizardEnabledFor(user)) return <Navigate to="/" replace />;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100050, background: 'var(--bg)' }}>
      <button type="button" onClick={() => navigate(-1)} aria-label={t('common.actions.close')} title={t('common.actions.close')}
        className="v2-iconbtn v2-btn--secondary h36 is-round"
        style={{ position: 'absolute', top: 6, right: 10, zIndex: 2 }}>
        <Icon name="close" size={20} />
      </button>
      <AdWizardFrame />
    </div>
  );
}
