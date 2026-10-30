/**
 * Voice boost and skip silence: the Web Audio side of the global audio player.
 *
 * An <audio> element only goes through Web Audio when its source allows CORS
 * (see corsKnown in playerMath.js). Routing one that doesn't would play silence,
 * and createMediaElementSource can't be undone, so the player keeps two kinds of
 * element (plain and routed, switched by React key) and only ever hands a routed
 * one to attach() below.
 *
 *   source ─┬─> [highpass ~80 Hz → compressor → makeup gain] ─> speakers   (voice boost on)
 *           ├─────────────────────────────────────────────────> speakers   (voice boost off)
 *           └─> analyser (level for skip silence, no output)
 */
import { corsKnown, rememberCors } from './playerMath';

let ctx = null;
// One source node per element, ever: a second createMediaElementSource on the
// same element throws (React StrictMode runs effects twice).
const sources = new WeakMap();

function context() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

/**
 * Create and start the context from a click (an effect switched on): browsers
 * only let audio start from a user gesture, and the element that will use it
 * only arrives a moment later.
 */
export function warmUp() {
  const ac = context();
  if (ac && ac.state !== 'running') ac.resume().catch(() => {});
}

export const webAudioSupported = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

/**
 * Route `el` through the graph. Returns a handle, or null when Web Audio isn't
 * there (the element then plays on as it is).
 */
export function attach(el) {
  const ac = context();
  if (!ac || !el) return null;
  let node = sources.get(el);
  try {
    if (!node) {
      const src = ac.createMediaElementSource(el);
      const highpass = ac.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 80;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -28;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      const makeup = ac.createGain();
      makeup.gain.value = 1.8;
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      highpass.connect(comp);
      comp.connect(makeup);
      makeup.connect(ac.destination);
      src.connect(analyser);
      node = { src, highpass, analyser, boost: null, buf: new Float32Array(analyser.fftSize) };
      sources.set(el, node);
    }
  } catch {
    return null;
  }
  const handle = {
    /** Voice boost on or off: the source feeds the filter chain or the speakers. */
    setBoost(on) {
      if (node.boost === !!on) return;
      try { node.src.disconnect(); } catch { /* not connected */ }
      node.src.connect(node.analyser);
      node.src.connect(on ? node.highpass : ac.destination);
      node.boost = !!on;
    },
    /** The latest block of samples, for the level meter. */
    samples() {
      node.analyser.getFloatTimeDomainData(node.buf);
      return node.buf;
    },
    get state() { return ac.state; },
    resume() { return ac.state === 'running' ? Promise.resolve() : ac.resume().catch(() => {}); },
  };
  // Until told otherwise the audio goes straight through.
  if (node.boost == null) handle.setBoost(false);
  return handle;
}

/** Let go of a retired element: its nodes stop feeding the speakers. */
export function detach(el) {
  const node = el && sources.get(el);
  if (!node) return;
  try { node.src.disconnect(); } catch { /* already */ }
  node.boost = null;
}

const storage = () => { try { return window.localStorage; } catch { return null; } };

// One probe per host at a time.
const pending = new Map();

/**
 * Whether `url` allows CORS, from the cache or by asking the host once: a
 * normal GET in CORS mode, cancelled as soon as the headers are in so the
 * episode itself isn't downloaded. A timeout counts as "no" for now but isn't
 * remembered.
 */
export async function canRoute(url, { timeoutMs = 4000 } = {}) {
  const known = corsKnown(url, { storage: storage(), origin: window.location.origin });
  if (known != null) return known;
  let host;
  try { host = new URL(url).host; } catch { return false; }
  if (pending.has(host)) return pending.get(host);
  const p = (async () => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort(); }, timeoutMs);
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl?.signal });
      const ok = res.type === 'cors' || res.type === 'basic';
      ctrl?.abort();
      rememberCors(url, ok && res.status < 400, { storage: storage() });
      return ok && res.status < 400;
    } catch {
      // A CORS refusal rejects too; a timeout or being offline is left unremembered.
      if (!timedOut && navigator.onLine !== false) rememberCors(url, false, { storage: storage() });
      return false;
    } finally {
      clearTimeout(timer);
      pending.delete(host);
    }
  })();
  pending.set(host, p);
  return p;
}

/** Mark a host as not working after all (a routed element failed on it). */
export function markNoCors(url) {
  rememberCors(url, false, { storage: storage() });
}
