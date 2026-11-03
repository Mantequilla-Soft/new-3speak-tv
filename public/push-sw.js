/*
 * Minimal CLASSIC service worker: notifications only, no imports, no Workbox.
 *
 * Why this exists alongside src/sw.js: Firefox does not support ES-module
 * service workers, and the Vite dev server can only serve the app's real worker
 * as a module (its Workbox imports are ESM). So in dev, Firefox throws during
 * script evaluation and ends up with no worker at all — which means no push,
 * and no way to test notifications in that browser.
 *
 * A production build bundles src/sw.js into a classic script, so this file is
 * never reached there: utils/webPush.js tries /sw.js first and only falls
 * through to this when the real worker cannot be registered.
 *
 * Keep the two push handlers here in step with the ones at the top of
 * src/sw.js. They are duplicated rather than shared because a classic worker
 * cannot import, and pulling in a bundler for thirty lines would defeat the
 * point of having a dependency-free fallback.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    return;                       // not ours; better nothing than a garbage notification
  }
  if (!data.title) return;

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: '/3speak.jpeg',
      // The status-bar icon: Android draws it as a white silhouette of its alpha
      // channel, so it must be a transparent PNG (a JPEG became a white square).
      badge: '/notification-badge.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (all) {
      for (var i = 0; i < all.length; i += 1) {
        var client = all[i];
        if (new URL(client.url).origin === self.location.origin) {
          return client.focus().then(function () {
            return 'navigate' in client ? client.navigate(target) : null;
          });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
