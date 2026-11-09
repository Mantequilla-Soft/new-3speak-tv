// Retrying a stalled IPFS playlist or segment on ipfs-audio.3speak.tv
// (src/lib/hlsGatewayFallback.js).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  GatewayFallbackLoader,
  gatewayPair,
  attemptPlan,
  withGatewayFallback,
  resetGatewayPreferences,
  FIRST_TRY_TTFB_MS,
  FALLBACK_TTFB_MS,
} from '../../../src/lib/hlsGatewayFallback.js'

const CID = 'QmSK7j5YJfzdKRcziM8wCzKeL4gggW4QJL9fy4GkWc7yKB'
const BCDN = `https://ipfs-3speak.b-cdn.net/ipfs/${CID}/480p/480p_2.ts`
const AUDIO = `https://ipfs-audio.3speak.tv/ipfs/${CID}/480p/480p_2.ts`

const newStats = () => ({
  aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
  loading: { start: 0, first: 0, end: 0 },
  parsing: { start: 0, end: 0 },
  buffering: { start: 0, first: 0, end: 0 },
})

// Stands in for hls.js's XhrLoader: answers each URL from `outcomes`
// ('ok' | 'error' | 'timeout', or a list of those taken in turn) and records what it was asked for.
let outcomes
let calls
class FakeLoader {
  constructor() { this.stats = newStats() }
  load(context, config, callbacks) {
    if (this.stats.loading.start) throw new Error('Loader can only be used once.')
    this.stats.loading.start = 100 + calls.length
    calls.push({ url: context.url, ttfb: config.loadPolicy.maxTimeToFirstByteMs, retry: config.loadPolicy.timeoutRetry })
    const planned = outcomes[context.url]
    const outcome = (Array.isArray(planned) ? planned.shift() : planned) || 'ok'
    if (outcome === 'ok') callbacks.onSuccess({ url: context.url, data: 'bytes', code: 200 }, this.stats, context, null)
    else if (outcome === 'error') callbacks.onError({ code: 502, text: 'Bad Gateway' }, context, null, this.stats)
    else callbacks.onTimeout(this.stats, context, null)
  }
  abort() {}
  destroy() {}
}

const policy = { maxTimeToFirstByteMs: 60000, maxLoadTimeMs: 60000, timeoutRetry: { maxNumRetry: 3 }, errorRetry: { maxNumRetry: 3 } }

function run(url) {
  const loader = new GatewayFallbackLoader({})
  const result = {}
  const context = { url, responseType: 'arraybuffer' }
  loader.load(context, { loadPolicy: policy, timeout: 60000 }, {
    onSuccess: (response, stats, ctx) => Object.assign(result, { ok: true, response, stats, ctx }),
    onError: (error, ctx, _d, stats) => Object.assign(result, { error, ctx, stats }),
    onTimeout: (stats, ctx) => Object.assign(result, { timeout: true, ctx, stats }),
  })
  return { loader, result, context }
}

beforeEach(() => {
  GatewayFallbackLoader.Base = FakeLoader
  outcomes = {}
  calls = []
  resetGatewayPreferences()
})
afterEach(() => { delete GatewayFallbackLoader.Base })

describe('gatewayPair', () => {
  it('maps our IPFS gateways to ipfs-audio, path and query kept', () => {
    expect(gatewayPair(BCDN)).toEqual({ cid: CID, primary: BCDN, fallback: AUDIO })
    expect(gatewayPair(`https://hotipfs-3speak-1.b-cdn.net/ipfs/${CID}/manifest.m3u8?x=1`).fallback)
      .toBe(`https://ipfs-audio.3speak.tv/ipfs/${CID}/manifest.m3u8?x=1`)
    expect(gatewayPair(`https://ipfs.3speak.tv/ipfs/${CID}/a.ts`).cid).toBe(CID)
  })

  it('leaves the /hls proxy, other hosts and ipfs-audio itself alone', () => {
    expect(gatewayPair('https://play.3speak.tv/hls?u=https%3A%2F%2Fipfs-3speak.b-cdn.net%2Fipfs%2FQm%2Fmanifest.m3u8')).toBeNull()
    expect(gatewayPair(AUDIO)).toBeNull()
    expect(gatewayPair('https://example.com/ipfs/Qm/a.ts')).toBeNull()
    expect(gatewayPair('not a url')).toBeNull()
  })
})

