/**
 * "Continue where I left off": the page this browser was last on, so opening
 * 3Speak again lands there instead of on Home (components/ResumeLastPage.jsx).
 *
 * Kept in localStorage on this device only, never sent anywhere. Pages that make
 * no sense to come back to are not remembered: sign-in and its callbacks, embeds,
 * one-time links, and the upload steps whose state lives only in memory.
 */
const STORE_KEY = 'last-page';
const MAX_LEN = 500;

const SKIP = [
  /^\/(login|newlogin|email|callback|auth)(\/|$)/,
  /^\/(embed|embed-studio|egress-stream|tip|invite|test|image)(\/|$)/,
  /^\/(studio|draft|editvideo|edit-scheduled|firstupload|publish-backlog)(\/|$)/,
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
