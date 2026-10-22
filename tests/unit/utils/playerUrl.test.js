// Player backend pick with fallback (src/utils/playerUrl.js): probe the
// configured backends in order and pin the first that answers for the session.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PRIMARY = 'https://play.3speak.tv'
const BACKUP = 'https://backup.example'

async function load(urls) {
  vi.resetModules()
  vi.doMock('../../../src/utils/config', () => ({ PLAYER_URLS: urls }))
  return import('../../../src/utils/playerUrl.js')
}

const reply = (status) => Promise.resolve({ status })

beforeEach(() => {
  sessionStorage.clear()
})

describe('player backend selection', () => {
  it('starts on the primary and lists the candidates without repeats', async () => {
    const m = await load([PRIMARY, BACKUP, PRIMARY, ''])
    expect(m.getPlayerUrl()).toBe(PRIMARY)
    expect(m.getPlayerUrls()).toEqual([PRIMARY, BACKUP])
  })

  it('does not probe when there is only one backend', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const m = await load([PRIMARY])
    expect(await m.ensurePlayerUrl()).toBe(PRIMARY)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is empty when nothing is configured', async () => {
    const m = await load(undefined)
    expect(m.getPlayerUrl()).toBe('')
    expect(await m.ensurePlayerUrl()).toBe('')
  })

  it('keeps the primary when it answers, even with a 404', async () => {
    const fetch = vi.fn(() => reply(404))
    vi.stubGlobal('fetch', fetch)
    const m = await load([PRIMARY, BACKUP])
    expect(await m.ensurePlayerUrl()).toBe(PRIMARY)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(`${PRIMARY}/api/embed?v=health/probe`)
    expect(sessionStorage.getItem('player-backend')).toBe(PRIMARY)
  })

  it('falls back to the next backend when the primary 502s, and pins it', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => reply(url.startsWith(PRIMARY) ? 502 : 200)))
    const m = await load([PRIMARY, BACKUP])
    expect(await m.ensurePlayerUrl()).toBe(BACKUP)
    expect(m.getPlayerUrl()).toBe(BACKUP)
    expect(sessionStorage.getItem('player-backend')).toBe(BACKUP)
  })

  it('treats a network error as down', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (url.startsWith(PRIMARY) ? Promise.reject(new TypeError('Failed to fetch')) : reply(200))))
    const m = await load([PRIMARY, BACKUP])
    expect(await m.ensurePlayerUrl()).toBe(BACKUP)
  })

  it('gives up on a backend that does not answer within two seconds', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((url, { signal }) => (url.startsWith(PRIMARY)
        ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
        : reply(200))))
      const m = await load([PRIMARY, BACKUP])
      const p = m.ensurePlayerUrl()
      await vi.advanceTimersByTimeAsync(2000)
      expect(await p).toBe(BACKUP)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the primary when every backend is down', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(503)))
    const m = await load([PRIMARY, BACKUP])
    expect(await m.ensurePlayerUrl()).toBe(PRIMARY)
    expect(sessionStorage.getItem('player-backend')).toBeNull()
  })

  it('probes only once however often it is asked', async () => {
    const fetch = vi.fn(() => reply(200))
    vi.stubGlobal('fetch', fetch)
    const m = await load([PRIMARY, BACKUP])
    const [a, b] = await Promise.all([m.ensurePlayerUrl(), m.ensurePlayerUrl()])
    await m.ensurePlayerUrl()
    expect(a).toBe(PRIMARY)
    expect(b).toBe(PRIMARY)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the session pin without probing', async () => {
    sessionStorage.setItem('player-backend', BACKUP)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const m = await load([PRIMARY, BACKUP])
    expect(m.getPlayerUrl()).toBe(BACKUP)
    expect(await m.ensurePlayerUrl()).toBe(BACKUP)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores a session pin that is no longer configured', async () => {
    sessionStorage.setItem('player-backend', 'https://retired.example')
    vi.stubGlobal('fetch', vi.fn(() => reply(200)))
    const m = await load([PRIMARY, BACKUP])
    expect(m.getPlayerUrl()).toBe(PRIMARY)
    expect(await m.ensurePlayerUrl()).toBe(PRIMARY)
    expect(sessionStorage.getItem('player-backend')).toBe(PRIMARY)
  })
})
