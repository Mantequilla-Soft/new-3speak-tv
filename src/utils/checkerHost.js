// Checker instance selection: send every checker call to the instance that is
// fastest for THIS viewer (checker.3speak.tv in Helsinki, checker-us.3speak.tv, ...).
//
// Why not just ping each host: the instances share one Mongo (primary in Virginia),
// and a feed costs (viewer <-> instance) + several x (instance <-> Mongo). So each
// instance's GET /health/latency does one real Mongo round trip and reports it as
// db_ms. Score = the probe's total time (already holds one DB trip) + DB_WEIGHT x
// db_ms for the extra trips a real feed makes. Lowest score wins.
//
// How calls get there: ~80 modules build checker URLs from CHECKER_URL at import
// time, and several env vars (feed, legacy API, scheduled posts...) point at the same
// host. Rather than thread a getter through all of them, installCheckerRouting()
// rewrites the ORIGIN of any fetch / XHR / sendBeacon aimed at the primary checker
// to the chosen instance, at request time. Media elements (<audio src>, <img>) keep
// the URL they were given and so stay on the primary, which serves everything.
//
// Failover: a network error from the chosen instance benches it for BENCH_MS and
// moves to the next one in the ranking (the primary last). A GET / HEAD is retried
// once there; anything else is not (it may have reached the server).
//
// The pick is kept in localStorage for TTL_MS, so a returning viewer is routed
// right away and the race runs about four times a day, not on every page load.

import { CHECKER_URL, CHECKER_URLS } from './config';

// v2: v1 picks from 2026-11-07 21:18-21:19 UTC could name a non-checker host.
const STORE_KEY = 'checker-host.v2';
const TTL_MS = 6 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 3000;
const BENCH_MS = 2 * 60 * 1000;
// Extra Mongo round trips a typical feed request makes beyond the probe's one.
const DB_WEIGHT = (() => {
  const n = parseFloat(import.meta.env.VITE_CHECKER_DB_WEIGHT);
  return Number.isFinite(n) && n >= 0 ? n : 2;
})();
// The primary keeps the pick unless another instance is clearly faster, so two
// near-equal instances do not swap on every race.
const PRIMARY_MARGIN_MS = 30;

export function originOf(url) {
  try { return new URL(String(url)).origin; } catch { return ''; }
}

const PRIMARY = originOf(CHECKER_URL);
const CANDIDATES = [...new Set([PRIMARY, ...CHECKER_URLS.map(originOf)].filter(Boolean))];

const now = () => Date.now();
const benched = new Map(); // origin -> benched until (ms)
let ranking = [PRIMARY];   // best first; the primary is always in it

function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.ranking) || !(now() - raw.at < TTL_MS)) return null;
    const r = raw.ranking.filter((o) => CANDIDATES.includes(o));
    return r.length ? r : null;
  } catch { return null; }
}
function store(r) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ranking: r, at: now() })); } catch { /* storage off */ }
}
function withPrimary(r) {
  return r.includes(PRIMARY) ? r : [...r, PRIMARY];
}

{
  const stored = readStored();
  if (stored) ranking = withPrimary(stored);
}

/** The origin checker calls go to right now. */
export function getCheckerOrigin() {
  const t = now();
  return ranking.find((o) => !(benched.get(o) > t)) || PRIMARY;
}

/** `url` with the primary checker's origin swapped for the chosen one. */
export function rewriteCheckerUrl(url) {
  if (typeof url !== 'string' || !PRIMARY) return url;
  if (url !== PRIMARY && !url.startsWith(`${PRIMARY}/`) && !url.startsWith(`${PRIMARY}?`)) return url;
  const target = getCheckerOrigin();
  return target === PRIMARY ? url : target + url.slice(PRIMARY.length);
}

/** Bench an instance after a network error; the next in the ranking takes over. */
export function benchChecker(origin) {
  if (!origin || CANDIDATES.length <= 1) return;
  benched.set(origin, now() + BENCH_MS);
}

/** Lower is better. `ms` is the probe's total time, `dbMs` the instance's Mongo trip. */
export function scoreProbe({ origin, ms, dbMs }) {
  const db = Number.isFinite(dbMs) && dbMs > 0 ? dbMs : 0;
  return ms + DB_WEIGHT * db - (origin === PRIMARY ? PRIMARY_MARGIN_MS : 0);
}

/** Probe results -> ranking (best first). Failed probes rank last, primary always present. */
export function rankProbes(results) {
  const up = results.filter((r) => r && r.ok).sort((a, b) => scoreProbe(a) - scoreProbe(b));
  return withPrimary(up.map((r) => r.origin));
}

let nativeFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

