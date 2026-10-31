// The CORS probe of the audio effects (src/components/GlobalAudioPlayer/audioEffects.js):
// one request per unknown host, cancelled after the headers, the answer cached.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { canRoute, markNoCors } from '../../../src/components/GlobalAudioPlayer/audioEffects.js'
import { CORS_CACHE_KEY } from '../../../src/components/GlobalAudioPlayer/playerMath.js'

const cached = () => JSON.parse(localStorage.getItem(CORS_CACHE_KEY) || '{}')

beforeEach(() => { localStorage.clear() })

describe('canRoute', () => {
  it('asks an unknown host once, in CORS mode, and remembers a yes', async () => {
    const fetchMock = vi.fn(async () => ({ type: 'cors', status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([
      canRoute('https://cdn.pod.test/ep1.mp3'),
      canRoute('https://cdn.pod.test/ep2.mp3'),
    ])
    expect([a, b]).toEqual([true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ mode: 'cors', credentials: 'omit' })
    expect(cached()['cdn.pod.test'].ok).toBe(true)
    // Known now: no second request.
    expect(await canRoute('https://cdn.pod.test/ep3.mp3')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a refused request (no CORS) is a remembered no', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await canRoute('https://nocors.test/ep.mp3')).toBe(false)
    expect(cached()['nocors.test'].ok).toBe(false)
  })

  it('an error status is a no too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'cors', status: 403 })))
    expect(await canRoute('https://forbidden.test/ep.mp3')).toBe(false)
    expect(cached()['forbidden.test'].ok).toBe(false)
  })

  it('never asks about our own gateways or blob URLs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await canRoute('https://ipfs-audio.3speak.tv/ipfs/Qm1')).toBe(true)
    expect(await canRoute('blob:http://localhost/1')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a host that failed on the routed element is marked', () => {
    markNoCors('https://flaky.test/a.mp3')
    expect(cached()['flaky.test'].ok).toBe(false)
  })
})
