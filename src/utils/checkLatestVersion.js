import { toastIn } from './toast';
import { APP_VERSION } from "../version";
import { APP_VERSION_STORAGE_KEY } from "./appVersion";

// Every toast from this module is headed "App update"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('App update');

// The live release lives on the repo's `production` branch, whose version.js is
// the source of truth for the latest released version. We read it raw from GitHub
// and compare it to the version baked into the running bundle, so a user on a
// stale (cached) build can be prompted to refresh.
const REMOTE_VERSION_URL =
  "https://raw.githubusercontent.com/Mantequilla-Soft/new-3speak-tv/production/src/version.js";

// "export const APP_VERSION = '1.2.3';" → "1.2.3"
function parseVersion(text) {
  const m = String(text || "").match(/APP_VERSION\s*=\s*['"]([\d.]+)['"]/);
  return m ? m[1] : null;
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

// Returns the latest version string if GitHub's production branch is newer than
// the running build, otherwise null (also null on any network error / offline).
export async function fetchNewerVersion() {
  // Never on the dev server. preview.3speak.tv runs Vite in dev mode off a feature
  // branch, so this would compare a branch build against `production` — two
  // different things. Preview is routinely a commit or two behind production while
  // work is in flight, and the prompt that produces cannot be satisfied: refreshing
  // reloads preview's own build, which is still the version it was. It nagged on
  // every focus and every 30 minutes with no way out.
  if (import.meta.env.DEV) return null;

  try {
    const res = await fetch(`${REMOTE_VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const remote = parseVersion(await res.text());

    let stored = null;
    try { stored = localStorage.getItem(APP_VERSION_STORAGE_KEY); } catch { /* ignore */ }
    console.log(
      `[version] GitHub (production): ${remote} | browser storage: ${stored} | running build: ${APP_VERSION}`
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
// has been deployed (per the GitHub `production` version.js — the same changelog-
// driven version check used for the global refresh prompt), it toasts and force-
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
  toast(`Updating to the latest version (${newer})…`, {
    description: "Reloading so your upload runs on the newest build.",
  });
  await reloadForUpdate();
  return true;
}
