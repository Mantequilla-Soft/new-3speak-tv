import { HangoutsProvider, ProUpsellDialog } from '@snapie/hangouts-react';
// The SDK ships its styles separately; this dialog can open on any page.
import '@snapie/hangouts-react/src/styles/hangouts.css';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { useHangout } from '../../context/HangoutContext';
import aioha from '../../hive-api/aioha';
import { defaultEndpoint } from '../../utils/hangoutsEndpoints';
import { proPlansPath } from '../../lib/uploadQuota';

const PREMIUM_API = (import.meta.env.VITE_HANGOUTS_PREMIUM_API_URL || '').replace(/\/$/, '');

/**
 * 🔒 The landscape video editor is 3Speak Pro (owner's call 2026-11-20): what a
 * free account gets instead of the editor. The stream studio's Pro upsell
 * (the SDK's ProUpsellDialog: the free trial when one is left, See plans), with
 * the editor's perks and in the site language. A bottom sheet on phones (SDK
 * styles). Opened by hooks/useEditorLauncher.js; lazy, so the SDK only loads
 * when somebody actually meets the gate.
 */
export default function LandscapeEditorUpsell({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, getEffectiveTheme } = useAppStore();
  const { sessionToken, retryLogin } = useHangout();
  const endpoint = defaultEndpoint();
  const perks = [
    { icon: '🎬', title: t('editorPro.perks.landscape.title'), body: t('editorPro.perks.landscape.body') },
    { icon: '♾️', title: t('editorPro.perks.uploads.title'), body: t('editorPro.perks.uploads.body') },
    { icon: '🎙️', title: t('editorPro.perks.longAudio.title'), body: t('editorPro.perks.longAudio.body') },
  ];
  return (
    <HangoutsProvider
      apiBaseUrl={endpoint.api}
      livekitServerUrl={endpoint.lk}
      premiumApiBaseUrl={PREMIUM_API || undefined}
      sessionToken={sessionToken || undefined}
      username={user || undefined}
      aioha={aioha}
      theme={getEffectiveTheme()}
      onRequestAuth={() => retryLogin(user)}
    >
      <ProUpsellDialog
        open={open}
        onClose={onClose}
        onContinue={onClose}
        heading={t('editorPro.heading')}
        subheading={t('live.createForm.upsellSub')}
        perks={perks}
        continueLabel={t('editorPro.notNow')}
        onSeePlans={() => { onClose(); if (user) navigate(proPlansPath(user)); }}
        labels={{
          tryFree: t('live.createForm.upsellTrial'),
          starting: t('live.createForm.upsellStarting'),
          seePlans: t('live.createForm.upsellSeePlans'),
          close: t('live.createForm.upsellClose'),
          loadingPlans: t('live.createForm.upsellLoadingPlans'),
        }}
      />
    </HangoutsProvider>
  );
}
