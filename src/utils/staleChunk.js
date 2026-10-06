/* Recovery for a code-split file that failed to load, usually because a deploy
 * replaced the content-hashed files while this tab (or a service worker) was still
 * running the previous build. Every file that build has not downloaded yet is 404.
 *
 * Retrying the import in place does not help: the browser caches the failure in its
 * module map for the lifetime of the document (see lazyRoute.js). Only a fresh
 * document on the current build recovers, so reload once, then stop.
 */

// One reload attempt per name per tab. Session-scoped, because a file that is
// genuinely missing (rather than briefly unreachable) would otherwise put the tab
// into an endless reload cycle — the second failure has to fall through instead.
const RELOADED_KEY = "3speak_chunk_reloaded";

function readReloaded() {
  try {
    const raw = sessionStorage.getItem(RELOADED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    // Private mode / storage disabled. We lose the loop guard, so return null and
    // never reload at all — an error message is recoverable, a reload loop is not.
    return null;
  }
}

function markReloaded(name) {
  try {
    const list = readReloaded() || [];
    if (!list.includes(name)) list.push(name);
    sessionStorage.setItem(RELOADED_KEY, JSON.stringify(list));
  } catch {
    /* ignore — see readReloaded */
  }
}

/**
 * Reload onto the current build, at most once per `name` per tab. Resolves true when
 * the reload is under way (nothing after it should run), false when the caller has
 * to cope with the failure itself.
 */
export async function reloadOnceForChunk(name) {
  const reloaded = readReloaded();
  // Reloading while offline just trades this screen for the browser's own error
  // page, and burns the one retry we get.
  if (!reloaded || reloaded.includes(name) || navigator.onLine === false) return false;
  markReloaded(name);
  // Imported here, not at the top: checkLatestVersion imports i18n, and i18n uses
  // this module, so a static import would be a cycle. It is in the main bundle
  // already, so this never fetches anything.
  const { reloadForUpdate } = await import("./checkLatestVersion");
  // Clears caches + service workers first, so the reload actually fetches the new
  // index.html rather than the cached one that names dead files.
  await reloadForUpdate();
  return true;
}
