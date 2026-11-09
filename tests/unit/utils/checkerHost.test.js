// Checker instance selection: race the instances, route checker calls to the
// fastest, fail over on network errors (src/utils/checkerHost.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const EU = 'https://checker.3speak.tv'
const US = 'https://checker-us.3speak.tv'

vi.mock('../../../src/utils/config', () => ({
  CHECKER_URL: 'https://checker.3speak.tv',
  CHECKER_URLS: ['https://checker.3speak.tv', 'https://checker-us.3speak.tv/'],
}))

function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

// Answers /health/latency per origin; anything else returns `other`.
function latencyFetch(byOrigin, other = json({})) {
  return vi.fn(async (url) => {
    const u = String(url)
    for (const [origin, r] of Object.entries(byOrigin)) {
      if (u === `${origin}/health/latency`) {
        if (r instanceof Error) throw r
        if (r.delay) await new Promise((res) => setTimeout(res, r.delay))
        return json(r.body, r.status || 200)
      }
    }
    return other
  })
}

let mod
async function load({ stored } = {}) {
  vi.resetModules()
  const ls = memoryStorage()
  if (stored) ls.setItem('checker-host.v2', JSON.stringify(stored))
  vi.stubGlobal('localStorage', ls)
  mod = await import('../../../src/utils/checkerHost.js')
  return { ls }
}

beforeEach(() => { vi.useRealTimers() })
afterEach(() => { vi.unstubAllGlobals() })

describe('candidates', () => {
  it('is the primary plus VITE_CHECKER_URLS, as de-duplicated origins', async () => {
    await load()
    expect(mod._test.CANDIDATES).toEqual([EU, US])
  })
})

describe('rewriteCheckerUrl', () => {
  it('leaves URLs alone while the primary is the pick', async () => {
    await load()
    expect(mod.rewriteCheckerUrl(`${EU}/feeds/new?limit=5`)).toBe(`${EU}/feeds/new?limit=5`)
  })

  it('swaps only the origin of primary checker URLs once another instance wins', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    expect(mod.getCheckerOrigin()).toBe(US)
    expect(mod.rewriteCheckerUrl(`${EU}/feeds/new?limit=5`)).toBe(`${US}/feeds/new?limit=5`)
    expect(mod.rewriteCheckerUrl(EU)).toBe(US)
    expect(mod.rewriteCheckerUrl(`${EU}?x=1`)).toBe(`${US}?x=1`)
  })

  it('never touches other hosts, look-alikes or relative URLs', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    for (const u of [
      'https://api.hive.blog/', 'https://checker.3speak.tv.evil.example/x',
      'https://checker.3speak.tvx/x', 'http://checker.3speak.tv/x', '/api/feed', undefined,
    ]) expect(mod.rewriteCheckerUrl(u)).toBe(u)
  })

  it('ignores a stale or foreign stored pick', async () => {
    await load({ stored: { ranking: [US], at: Date.now() - 7 * 60 * 60 * 1000 } })
    expect(mod.getCheckerOrigin()).toBe(EU)
    await load({ stored: { ranking: ['https://evil.example'], at: Date.now() } })
    expect(mod.getCheckerOrigin()).toBe(EU)
  })
})

describe('rankProbes', () => {
  it('weighs the instance Mongo trip: near the viewer but far from Mongo loses', async () => {
    await load()
    // Helsinki: 40 ms to the viewer, 270 ms to Mongo. US: 120 ms away, 2 ms to Mongo.
    expect(mod.rankProbes([
      { origin: EU, ok: true, ms: 40 + 270, dbMs: 270 },
      { origin: US, ok: true, ms: 120 + 2, dbMs: 2 },
    ])).toEqual([US, EU])
  })

  it('keeps the primary when the other is not clearly faster', async () => {
    await load()
    expect(mod.rankProbes([
      { origin: EU, ok: true, ms: 110, dbMs: 0 },
      { origin: US, ok: true, ms: 100, dbMs: 0 },
    ])).toEqual([EU, US])
  })

  it('drops failed probes but always keeps the primary as the last resort', async () => {
    await load()
    expect(mod.rankProbes([{ origin: EU, ok: false }, { origin: US, ok: true, ms: 90, dbMs: 1 }])).toEqual([US, EU])
  })
})

