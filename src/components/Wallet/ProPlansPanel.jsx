import { HangoutsProvider, ProPlans } from '@snapie/hangouts-react';
import { PRO_PERK_GROUPS } from '@snapie/hangouts-react/dist/lib/proBenefits.js';
// REQUIRED. The SDK ships its styles as a separate stylesheet, so every entry
// point that renders SDK markup has to import it — the wallet is the only route
// that mounts an SDK component without OpenPods/WatchStream also being loaded,
// so without this the Pro panel renders completely unstyled.
import '@snapie/hangouts-react/src/styles/hangouts.css';
import { useNavigate } from 'react-router-dom';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { useHangout } from '../../context/HangoutContext';
import aioha, { broadcastWithAioha, getOperationUser } from '../../hive-api/aioha';
import { defaultEndpoint } from '../../utils/hangoutsEndpoints';

// Every toast from this module is headed "Wallet"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Wallet');

// Premium status + the free trial live on the hangouts API. That is a DIFFERENT
// deployment from the rooms API for us right now (prod hangout-api has no
// /premium routes yet), so it is pointed separately. Once prod hangout-api
// ships them this can be dropped and it will fall back to apiBaseUrl.
const PREMIUM_API = (import.meta.env.VITE_HANGOUTS_PREMIUM_API_URL || '').replace(/\/$/, '');

// The SDK's perk tabs, plus what is Pro on 3Speak that the SDK cannot know:
// live captions (components/openpods/studioCaptions.js, Pro since 2026-11-17),
// the feed ranking boost (checker utils/premiumBoost.js, PREMIUM_BOOST on prod),
// 1080p YouTube imports (server/youtube-import.cjs MAX_HEIGHT_PREMIUM), no
// daily upload limits (lib/uploadQuota.js, owner's rules 2026-11-20: free is
// 1 video + 3 Shorts + 2 audio uploads a day, audio up to 15 minutes) and the
// landscape video editor (the Shorts and audio editors stay free).
// English like the rest of the SDK panel.
const EXTRA_PERKS = {
  general: [{
    icon: '📈',
    title: 'Ranked higher',
    body: 'Your videos rank higher in Discover, Trending, related videos, Shorts and Following.',
  }],
  uploads: [{
    icon: '▶️',
    title: 'YouTube imports in 1080p',
    body: 'Free imports stop at 480p.',
  }, {
    icon: '♾️',
    title: 'Unlimited daily uploads',
    body: 'Post as many videos, Shorts and audio as you like each day. Free accounts get 1 video, 3 Shorts and 2 audio uploads a day.',
  }, {
    icon: '🎙️',
    title: 'Audio longer than 15 minutes',
    body: 'Upload long episodes and mixes. Free audio uploads stop at 15 minutes.',
  }, {
    // utils/editorFormat.js landscapeEditorAllowed (owner's call 2026-11-20)
    icon: '🎬',
    title: 'Landscape video editor',
    body: 'Edit 16:9, 4:3 and square videos in the editor. The Shorts and audio editors stay free.',
  }],
  streaming: [{
    icon: '💬',
    title: 'Live captions',
    body: 'Your words as captions while you are live, written by Whisper, and kept as subtitles on the replay.',
  }],
};
const PERK_GROUPS = PRO_PERK_GROUPS.map((g) => (EXTRA_PERKS[g.id] ? { ...g, perks: [...g.perks, ...EXTRA_PERKS[g.id]] } : g));

/**
 * The 3Speak Pro section of the wallet, now rendered by the SDK.
 *
 * Replaces the old local `ThreeSpeakPro` component so there is ONE Pro surface:
 * the same component the stream upsell opens, so perks, pricing and the trial
 * can no longer disagree between the wallet and the studio.
 */
export default function ProPlansPanel() {
  const { user, getEffectiveTheme } = useAppStore();
  const { sessionToken, retryLogin } = useHangout();
  const navigate = useNavigate();
  const endpoint = defaultEndpoint();

  return (
    <HangoutsProvider
      apiBaseUrl={endpoint.api}
      livekitServerUrl={endpoint.lk}
      premiumApiBaseUrl={PREMIUM_API || undefined}
      sessionToken={sessionToken || undefined}
      username={user || undefined}
      aioha={aioha}
      theme={getEffectiveTheme()}
      /* The wallet page has no hangouts session — HangoutContext signs in
         lazily (on /openpods or when a room is opened) to avoid a wallet
         prompt on every page load. The SDK calls this only when the user
         actually clicks "Try Pro free", so the prompt stays user-initiated. */
      onRequestAuth={() => retryLogin(user)}
      pro={{
        // Route signing through 3Speak's own wrapper rather than raw aioha:
        // it handles the ButrAuth / HiveSigner proxy paths that a bare
        // signAndBroadcastTx would miss.
        broadcastOps: (ops, keyType) => broadcastWithAioha(ops, keyType),
        // ButrAuth sessions have NO aioha user, so aioha.getCurrentUser()
        // returns null and hand-built ops would go out with a null auth.
        getUsername: () => getOperationUser() || user,
      }}
    >
      <ProPlans
        benefitGroups={PERK_GROUPS}
        onSelectUser={(u) => navigate(`/@${u}`)}
        onNotify={(kind, message) => (kind === 'success' ? toast.success(message) : toast.error(message))}
      />
    </HangoutsProvider>
  );
}
