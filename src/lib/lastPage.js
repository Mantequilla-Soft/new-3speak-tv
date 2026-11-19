/**
 * "Continue where I left off": the page this browser was last on, so opening
 * 3Speak again lands there instead of on Home. main.jsx calls resumeOnStart()
 * before the router mounts, so Home never shows first; components/ResumeLastPage
 * records each page; components/RouteFallback puts a spinner over the shell
 * while the resumed page loads.
 *
 * Kept in localStorage on this device only, never sent anywhere. Pages that make
 * no sense to come back to are not remembered: sign-in and its callbacks, embeds,
 * one-time links, and the upload steps whose state lives only in memory.
 */
const STORE_KEY = 'last-page';
// Set once the "Pick up where you left off?" popup was answered, or the setting
// was switched in Settings (lib/store.js): either way, nobody is asked again.
export const START_PROMPT_KEY = '3speak_start_prompt';
export function markStartPromptAnswered() {
  try { localStorage.setItem(START_PROMPT_KEY, '1'); } catch { /* asked again next visit */ }
}
const MAX_LEN = 500;

const SKIP = [
  /^\/(login|newlogin|email|callback|auth)(\/|$)/,
  /^\/(embed|embed-studio|egress-stream|tip|invite|test|image)(\/|$)/,
  /^\/(studio|draft|editvideo|edit-scheduled|firstupload|publish-backlog|upload)(\/|$)/,
  // Publishing a stream's recording: its state comes from the stream just ended.
  /^\/openpods\/publish(\/|$)/,
  // A live stream (watching one, or the host's room): it is over by the next
  // visit, and the host's room would open the studio again.
  /^\/(watch|l)\/[^/]+/,
  /^\/openpods\/[^/]+/,
];

/** The path + query + hash to remember for a router location, or null when it is skipped. */
export function rememberablePath(loc) {
  const pathname = loc?.pathname || '';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || SKIP.some((re) => re.test(pathname))) return null;
  const path = `${pathname}${loc.search || ''}${loc.hash || ''}`;
  return path.length > MAX_LEN ? null : path;
}

export function saveLastPage(loc) {
  const path = rememberablePath(loc);
  if (!path) return;
  try { localStorage.setItem(STORE_KEY, path); } catch { /* storage blocked: nothing to resume */ }
}

/** The page to resume on, or null (nothing saved, or the last page was Home). */
export function readLastPage() {
  let path = null;
  try { path = localStorage.getItem(STORE_KEY); } catch { return null; }
  if (!path || path === '/' || path.startsWith('//')) return null;
  // Saved by an older build, or edited by hand: check it against the same rules.
  return rememberablePath({ pathname: path.split(/[?#]/)[0] }) ? path : null;
}

export function clearLastPage() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing stored */ }
}

// True from resumeOnStart() until the resumed page has loaded (RouteFallback).
let resuming = false;
export const isResuming = () => resuming;
export const endResume = () => { resuming = false; };

/**
 * Before the router mounts: when the setting is on and the app was opened on
 * Home with no query, add the saved page to the history and stand on it. Home
 * stays behind it, so Back goes there. Reads the persisted store directly,
 * since the zustand store may not be created yet. Returns the page, or null.
 */
export function resumeOnStart(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  let on = false;
  try { on = JSON.parse(localStorage.getItem('user-store') || 'null')?.state?.resumeLastPage === true; } catch { return null; }
  const { pathname, search, hash } = win.location;
  if (!on || pathname !== '/' || search || hash) return null;
  const target = readLastPage();
  if (!target) return null;
  // A refused pushState (an odd embed, a browser quirk) just stays on Home: this
  // runs in main.jsx before React, where a throw would leave a blank page.
  try { win.history.pushState(null, '', target); } catch { return null; }
  resuming = true;
  return target;
}
