// MUST be first import - sets up Buffer before other modules
import './polyfills';

// Dev (preview.3speak.tv) is served live by the Vite dev server and registers
// NO service worker. But a stale SW from this origin's previous static (dist)
// deployment can still be installed in the browser — it serves its cached app
// shell on first load, so you see an old page and only the *next* refresh shows
// current code. Evict any leftover SW + caches here. Stripped from prod builds
// (import.meta.env.DEV === false), so 3speak.tv's real PWA is untouched.
if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => {
      // ...except the notifications worker, which is registered ON PURPOSE in
      // dev (utils/webPush.js) and parked at its own scope precisely so it is
      // distinguishable here. Evicting it every page load was silently breaking
      // push: unregistering a worker invalidates the push subscriptions tied to
      // it, so a subscription would save fine and then come back 410 Gone from
      // the push service. It caches nothing, so there is no stale shell to
      // evict — the reason this block exists does not apply to it.
      if (r.scope.endsWith('/push-scope/')) return;
      r.unregister();
    }))
    .catch(() => {});
  if (typeof caches !== 'undefined' && caches.keys) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
  }
}

// Pick the healthy Hive RPC node for this session as early as possible.
import { ensureHealthyNode } from './utils/hiveNode';
ensureHealthyNode();

// Pick the healthy player backend before first render (see utils/playerUrl.js): try
// the primary, fall back to the next if it's down. Awaited at boot below so every
// player/preview the app creates reads the resolved URL via getPlayerUrl().
import { ensurePlayerUrl } from './utils/playerUrl';

// Watch tracking used to persist a per-browser viewer id ('3speak_viewer_id') in
// localStorage, which made every browser a stable, trackable device across visits.
// It is gone — sessions are now identified only by the server-issued `sid`, which
// lives in memory for the duration of one watch. Evict the leftover from browsers
// that still carry one.
try { localStorage.removeItem('3speak_viewer_id'); } catch { /* storage disabled */ }

// Enforce the cookie choice. Installs a storage write-guard (so declining actually
// PREVENTS the player from saving resume positions, not just deletes them later) and
// clears anything left from a previous session. Runs here, at module load, so the
// guard is in place before any video can play. Live: switching to Accept lifts it
// with no reload.
import { enforceConsentOnStart } from './lib/consent';
enforceConsentOnStart();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux'; // Importing the Provider from react-redux
import Bootstrap from './components/EmergencyScreen/Bootstrap';
import './index.css';
import store from '../src/redux/Store'; // Importing the Redux store (replace with your store file path)
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
// Roboto, self-hosted. Replaces the fonts.googleapis.com hotlink that used to sit
// in index.html and disclosed every visitor's IP to Google on page load.
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { AppProviders } from './context/Providers';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiohaProvider } from '@aioha/react-ui';
import aioha from './hive-api/aioha';
import { HelmetProvider } from 'react-helmet-async';

// import { Buffer } from 'buffer';
// window.Buffer = Buffer;
// ⚠️ `new QueryClient()` with no defaults leaves refetchOnWindowFocus ON, and that
// is what made the feeds change by themselves. Every feed sets staleTime 5min, so
// leaving the tab for longer than that and coming back refetched EVERY loaded page
// of EVERY feed at once. It read as "the feed refreshed for no reason", because
// nothing the viewer did asked for it.
//
// A feed is a place the viewer is reading, not a dashboard, so it must not move
// under them. Anything that genuinely needs to stay live (stream status, the
// OpenPods strip) already sets its own refetchInterval, which is unaffected by
// this. Explicit refreshes still work: pull-to-refresh and the interests prompt go
// through refreshHomeFeeds().
//
// The one thing the refetch did usefully -- dropping a video you just watched --
// now happens locally and precisely, see utils/feedWatched.js.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const boot = () => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <AiohaProvider aioha={aioha}>
          <AppProviders>
            <QueryClientProvider client={queryClient}>
              <Provider store={store}> {/* Wrap the app with the Redux Provider */}
                <Bootstrap />
                <ToastContainer className="custom-toast-body"/>
              </Provider>
            </QueryClientProvider>
          </AppProviders>
        </AiohaProvider>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>
);

// Render IMMEDIATELY, and resolve the player backend in the background.
//
// This used to be `Promise.race([ensurePlayerUrl(), 3s]).finally(boot)`, which held
// React back until a probe to the player host answered — measured at ~750ms on a
// cold session (and it 404s, which counts as "up"), with a blank page the whole
// time. Nothing on first paint needs the player URL: `getPlayerUrl()` reads the
// resolved value at USE time and `ensurePlayerUrl()` is idempotent + cached, so the
// watch page can await it where it actually matters.
ensurePlayerUrl();
boot();
