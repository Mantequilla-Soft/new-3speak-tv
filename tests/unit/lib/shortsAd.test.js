// Spots between shorts: cadence counted in shorts watched, the request shape,
// and the played-seconds report that bills them (src/lib/shortsAd.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const adBreak = vi.hoisted(() => ({ rememberAdSeen: vi.fn(), recentAdKeys: vi.fn(() => ['k1']) }))
vi.mock('../../../src/lib/adBreak', () => adBreak)

const SID = 'abcdefabcdefabcdefabcdefabcdef12'

let m
beforeEach(async () => {
  vi.resetModules()
  adBreak.rememberAdSeen.mockReset()
  m = await import('../../../src/lib/shortsAd.js')
})

describe('shorts cadence', () => {
  it('counts shorts watched and resets', () => {
    expect(m.shortsSinceAd()).toBe(0)
    m.countShortWatched()
    m.countShortWatched()
    expect(m.shortsSinceAd()).toBe(2)
    m.resetShortsAdCount()
    expect(m.shortsSinceAd()).toBe(0)
  })
})

describe('requestShortsAd', () => {
  it('sends the finished short, the viewer, the count and recent ad keys', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    m.countShortWatched()
    m.countShortWatched()
    m.countShortWatched()
    expect(await m.requestShortsAd({ owner: 'alice', permlink: 's1', viewer: 'bob' })).toBeNull()
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('https://checker.3speak.tv/m/session')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({
      surface: 'shorts', owner: 'alice', permlink: 's1', viewer: 'bob', shortsWatched: 3, recentAdKeys: ['k1'],
    })
  })

  it('a "not yet" answer keeps counting; a served spot resets the count and is remembered', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ shortsAd: null }) })
    vi.stubGlobal('fetch', f)
    m.countShortWatched()
    await m.requestShortsAd({})
    expect(m.shortsSinceAd()).toBe(1)

    const spot = { manifestUrl: `https://c/m/${SID}/short.m3u8`, adKey: 'ad-9' }
    f.mockResolvedValueOnce({ ok: true, json: async () => ({ shortsAd: spot }) })
    expect(await m.requestShortsAd({})).toEqual(spot)
    expect(m.shortsSinceAd()).toBe(0)
    expect(adBreak.rememberAdSeen).toHaveBeenCalledWith('ad-9')
  })

  it('missing fields are sent as null', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    await m.requestShortsAd({})
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ owner: null, permlink: null, viewer: null })
  })

  it('every failure is "no ad" and keeps the count', async () => {
    m.countShortWatched()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await m.requestShortsAd({})).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ shortsAd: { adKey: 'x' } }) }))
    expect(await m.requestShortsAd({})).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await m.requestShortsAd({})).toBeNull()
    expect(m.shortsSinceAd()).toBe(1)
    expect(adBreak.rememberAdSeen).not.toHaveBeenCalled()
  })
})

describe('reportShortsWatched', () => {
  it('reports played seconds to /m/<sid>/w with keepalive', () => {
    const f = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', f)
    m.reportShortsWatched(`https://c/m/${SID}/short.m3u8`, 12.5)
    expect(f.mock.calls[0][0]).toBe(`https://checker.3speak.tv/m/${SID}/w`)
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true })
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ seconds: 12.5 })
  })

  it('sends nothing for zero seconds or a URL without a session id', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    m.reportShortsWatched(`https://c/m/${SID}/short.m3u8`, 0)
    m.reportShortsWatched(`https://c/m/${SID}/short.m3u8`, NaN)
    m.reportShortsWatched(`https://c/m/${SID}/gate.m3u8`, 5)
    m.reportShortsWatched(null, 5)
    expect(f).not.toHaveBeenCalled()
  })
})
