// Embed-upload server pick (src/utils/embedEndpoints.js): least-busy reachable
// primary host, the fallback tier only when no primary answers, and never a
// blocked upload.
import { describe, it, expect, vi, afterEach } from 'vitest'

async function load({ hosts = [], fallback = [], api = 'https://embed2.3speak.tv/' } = {}) {
  vi.resetModules()
  vi.doMock('../../../src/utils/config', () => ({
    EMBED_UPLOAD_HOSTS: hosts, EMBED_UPLOAD_FALLBACK_HOSTS: fallback, EMBED_API_URL: api,
  }))
  return import('../../../src/utils/embedEndpoints.js')
}

const health = (byHost) => vi.fn((url) => {
  const base = url.replace(/\/health$/, '')
  const r = byHost[base]
  if (r instanceof Error) return Promise.reject(r)
  if (!r) return Promise.resolve({ ok: false, status: 502, json: async () => ({}) })
  return Promise.resolve({ ok: true, status: 200, json: async () => (r === 'not-json' ? JSON.parse('<html>') : r) })
})

afterEach(() => vi.doUnmock('../../../src/utils/config'))

describe('getEmbedHosts', () => {
  it('uses the configured pool, or the single API host without a trailing slash', async () => {
    expect((await load({ hosts: ['https://a', 'https://b'] })).getEmbedHosts()).toEqual(['https://a', 'https://b'])
    expect((await load({ api: 'https://embed2.3speak.tv///' })).getEmbedHosts()).toEqual(['https://embed2.3speak.tv'])
    expect((await load({ api: '' })).getEmbedHosts()).toEqual([])
  })
})

describe('pickEmbedEndpoint', () => {
  it('does not probe with a single host and no fallback tier', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const m = await load()
    expect(await m.pickEmbedEndpoint()).toEqual({ base: 'https://embed2.3speak.tv', uploadUrl: 'https://embed2.3speak.tv/uploads' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('picks the host with the fewest active uploads', async () => {
    vi.stubGlobal('fetch', health({ 'https://a': { activeUploads: 3 }, 'https://b': { activeUploads: 1 } }))
    const m = await load({ hosts: ['https://a', 'https://b'] })
    expect(await m.pickEmbedEndpoint()).toEqual({ base: 'https://b', uploadUrl: 'https://b/uploads' })
  })

  it('spreads uploads across hosts that are equally free', async () => {
    vi.stubGlobal('fetch', health({ 'https://a': { activeUploads: 0 }, 'https://b': { activeUploads: 0 }, 'https://c': { activeUploads: 2 } }))
    const m = await load({ hosts: ['https://a', 'https://b', 'https://c'] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect((await m.pickEmbedEndpoint()).base).toBe('https://a')
    Math.random.mockReturnValue(0.99)
    expect((await m.pickEmbedEndpoint()).base).toBe('https://b')
  })

  it('lets a healthy host that reports no load take part', async () => {
    vi.stubGlobal('fetch', health({ 'https://a': { activeUploads: 5 }, 'https://b': { status: 'ok' } }))
    const m = await load({ hosts: ['https://a', 'https://b'] })
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    expect((await m.pickEmbedEndpoint()).base).toBe('https://b')
  })

  it('skips a host with almost no free disk, and one that is down', async () => {
    vi.stubGlobal('fetch', health({ 'https://a': { activeUploads: 0, freeDiskPct: 2 }, 'https://b': new Error('down'), 'https://c': { activeUploads: 9, freeDiskPct: 50 } }))
    const m = await load({ hosts: ['https://a', 'https://b', 'https://c'] })
    expect((await m.pickEmbedEndpoint()).base).toBe('https://c')
  })

  it('accepts a health reply that is not json', async () => {
    vi.stubGlobal('fetch', health({ 'https://b': 'not-json' }))
    const m = await load({ hosts: ['https://a', 'https://b'] })
    expect((await m.pickEmbedEndpoint()).base).toBe('https://b')
  })

  it('uses the fallback tier only when no primary answers', async () => {
    const fetch = health({ 'https://a': { activeUploads: 7 }, 'https://legacy': { activeUploads: 0 } })
    vi.stubGlobal('fetch', fetch)
    let m = await load({ hosts: ['https://a', 'https://b'], fallback: ['https://legacy'] })
    expect((await m.pickEmbedEndpoint()).base).toBe('https://a')
    expect(fetch.mock.calls.map((c) => c[0])).not.toContain('https://legacy/health')

    vi.stubGlobal('fetch', health({ 'https://legacy': { status: 'ok' } }))
    m = await load({ hosts: ['https://a', 'https://b'], fallback: ['https://legacy'] })
    expect(await m.pickEmbedEndpoint()).toEqual({ base: 'https://legacy', uploadUrl: 'https://legacy/uploads' })
  })

  it('falls back to the first configured host when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const m = await load({ hosts: ['https://a', 'https://b'], fallback: ['https://legacy'] })
    expect(await m.pickEmbedEndpoint()).toEqual({ base: 'https://a', uploadUrl: 'https://a/uploads' })
  })
})
