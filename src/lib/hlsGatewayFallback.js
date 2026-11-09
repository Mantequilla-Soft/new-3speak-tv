// Retries a stalled IPFS playlist or segment on another gateway.
//
// The master manifest comes through the player's /hls proxy, which already picks
// a gateway that answers, but the variant playlists and segments inside it point
// straight at ipfs-3speak.b-cdn.net. When the IPFS network cannot find a CID's
// blocks (new uploads not announced: 2026-09-30, again 2026-11-09) Bunny serves
// the segments it cached earlier and hangs on the rest, so a video plays its
// first seconds and then spins for minutes. ipfs-audio.3speak.tv sits on the
// node the encoders upload to and has every file, with CORS.
//
// So: the first try on the address hls.js asked for gets a SHORT time to first
// byte. Silence or an error moves the request to the other gateway, and a CID
// that loaded from there keeps using it for the rest of the page. If the other
// gateway fails too, the original address gets the caller's full time, so an
// old, cold video that only the CDN can reach still plays as before.
import Hls from 'hls.js';

const GATEWAY_HOSTS = new Set([
  'ipfs-3speak.b-cdn.net',
  'hotipfs-3speak-1.b-cdn.net',
  'ipfs.3speak.tv',
]);
export const FALLBACK_ORIGIN = 'https://ipfs-audio.3speak.tv';

// Time to first byte on the first try, and on the other gateway.
export const FIRST_TRY_TTFB_MS = 5000;
export const FALLBACK_TTFB_MS = 10000;

// CIDs whose files came from the fallback gateway: start there next time.
const preferFallback = new Set();
export const resetGatewayPreferences = () => preferFallback.clear();

// { cid, primary, fallback } for an /ipfs/ address on one of our gateways,
// otherwise null (the /hls proxy, other hosts, anything unparseable).
export function gatewayPair(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const m = u.pathname.match(/^\/ipfs\/([^/]+)/);
  if (!m || !GATEWAY_HOSTS.has(u.hostname)) return null;
  return { cid: m[1], primary: url, fallback: FALLBACK_ORIGIN + u.pathname + u.search };
}

// The ordered tries for one request. `ttfb` caps time to first byte (and turns
// the loader's own retries off); no `ttfb` means the caller's policy as given.
export function attemptPlan(url) {
  const pair = gatewayPair(url);
  if (!pair) return null;
  if (preferFallback.has(pair.cid)) {
    return [
      { url: pair.fallback, ttfb: FALLBACK_TTFB_MS, fallback: true },
      { url: pair.primary },
    ];
  }
  return [
    { url: pair.primary, ttfb: FIRST_TRY_TTFB_MS },
    { url: pair.fallback, ttfb: FALLBACK_TTFB_MS, fallback: true },
    { url: pair.primary },
  ];
}

function cappedConfig(config, ttfb) {
  if (!ttfb) return config;
  const policy = config.loadPolicy || {};
  const current = policy.maxTimeToFirstByteMs;
  return {
    ...config,
    loadPolicy: {
      ...policy,
      maxTimeToFirstByteMs: Number.isFinite(current) ? Math.min(current, ttfb) : ttfb,
      timeoutRetry: null,
      errorRetry: null,
    },
  };
}

// hls.js loader. hls.js reads `loader.stats` once when a load starts and keeps
// watching that object (ABR measures progress on it), so every try shares it.
export class GatewayFallbackLoader {
  constructor(hlsConfig) {
    this.hlsConfig = hlsConfig;
    const Base = GatewayFallbackLoader.Base || Hls.DefaultConfig.loader;
    this.Base = Base;
    this.inner = new Base(hlsConfig);
    this.stats = this.inner.stats;
    this.context = null;
  }

  load(context, config, callbacks) {
    this.context = context;
    const plan = attemptPlan(context.url);
    // Progressive (streamed) fragments hand partial data to hls.js as it
    // arrives; switching gateways mid-stream would mix two responses.
    if (!plan || callbacks.onProgress) {
      this.inner.load(context, config, callbacks);
      return;
    }
    this.tryStep(plan, 0, context, config, callbacks);
  }

  tryStep(plan, i, context, config, callbacks) {
    const step = plan[i];
    const last = i === plan.length - 1;
    const startedAt = this.stats.loading.start;
    if (i > 0) {
      // A loader runs once; the next try gets a fresh one on the same stats.
      this.inner.destroy();
      this.inner = new this.Base(this.hlsConfig);
      this.inner.stats = this.stats;
      this.stats.loading.start = 0;
    }
    const next = () => this.tryStep(plan, i + 1, context, config, callbacks);
    const tryContext = step.url === context.url ? context : { ...context, url: step.url };
    this.inner.load(tryContext, cappedConfig(config, step.ttfb), {
      onSuccess: (response, _stats, _ctx, details) => {
        const pair = gatewayPair(context.url);
        if (step.fallback && pair) preferFallback.add(pair.cid);
        callbacks.onSuccess(response, this.stats, context, details);
      },
      onError: (error, _ctx, details) => {
        if (last) callbacks.onError(error, context, details, this.stats);
        else next();
      },
      onTimeout: (_stats, _ctx, details) => {
        if (last) callbacks.onTimeout(this.stats, context, details);
        else next();
      },
      onAbort: callbacks.onAbort
        ? (_stats, _ctx, details) => callbacks.onAbort(this.stats, context, details)
        : undefined,
    });
    // Keep the request's real start, so hls.js times the whole load, not one try.
    if (i > 0 && startedAt) this.stats.loading.start = startedAt;
  }

  abort() { this.inner.abort(); }

  destroy() { this.inner.destroy(); this.context = null; }

  getCacheAge() { return this.inner.getCacheAge ? this.inner.getCacheAge() : null; }

  getResponseHeader(name) {
    return this.inner.getResponseHeader ? this.inner.getResponseHeader(name) : null;
  }
}

// hlsConfig for the 3Speak SDK player (or new Hls) with the fallback loader.
// A loader the caller sets on purpose still wins.
export const withGatewayFallback = (hlsConfig = {}) => ({
  loader: GatewayFallbackLoader,
  ...hlsConfig,
});
