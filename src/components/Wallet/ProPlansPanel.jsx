import { HangoutsProvider, ProPlans } from '@snapie/hangouts-react';
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
        onSelectUser={(u) => navigate(`/p/${u}`)}
        onNotify={(kind, message) => (kind === 'success' ? toast.success(message) : toast.error(message))}
      />
    </HangoutsProvider>
  );
}