describe('ensureCheckerHost', () => {
  it('races /health/latency on every instance, stores and applies the winner', async () => {
    const { ls } = await load()
    const f = latencyFetch({
      [EU]: { body: { ok: true, db_ms: 270 } },
      [US]: { body: { ok: true, db_ms: 2 } },
    })
    mod._test.reset({ fetchImpl: f })
    expect(await mod.ensureCheckerHost()).toBe(US)
    const probed = f.mock.calls.map((c) => c[0])
    expect(probed).toContain(`${EU}/health/latency`)
    expect(probed).toContain(`${US}/health/latency`)
    expect(f.mock.calls[0][1].cache).toBe('no-store')
    expect(JSON.parse(ls.getItem('checker-host.v2')).ranking).toEqual([US, EU])
  })

  it('a down instance is not picked', async () => {
    await load()
    mod._test.reset({ fetchImpl: latencyFetch({
      [EU]: { body: { ok: true, db_ms: 270 } },
      [US]: new TypeError('Failed to fetch'),
    }) })
    expect(await mod.ensureCheckerHost()).toBe(EU)
  })

  it('a host that is not a checker (404, login page, odd JSON) is never picked', async () => {
    for (const us of [
      { status: 404, body: null },
      { body: { message: 'hello' } },
      { body: { ok: true } },
      { body: { ok: 'yes', db_ms: 1 } },
    ]) {
      await load()
      mod._test.reset({ fetchImpl: latencyFetch({ [EU]: { body: { ok: true, db_ms: 270 } }, [US]: us }) })
      expect(await mod.ensureCheckerHost()).toBe(EU)
    }
  })

  it('an instance whose database is gone (503) is not picked', async () => {
    await load()
    mod._test.reset({ fetchImpl: latencyFetch({
      [EU]: { body: { ok: true, db_ms: 270 } },
      [US]: { status: 503, body: { ok: false } },
    }) })
    expect(await mod.ensureCheckerHost()).toBe(EU)
  })

  it('stores nothing when every probe fails (offline), so the next load races again', async () => {
    const { ls } = await load()
    mod._test.reset({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')) })
    expect(await mod.ensureCheckerHost()).toBe(EU)
    expect(ls.getItem('checker-host.v2')).toBeNull()
  })

  it('does not race again while a fresh pick is stored', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const f = vi.fn()
    mod._test.reset({ fetchImpl: f })
    expect(await mod.ensureCheckerHost()).toBe(US)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('installCheckerRouting', () => {
  it('fetch goes to the pick; a network error benches it and a GET is retried on the next', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const calls = []
    const native = vi.fn(async (url) => {
      calls.push(String(url))
      if (String(url).startsWith(US)) throw new TypeError('Failed to fetch')
      return json({ ok: 1 })
    })
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    const res = await fetch(`${EU}/feeds/new`)
    expect(await res.json()).toEqual({ ok: 1 })
    expect(calls).toEqual([`${US}/feeds/new`, `${EU}/feeds/new`])
    expect(mod.getCheckerOrigin()).toBe(EU) // benched
  })

  it('a Cloudflare "origin down" answer (522) benches the instance and a GET is retried', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const calls = []
    const native = vi.fn(async (url) => {
      calls.push(String(url))
      return String(url).startsWith(US) ? json({}, 522) : json({ ok: 1 })
    })
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    const res = await fetch(`${EU}/feeds/new`)
    expect(res.status).toBe(200)
    expect(calls).toEqual([`${US}/feeds/new`, `${EU}/feeds/new`])
    expect(mod.getCheckerOrigin()).toBe(EU)
  })

  it('a POST that gets a gateway failure is benched but answered as is, not retried', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const native = vi.fn().mockResolvedValue(json({}, 521))
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    const res = await fetch(`${EU}/views`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(521)
    expect(native).toHaveBeenCalledTimes(1)
    expect(mod.getCheckerOrigin()).toBe(EU)
  })

  it('an ordinary error answer (404, 500) is the checker speaking: no bench, no retry', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const native = vi.fn().mockResolvedValue(json({}, 404))
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    expect((await fetch(`${EU}/video/x`)).status).toBe(404)
    expect(native).toHaveBeenCalledTimes(1)
    expect(mod.getCheckerOrigin()).toBe(US)
  })

  it('a POST is not retried (it may have reached the server)', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const native = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    await expect(fetch(`${EU}/views`, { method: 'POST', body: '{}' })).rejects.toThrow('Failed to fetch')
    expect(native).toHaveBeenCalledTimes(1)
  })

  it('an aborted request does not bench the instance', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const native = vi.fn().mockRejectedValue(abort)
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    await expect(fetch(`${EU}/feeds/new`)).rejects.toBe(abort)
    expect(mod.getCheckerOrigin()).toBe(US)
  })

  it('other hosts pass through untouched', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const native = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', native)
    mod._test.reset({ fetchImpl: native })
    mod.installCheckerRouting()
    const init = { headers: { a: 'b' } }
    await fetch('https://api.hive.blog/', init)
    expect(native).toHaveBeenCalledWith('https://api.hive.blog/', init)
  })

  it('XHR and sendBeacon follow the pick too', async () => {
    await load({ stored: { ranking: [US, EU], at: Date.now() } })
    const opened = []
    class FakeXHR {
      open(method, url) { opened.push(url) }
      addEventListener() {}
    }
    const beacons = []
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    vi.stubGlobal('navigator', { sendBeacon: (url) => { beacons.push(url); return true } })
    mod._test.reset({ fetchImpl: vi.fn() })
    mod.installCheckerRouting()
    new XMLHttpRequest().open('GET', `${EU}/m/abc/1.ts`)
    new XMLHttpRequest().open('GET', 'https://other.example/x')
    navigator.sendBeacon(`${EU}/client-errors`, 'x')
    expect(opened).toEqual([`${US}/m/abc/1.ts`, 'https://other.example/x'])
    expect(beacons).toEqual([`${US}/client-errors`])
  })
})
