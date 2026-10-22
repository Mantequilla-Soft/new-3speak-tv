import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 100050, background: 'var(--bg-primary, #0f0f0f)' }}>
      <button type="button" onClick={() => navigate(-1)} aria-label={t('common.actions.close')}
        style={{ position: 'absolute', top: 6, right: 10, zIndex: 2, width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <X size={18} />
      </button>
      <AdWizardFrame />
    </div>
  );
}