async function probeOnce(origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await nativeFetch(`${origin}/health/latency`, { cache: 'no-store', signal: ctrl.signal });
    const ms = performance.now() - t0;
    if (!res.ok) return { origin, ok: false };
    // Only a real checker answer counts: { ok: true, db_ms: <number> }. Anything else
    // (a 404 page, a login redirect, some other app on that hostname) must never win
    // the race, or every checker call would go to a server that is not a checker.
    const body = await res.json().catch(() => null);
    const dbMs = body ? Number(body.db_ms) : NaN;
    if (!body || body.ok !== true || !Number.isFinite(dbMs)) return { origin, ok: false };
    return { origin, ok: true, ms, dbMs };
  } catch {
    return { origin, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// Two probes per instance, keep the faster: the first pays DNS + TLS setup, which
// says little about the requests that follow on the same connection.
async function probe(origin) {
  const a = await probeOnce(origin);
  if (!a.ok) return a;
  const b = await probeOnce(origin);
  return b.ok && b.ms < a.ms ? b : a;
}

let racing = null;

/** Race the instances (unless a fresh pick is stored) and route to the winner. */
export function ensureCheckerHost({ force = false } = {}) {
  if (CANDIDATES.length <= 1 || !nativeFetch) return Promise.resolve(getCheckerOrigin());
  if (!force && readStored()) return Promise.resolve(getCheckerOrigin());
  if (racing) return racing;
  racing = Promise.all(CANDIDATES.map(probe))
    .then((results) => {
      // Everything failed: likely this viewer is offline. Keep the current
      // ranking and store nothing, so the next load races again.
      if (!results.some((r) => r.ok)) return getCheckerOrigin();
      ranking = rankProbes(results);
      store(ranking);
      return getCheckerOrigin();
    })
    .finally(() => { racing = null; });
  return racing;
}

const isNetworkError = (err) => err && err.name !== 'AbortError';
// An instance that is down behind Cloudflare does not fail the request: Cloudflare
// ANSWERS it, with 521 (origin refused), 522 (timed out), 502/504 etc. Those count
// as "instance down" just like a network error.
const GATEWAY_FAILURES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
export const isGatewayFailure = (status) => GATEWAY_FAILURES.has(Number(status));
const methodOf = (input, init) => String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

let installed = false;

/** Patch fetch, XHR and sendBeacon once to follow getCheckerOrigin(). */
export function installCheckerRouting() {
  if (installed || CANDIDATES.length <= 1) return;
  installed = true;

  if (nativeFetch) {
    const orig = nativeFetch;
    globalThis.fetch = function checkerFetch(input, init) {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = isReq ? input.url : (input instanceof URL ? input.href : input);
      const target = rewriteCheckerUrl(url);
      if (typeof url !== 'string' || target === url) return orig(input, init);
      const used = originOf(target);
      const method = methodOf(input, init);
      const send = (u) => orig(isReq ? new Request(u, input) : u, init);
      const idempotent = method === 'GET' || method === 'HEAD';
      return send(target).then((res) => {
        if (!isGatewayFailure(res.status)) return res;
        benchChecker(used);
        const next = rewriteCheckerUrl(url);
        return idempotent && next !== target ? send(next) : res;
      }, (err) => {
        if (!isNetworkError(err)) throw err;
        benchChecker(used);
        const next = rewriteCheckerUrl(url);
        if (!idempotent || next === target) throw err;
        return send(next);
      });
    };
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function checkerOpen(method, url, ...rest) {
      const s = url instanceof URL ? url.href : url;
      const target = rewriteCheckerUrl(s);
      if (typeof s === 'string' && target !== s) {
        const used = originOf(target);
        this.addEventListener('error', () => benchChecker(used), { once: true });
        this.addEventListener('load', () => { if (isGatewayFailure(this.status)) benchChecker(used); }, { once: true });
        return origOpen.call(this, method, target, ...rest);
      }
      return origOpen.call(this, method, url, ...rest);
    };
  }

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => origBeacon(rewriteCheckerUrl(url instanceof URL ? url.href : url), data);
  }

  // A long-open tab re-races when its pick goes stale.
  if (typeof setInterval === 'function') setInterval(() => { ensureCheckerHost(); }, 30 * 60 * 1000);
}

/** Tests only. */
export const _test = {
  PRIMARY, CANDIDATES, STORE_KEY, TTL_MS, DB_WEIGHT, PRIMARY_MARGIN_MS,
  reset({ fetchImpl } = {}) {
    benched.clear();
    ranking = withPrimary(readStored() || [PRIMARY]);
    racing = null;
    if (fetchImpl) nativeFetch = fetchImpl;
  },
};