describe('attemptPlan', () => {
  it('short try, then the other gateway, then the full original', () => {
    expect(attemptPlan(BCDN)).toEqual([
      { url: BCDN, ttfb: FIRST_TRY_TTFB_MS },
      { url: AUDIO, ttfb: FALLBACK_TTFB_MS, fallback: true },
      { url: BCDN },
    ])
  })
})

describe('GatewayFallbackLoader', () => {
  it('a healthy gateway is asked once, with the short first-byte limit', () => {
    const { result } = run(BCDN)
    expect(result.ok).toBe(true)
    expect(calls).toEqual([{ url: BCDN, ttfb: FIRST_TRY_TTFB_MS, retry: null }])
  })

  it('a silent CDN segment is fetched from ipfs-audio and reported under the asked context', () => {
    outcomes[BCDN] = 'timeout'
    const { result, context, loader } = run(BCDN)
    expect(calls.map(c => c.url)).toEqual([BCDN, AUDIO])
    expect(calls[1].ttfb).toBe(FALLBACK_TTFB_MS)
    expect(result.ok).toBe(true)
    expect(result.response.url).toBe(AUDIO)
    expect(result.ctx).toBe(context)
    // hls.js holds on to loader.stats from the start, so it must stay one object
    // and keep the request's first start time.
    expect(result.stats).toBe(loader.stats)
    expect(loader.stats.loading.start).toBe(100)
  })

  it('an error moves on at once, like a timeout', () => {
    outcomes[BCDN] = 'error'
    run(BCDN)
    expect(calls.map(c => c.url)).toEqual([BCDN, AUDIO])
  })

  it('once a CID loaded from ipfs-audio, its next files start there', () => {
    outcomes[BCDN] = 'timeout'
    run(BCDN)
    calls = []
    const next = `https://ipfs-3speak.b-cdn.net/ipfs/${CID}/480p/480p_3.ts`
    run(next)
    expect(calls.map(c => c.url)).toEqual([`https://ipfs-audio.3speak.tv/ipfs/${CID}/480p/480p_3.ts`])
  })

  it('falls back to the original with its full policy when ipfs-audio fails too', () => {
    outcomes[BCDN] = ['timeout', 'ok']
    outcomes[AUDIO] = 'error'
    const { result } = run(BCDN)
    expect(calls.map(c => c.url)).toEqual([BCDN, AUDIO, BCDN])
    expect(calls[2]).toEqual({ url: BCDN, ttfb: 60000, retry: policy.timeoutRetry })
    expect(result.ok).toBe(true)
  })

  it('reports the last failure when every try fails', () => {
    outcomes[BCDN] = 'timeout'
    outcomes[AUDIO] = 'timeout'
    const { result } = run(BCDN)
    expect(calls).toHaveLength(3)
    expect(result.timeout).toBe(true)
  })

  it('passes other addresses straight through, untouched', () => {
    const url = 'https://play.3speak.tv/hls?u=x'
    run(url)
    expect(calls).toEqual([{ url, ttfb: 60000, retry: policy.timeoutRetry }])
  })
})

describe('withGatewayFallback', () => {
  it('adds the loader and keeps the caller\'s settings (and their own loader)', () => {
    expect(withGatewayFallback({ maxBufferLength: 60 })).toEqual({ loader: GatewayFallbackLoader, maxBufferLength: 60 })
    expect(withGatewayFallback({ loader: FakeLoader }).loader).toBe(FakeLoader)
    expect(withGatewayFallback().loader).toBe(GatewayFallbackLoader)
  })
})
