import { toastIn } from './toast';
import { t } from '../i18n';
import { APP_VERSION } from "../version";
import { APP_VERSION_STORAGE_KEY } from "./appVersion";

// Every toast from this module is headed "App update"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('App update');

// What 3speak.tv is serving right now: version.json is written by the build
// (vite.config.js) and only goes live when a deploy swaps the new build in. The
// production branch on GitHub is no guide: a merge lands there long before the
// swap (the deploy waits for running uploads), and a deploy that fails its smoke
// test is swapped back. Same origin, never cached (no-store + nginx sends no
// Cache-Control for it, the service worker has no route for .json).
const LIVE_VERSION_URL = "/version.json";

// '{"version":"1.2.3"}' → "1.2.3"; anything else (the SPA's HTML) → null.
function parseVersion(text) {
  let v;
  try { v = JSON.parse(text)?.version; } catch { return null; }
  return typeof v === "string" && /^\d+(\.\d+)*$/.test(v) ? v : null;
}

// true when version `a` is newer than `b` (numeric dot-separated parts).
export function isNewerVersion(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Returns the live site's version if it is newer than the running build, otherwise
// null (also null on any network error / offline, or a build without version.json,
// where the SPA fallback answers with HTML).
export async function fetchNewerVersion() {
  // Never on the dev server. preview.3speak.tv runs Vite in dev mode off a feature
  // branch, so this would compare a branch build against `production` — two
  // different things. Preview is routinely a commit or two behind production while
  // work is in flight, and the prompt that produces cannot be satisfied: refreshing
  // reloads preview's own build, which is still the version it was. It nagged on
  // every focus and every 30 minutes with no way out.
  if (import.meta.env.DEV) return null;

  try {
    const res = await fetch(`${LIVE_VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const remote = parseVersion(await res.text());

    let stored = null;
    try { stored = localStorage.getItem(APP_VERSION_STORAGE_KEY); } catch { /* ignore */ }
    console.log(
      `[version] live site: ${remote} | browser storage: ${stored} | running build: ${APP_VERSION}`
    );

    if (remote && isNewerVersion(remote, APP_VERSION)) return remote;
  } catch {
    // offline / blocked — ignore, no prompt
  }
  return null;
}

// Drop caches + service workers and reload, so the browser fetches the new build
// fresh instead of serving the cached (stale) one.
export async function reloadForUpdate() {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      // Same exception as main.jsx: the notifications worker holds the push
      // subscription and caches nothing, so wiping it here would quietly
      // unsubscribe someone as a side effect of taking an update.
      await Promise.all(
        regs.filter((r) => !r.scope.endsWith("/push-scope/")).map((r) => r.unregister()),
      );
    }
  } catch {
    // ignore — reload anyway
  }
  window.location.reload();
}

// Upload gate. Call this at the very start of any real upload. If a newer build
// has been deployed (per the live site's version.json, the same check used for
// the global refresh prompt), it toasts and force-
// reloads onto the latest build BEFORE the upload runs, then resolves `true` so
// the caller can bail out. Resolves `false` when the running build is current.
//
// Why this exists: stale, service-worker-cached tabs running the retired legacy
// uploader POST to a dead backend that returns an HTML error page, producing the
// "Unexpected token '<' ... <!DOCTYPE ... is not valid json" upload failure. The
// fix is to never let a stale client start an upload — refresh it first.
export async function reloadIfStale() {
  const newer = await fetchNewerVersion();
  if (!newer) return false;
  toast(t('misc.appUpdate.updating', { version: newer }), {
    description: t('misc.appUpdate.reloadingForUpload'),
  });
  await reloadForUpdate();
  return true;
}
