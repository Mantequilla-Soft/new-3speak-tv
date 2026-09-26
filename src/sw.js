import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute, NavigationRoute, Route } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { createHandlerBoundToURL } from 'workbox-precaching';

// Take control immediately
self.skipWaiting();
clientsClaim();

// ── Web push ──
// FIRST, deliberately. An exception anywhere during evaluation kills the whole
// worker — the registration appears for a moment and then vanishes — and every
// line below this one is caching, which is a nice-to-have. Notifications are
// not: if Workbox fails to set itself up in some browser, push must still work.
// The caching block is wrapped for the same reason.
// The payload is written by the checker (services/pushNotify.js): a title, a
// line of body, the path to open, and a tag. The tag is what stops the same
// video buzzing twice on one device — the browser replaces a notification that
// already carries it rather than stacking another.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push with a non-JSON body is not ours; show nothing rather than a
    // notification full of garbage.
    return;
  }
  if (!data.title) return;

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: '/3speak.jpeg',
      badge: '/3speak.jpeg',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    }),
  );
});

// Clicking one focuses a tab that already has 3Speak open and navigates it,
// rather than piling up a new tab every time.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});


try {
// Precache all assets injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback. Denylist = routes that must hit the network instead of
// the cached SPA shell: the hivesigner callback, and the server-rendered Spotlight
// link pages (/links/<user> and legacy /@<user>/links) which are standalone HTML
// from the API, NOT part of the React app.
// createHandlerBoundToURL THROWS when its URL isn't in the precache manifest,
// and in dev that manifest is empty (`precacheAndRoute([])`) — which killed the
// whole worker at evaluation time, so nothing registered and push had no
// registration to attach to. There is no SPA shell to fall back to in dev
// anyway: the dev server serves it live.
try {
  const navHandler = createHandlerBoundToURL('/index.html');
  registerRoute(
    new NavigationRoute(navHandler, {
      denylist: [/^\/hivesigner\.html/, /^\/links\//, /^\/@[^/]+\/links\/?$/],
    })
  );
} catch {
  // Dev, or a build with no precached shell: skip the fallback, keep the worker.
}

// Runtime cache: JS, CSS, fonts
registerRoute(
  /\.(?:js|css|woff2?)$/i,
  new StaleWhileRevalidate({ cacheName: 'static-assets' })
);

// Runtime cache: images
registerRoute(
  /\.(?:png|jpg|jpeg|svg|webp)$/i,
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

// ── Share Target handler ──
// When the OS shares a video file to our PWA, the browser POSTs to /share-target.
// We intercept it, stash the file in a temporary cache, and redirect to /studio.
const SHARE_CACHE = 'share-target-cache';

const shareTargetRoute = new Route(
  ({ url, request }) => {
    return url.pathname === '/share-target' && request.method === 'POST';
  },
  async ({ request }) => {
    const formData = await request.formData();
    const videoFile = formData.get('video');

    if (videoFile) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('/shared-video', new Response(videoFile, {
        headers: {
          'Content-Type': videoFile.type,
          'X-File-Name': videoFile.name,
        },
      }));
    }

    return Response.redirect('/embed-studio?shared=true', 303);
  },
  'POST'
);
registerRoute(shareTargetRoute);

} catch (err) {
  // Offline caching is gone for this session; the worker (and push) survive.
  console.error('[sw] caching setup failed, continuing without it:', err);
}
