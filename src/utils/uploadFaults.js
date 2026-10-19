/**
 * Upload fault injection — a test harness for the upload failure modes we cannot
 * reproduce on a normal connection.
 *
 * The bugs that bite real users live on networks we can't borrow: a carrier that
 * silently eats the TUS PATCH method, or a middlebox that accepts an upload POST
 * and then black-holes it. Both are invisible on a healthy line. This lets us
 * trigger them on demand.
 *
 * WHO: badadib only (hardcoded — no env var, nothing to misconfigure). Every entry
 * point re-checks; there is no way to arm this as another user.
 *
 * HOW: both upload paths ultimately run on XMLHttpRequest — tus-js-client uses it
 * for PATCH, and the chunked fallback's postForm uses it directly — so one XHR
 * patch reaches both. It is installed lazily (only once a fault is actually armed)
 * and only ever alters requests to the upload endpoints; everything else on the
 * page goes through untouched.
 *
 * Flags live in sessionStorage so they survive the navigation between the upload
 * steps, and die with the tab.
 */

const FAULT_USER = 'badadib';
const KEY = '3speak_upload_faults';

// Off: the debug panel is hidden and nothing can be armed, not even by badadib.
// Kept for the next upload investigation; flip to true to bring it back.
const FAULTS_ENABLED = false;

export function canUseUploadFaults(user) {
  return FAULTS_ENABLED && String(user || '').toLowerCase() === FAULT_USER;
}

const DEFAULTS = {
  blockPatch: false,       // carrier eats the TUS PATCH → should trip the watchdog → auto-fallback
  blackholeChunks: false,  // middlebox swallows the chunk-protocol POSTs → create/stall watchdogs → tier 3
  blackholeSimple: false,  // ALSO swallow the single-request last resort → total blackout, nothing can pass
  chunkFailRate: 0,        // 0..1 — flaky link: fail this share of chunk POSTs → should retry + resync
  forceWeakLink: false,    // pretend navigator.connection reports a thin uplink
};

/**
 * Is the weak-link profile being forced?
 *
 * Unlike the flags above this is NOT an XHR fault — nothing is intercepted. It
 * only makes getConnectionProfile() report `weak`, which is what selects the
 * small-chunk / multi-worker upload profile. That profile is otherwise
 * unreachable on a healthy office line, so without this it could only ever be
 * tested by finding a genuinely bad mobile connection.
 *
 * It deliberately does NOT slow anything down: browser request-level throttling
 * cannot pace an XHR body (the panel says as much), so simulating real slowness
 * is not on offer. What this DOES verify is the part that actually changed —
 * that the weak profile fans out to several concurrent chunk POSTs and that the
 * upload reassembles correctly. Tick it together with "flaky link" to also
 * exercise retry + /status resync while several workers are in flight, which is
 * the closest we can get to the conditions that cost a real upload 68 minutes.
 */
export function isWeakLinkForced() {
  if (!FAULTS_ENABLED) return false;
  try { return !!getUploadFaults().forceWeakLink; } catch { return false; }
}

export function getUploadFaults() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setUploadFaults(user, patch) {
  if (!canUseUploadFaults(user)) return getUploadFaults();
  const next = { ...getUploadFaults(), ...patch };
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  if (isArmed(next)) installUploadFaults();
  return next;
}

export function clearUploadFaults() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

// NB: forceWeakLink is deliberately absent — it patches nothing, so it must not
// pull the XHR interceptor in on its own. Only real faults arm the patch.
function isArmed(f) {
  return !!(f.blockPatch || f.blackholeChunks || f.blackholeSimple || f.chunkFailRate > 0);
}

// Only ever touch the upload endpoints — never the rest of the app's traffic.
//
// The chunk PROTOCOL (create/status/finish + the data POSTs) and the
// single-request last resort are DIFFERENT transports and must be blockable
// independently. They used to share one matcher, which meant the "black-hole the
// chunks" switch silently killed the single-request fallback too — so tier 3
// could never be exercised, and the harness reported "nothing works" for a
// network on which something would in fact have worked.
const isTusUrl = (url) => /\/uploads(\/|$)/.test(url);
const isChunkUrl = (url) => /\/upload\/chunk/.test(url);
const isSimpleUrl = (url) => /\/upload\/simple/.test(url);
const isUploadUrl = (url) => isTusUrl(url) || isChunkUrl(url) || isSimpleUrl(url);

const log = (...a) => console.warn('[upload-faults]', ...a);

let installed = false;

/**
 * Patch XHR once. The patch is inert unless a fault is armed AND the request is an
 * upload request, so leaving it installed after the flags are cleared is harmless.
 */
export function installUploadFaults() {
  if (installed || typeof XMLHttpRequest === 'undefined') return;
  installed = true;

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__fault = { method: String(method || '').toUpperCase(), url: String(url || '') };
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const f = getUploadFaults();
    const { method = '', url = '' } = this.__fault || {};

    if (isArmed(f) && isUploadUrl(url)) {
      // A black hole: the request leaves and NOTHING ever comes back. No response,
      // no error, no timeout — the case that hangs a naive uploader forever.
      const blackhole =
        (f.blockPatch && method === 'PATCH') ||
        (f.blackholeChunks && method === 'POST' && isChunkUrl(url)) ||
        (f.blackholeSimple && method === 'POST' && isSimpleUrl(url));

      if (blackhole) {
        log(`black-holed ${method} ${url}`);
        // We never call the real send(), so per spec the send() flag stays unset and
        // a later abort() would fire NO event — which would leave the caller's
        // promise pending and make it look like the app is broken when it isn't.
        // Re-dispatch abort ourselves so the caller's stall watchdog can still cut
        // this request loose. Without this the harness would be testing a fiction.
        this.abort = () => {
          try { this.dispatchEvent(new ProgressEvent('abort')); } catch { /* ignore */ }
        };
        return undefined;
      }

      // A flaky link: the request dies mid-flight with a bare network error, the way
      // a dropped mobile connection does. Exercises the retry + /status resync path.
      if (f.chunkFailRate > 0 && method === 'POST' && isChunkUrl(url) && Math.random() < f.chunkFailRate) {
        log(`failed ${method} ${url} (chunkFailRate ${f.chunkFailRate})`);
        setTimeout(() => {
          try { this.dispatchEvent(new ProgressEvent('error')); } catch { /* ignore */ }
        }, 250);
        return undefined;
      }
    }

    return origSend.call(this, body);
  };
}

// Re-arm on a fresh page load if the flags survived in sessionStorage (e.g. the
// tester reloaded mid-upload to check that resume works).
export function initUploadFaults(user) {
  if (!canUseUploadFaults(user)) return;
  if (isArmed(getUploadFaults())) installUploadFaults();
}
