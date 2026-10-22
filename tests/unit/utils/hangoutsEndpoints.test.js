// OpenPods server routing (src/utils/hangoutsEndpoints.js): new sessions go to
// the least-loaded server, joining a room goes to the one server that has it.
import { describe, it, expect, vi } from 'vitest'

async function load(env = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('../../../src/utils/hangoutsEndpoints.js')
}

const TWO = 'https://a.example/|wss://lk-a.example, https://b.example|wss://lk-b.example'
const A = { api: 'https://a.example', lk: 'wss://lk-a.example' }
const B = { api: 'https://b.example', lk: 'wss://lk-b.example' }

const routes = (table) => vi.fn((url) => {
  const r = table[url]
  if (r instanceof Error) return Promise.reject(r)
  if (r === undefined) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
  return Promise.resolve({ ok: true, json: async () => r })
})

describe('getHangoutsEndpoints', () => {
  it('reads api|livekit pairs in order, trimming slashes and spaces', async () => {
    const m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(m.getHangoutsEndpoints()).toEqual([A, B])
    expect(m.defaultEndpoint()).toEqual(A)
  })

  it('gives a pair without a livekit url the default livekit', async () => {
    const m = await load({ VITE_HANGOUTS_API_URLS: 'https://a.example,,  |wss://x' })
    expect(m.getHangoutsEndpoints()).toEqual([{ api: 'https://a.example', lk: 'wss://livekit.3speak.tv' }])
  })

  it('falls back to the single api and livekit variables', async () => {
    const m = await load({ VITE_HANGOUTS_API_URL: 'https://one.example/', VITE_LIVEKIT_URL: 'wss://lk.example' })
    expect(m.getHangoutsEndpoints()).toEqual([{ api: 'https://one.example', lk: 'wss://lk.example' }])
  })

  it('is empty with nothing configured, and the default is then blank', async () => {
    const m = await load()
    expect(m.getHangoutsEndpoints()).toEqual([])
    expect(m.defaultEndpoint()).toEqual({ api: '', lk: 'wss://livekit.3speak.tv' })
  })
})

describe('pickLeastLoadedEndpoint', () => {
  it('does not probe with a single server', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const m = await load({ VITE_HANGOUTS_API_URLS: 'https://a.example|wss://lk-a.example' })
    expect(await m.pickLeastLoadedEndpoint()).toEqual(A)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('picks the server with the fewest sessions, then the fewest viewers', async () => {
    vi.stubGlobal('fetch', routes({
      'https://a.example/health': { ok: true, sessions: { total: 2 }, viewers: 0 },
      'https://b.example/health': { ok: true, sessions: { total: 1 }, viewers: 50 },
    }))
    expect(await (await load({ VITE_HANGOUTS_API_URLS: TWO })).pickLeastLoadedEndpoint()).toEqual(B)

    vi.stubGlobal('fetch', routes({
      'https://a.example/health': { ok: true, sessions: { total: 1 }, viewers: 3 },
      'https://b.example/health': { ok: true, sessions: { total: 1 }, viewers: 9 },
    }))
    expect(await (await load({ VITE_HANGOUTS_API_URLS: TWO })).pickLeastLoadedEndpoint()).toEqual(A)
  })

  it('skips a server that is down or not healthy', async () => {
    vi.stubGlobal('fetch', routes({
      'https://a.example/health': { ok: false, sessions: { total: 0 } },
      'https://b.example/health': { ok: true, sessions: { total: 10 } },
    }))
    expect(await (await load({ VITE_HANGOUTS_API_URLS: TWO })).pickLeastLoadedEndpoint()).toEqual(B)
  })

  it('falls back to the first server when none answer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    expect(await (await load({ VITE_HANGOUTS_API_URLS: TWO })).pickLeastLoadedEndpoint()).toEqual(A)
  })

  it('remembers the pick for 30 seconds', async () => {
    vi.useFakeTimers()
    try {
      const fetch = routes({
        'https://a.example/health': { ok: true, sessions: { total: 5 } },
        'https://b.example/health': { ok: true, sessions: { total: 0 } },
      })
      vi.stubGlobal('fetch', fetch)
      const m = await load({ VITE_HANGOUTS_API_URLS: TWO })
      await m.pickLeastLoadedEndpoint()
      await m.pickLeastLoadedEndpoint()
      expect(fetch).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(30001)
      await m.pickLeastLoadedEndpoint()
      expect(fetch).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('findRoomEndpoint', () => {
  it('finds the server that hosts the room and caches it', async () => {
    const fetch = routes({ 'https://b.example/rooms/my%20room': { name: 'my room' } })
    vi.stubGlobal('fetch', fetch)
    const m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(await m.findRoomEndpoint('my room')).toEqual(B)
    expect(await m.findRoomEndpoint('my room')).toEqual(B)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns the default for an ended room without caching it', async () => {
    const fetch = routes({})
    vi.stubGlobal('fetch', fetch)
    const m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(await m.findRoomEndpoint('gone')).toEqual(A)
    await m.findRoomEndpoint('gone')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('returns the default without a room name', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(await m.findRoomEndpoint('')).toEqual(A)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('fetchAllEndpoints', () => {
  it('joins the lists from every server and tags each item with its server', async () => {
    vi.stubGlobal('fetch', routes({
      'https://a.example/live': [{ id: 1 }],
      'https://b.example/live': [{ id: 2 }, { id: 3 }],
    }))
    const m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(await m.fetchAllEndpoints('/live')).toEqual([
      { id: 1, _endpoint: A }, { id: 2, _endpoint: B }, { id: 3, _endpoint: B },
    ])
  })

  it('one dead server or a non-list reply does not empty the feed', async () => {
    vi.stubGlobal('fetch', routes({
      'https://a.example/live': new TypeError('offline'),
      'https://b.example/live': [{ id: 2 }],
    }))
    let m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(await m.fetchAllEndpoints('/live')).toEqual([{ id: 2, _endpoint: B }])

    vi.stubGlobal('fetch', routes({ 'https://a.example/live': { error: 'x' }, 'https://b.example/live': [] }))
    m = await load({ VITE_HANGOUTS_API_URLS: TWO })
    expect(await m.fetchAllEndpoints('/live')).toEqual([])
  })
})
