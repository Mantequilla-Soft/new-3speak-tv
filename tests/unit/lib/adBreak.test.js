// Client half of server-side ad insertion on the watch page: the session request,
// player time <-> content time, countdown and seek lock, skip, billing beats of
// what actually played, banner and ticker windows, and the recently-seen ad list
// (src/lib/adBreak.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createAdBreak,
  recentAdKeys,
  rememberAdSeen,
  rememberAdSeenFor,
  adCapId,
  AD_COUNTDOWN_FROM,
  AD_BILLABLE_SECONDS,
} from '../../../src/lib/adBreak.js'

const SID = '0123456789abcdef0123456789abcdef'
const BANNER_SID = 'fedcba9876543210fedcba9876543210'
const BASE = 'https://checker.3speak.tv'
const VIDEO = { owner: 'alice', permlink: 'vid', viewer: 'bob', manifestUrl: 'https://cdn/x/manifest.m3u8' }

const ok = (body) => ({ ok: true, json: async () => body })

// Routes fetch by URL: /m/session answers `session`, /m/<sid>/i answers `info`,
// every other POST is recorded and answered {}.
function stubChecker({ session = {}, info = {} } = {}) {
  const f = vi.fn(async (url) => {
    if (url === `${BASE}/m/session`) return ok(session)
    if (/\/m\/[0-9a-f]{32}\/i$/.test(url)) return ok(info)
    return ok({})
  })
  vi.stubGlobal('fetch', f)
  return f
}
const posts = (f, suffix) => f.mock.calls.filter(([u]) => u.endsWith(suffix))

// A resolved mid-roll at 60s lasting 15s, with optional skip threshold.
async function midRoll(extra = {}, info = {}) {
  const f = stubChecker({
    session: { ad: { manifestUrl: `${BASE}/m/${SID}.m3u8`, position: 'mid', durationSeconds: 15, adKey: 'ad-1', ...extra } },
    info: { adStartAt: 60, adDurationSeconds: 15, ...info },
  })
  const ab = createAdBreak()
  await ab.request(VIDEO)
  await ab.resolve()
  return { ab, f }
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('recently seen ads', () => {
  it('remembers ad keys for 15 minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    rememberAdSeen('a', ['b', 'c'], '', null, 5)
    expect(recentAdKeys().sort()).toEqual(['a', 'b', 'c'])
    vi.advanceTimersByTime(15 * 60 * 1000 - 1)
    expect(recentAdKeys()).toHaveLength(3)
    vi.advanceTimersByTime(2)
    expect(recentAdKeys()).toEqual([])
  })

  it('rememberAdSeenFor keeps an entry for a shorter time (the ticker)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    rememberAdSeenFor(5, 'ticker-1')
    rememberAdSeenFor(30, 'long')
    rememberAdSeenFor(0, 'zero')
    vi.advanceTimersByTime(5 * 60 * 1000 - 1000)
    expect(recentAdKeys().sort()).toEqual(['long', 'ticker-1', 'zero'])
    vi.advanceTimersByTime(2000)
    expect(recentAdKeys().sort()).toEqual(['long', 'zero'])
  })

  it('survives corrupt storage and storage that throws', () => {
    localStorage.setItem('3speak-ads-seen', 'not json')
    expect(recentAdKeys()).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => rememberAdSeen('x')).not.toThrow()
    expect(() => rememberAdSeenFor(5, 'y')).not.toThrow()
  })
})

describe('adCapId', () => {
  it('is a per-page-load random 24-hex id that stays the same within the page', () => {
    expect(adCapId()).toMatch(/^[0-9a-f]{24}$/)
    expect(adCapId()).toBe(adCapId())
  })
})

describe('request', () => {
  it('asks nothing without owner, permlink and manifest', async () => {
    const f = stubChecker()
    const ab = createAdBreak()
    expect(await ab.request({ owner: 'a', permlink: '', manifestUrl: 'm' })).toBeNull()
    expect(await ab.request({ owner: 'a', permlink: 'p' })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('sends the video, viewer, cap id and recently seen ads, asking for a drawn banner', async () => {
    rememberAdSeen('seen-1')
    const f = stubChecker()
    await createAdBreak().request({ ...VIDEO, ticker: true })
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe(`${BASE}/m/session`)
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({
      owner: 'alice', permlink: 'vid', viewer: 'bob', manifestUrl: VIDEO.manifestUrl,
      capId: adCapId(), recentAdKeys: ['seen-1'], bannerOverlay: true, ticker: true,
    })
  })

  it('an anonymous viewer is sent as null and tickers are not requested by default', async () => {
    const f = stubChecker()
    await createAdBreak().request({ ...VIDEO, viewer: '' })
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ viewer: null, ticker: false })
  })

  it('returns the spot session with defaults filled in', async () => {
    stubChecker({ session: { ad: { manifestUrl: `${BASE}/m/${SID}.m3u8`, position: 'pre', durationSeconds: 10 } } })
    const ab = createAdBreak()
    const s = await ab.request(VIDEO)
    expect(s).toEqual({ sid: SID, manifestUrl: `${BASE}/m/${SID}.m3u8`, position: 'pre', durationSeconds: 10, label: 'Sponsored', advertiser: null, brand: null, adKey: null })
    expect(ab.active).toBe(true)
    expect(ab.resolved).toBe(false)
  })

  it('a spot whose manifest carries no session id is no ad', async () => {
    stubChecker({ session: { ad: { manifestUrl: `${BASE}/m/nothex.m3u8` } } })
    const ab = createAdBreak()
    expect(await ab.request(VIDEO)).toBeNull()
    expect(ab.active).toBe(false)
  })

  it('a banner without a spot is played from the banner manifest', async () => {
    stubChecker({ session: { banner: { manifestUrl: `${BASE}/m/${BANNER_SID}.m3u8`, positionPercent: 20, durationSeconds: 8, adKey: 'b-1', overlay: { image: 'x.png' } } } })
    const ab = createAdBreak()
    expect(await ab.request(VIDEO)).toEqual({ bannerOnly: true, manifestUrl: `${BASE}/m/${BANNER_SID}.m3u8` })
    expect(ab.bannerInfo).toMatchObject({ adKey: 'b-1', advertiser: null, placement: null })
    expect(ab.bannerOverlay).toEqual({ image: 'x.png' })
  })

  it('flags a Pro viewer\'s ad-free playback', async () => {
    stubChecker({ session: { premium: true } })
    const ab = createAdBreak()
    expect(await ab.request(VIDEO)).toBeNull()
    expect(ab.isPremiumViewer).toBe(true)
  })

  it('keeps a ticker only with a message and a positive duration, normalising its fields', async () => {
    stubChecker({ session: { ticker: { message: 'Buy now', durationSeconds: '12', positionPercent: 'x', style: 'weird', capMinutes: '5' } } })
    const ab = createAdBreak()
    expect(await ab.request(VIDEO)).toBeNull()
    expect(ab.tickerInfo).toMatchObject({ message: 'Buy now', durationSeconds: 12, positionPercent: 0, style: 'crawl', label: 'Ad', capMinutes: 5, clickUrl: null })

    stubChecker({ session: { ticker: { message: 'x', durationSeconds: 0 } } })
    await ab.request(VIDEO)
    expect(ab.tickerInfo).toBeNull()
  })

  it('every failure is no ad', async () => {
    const ab = createAdBreak()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await ab.request(VIDEO)).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await ab.request(VIDEO)).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('x') } }))
    expect(await ab.request(VIDEO)).toBeNull()
  })

  it('does not mark the chosen ad as seen before it is on screen', async () => {
    await midRoll()
    expect(recentAdKeys()).toEqual([])
  })
})

describe('resolve', () => {
  it('locates the break from /m/<sid>/i', async () => {
    const { ab, f } = await midRoll({}, { skipAfterSeconds: 5 })
    expect(ab.resolved).toBe(true)
    expect(ab.spotStart()).toBe(60)
    expect(ab.skipOffered).toBe(true)
    expect(f.mock.calls.some(([u]) => u === `${BASE}/m/${SID}/i`)).toBe(true)
  })

  it('retries while the cut is not known yet, then gives up with null', async () => {
    vi.useFakeTimers()
    const f = stubChecker({ session: { ad: { manifestUrl: `${BASE}/m/${SID}.m3u8` } }, info: {} })
    const ab = createAdBreak()
    await ab.request(VIDEO)
    const p = ab.resolve()
    await vi.advanceTimersByTimeAsync(6 * 700)
    expect(await p).toBeNull()
    expect(posts(f, '/i')).toHaveLength(6)
    expect(ab.resolved).toBe(false)
  })

  it('is a no-op without any session', async () => {
    const f = stubChecker()
    expect(await createAdBreak().resolve()).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('timeline mapping (mid-roll at 60s, 15s long)', () => {
  it('pins content time to the cut inside the break and takes the ad out after it', async () => {
    const { ab } = await midRoll()
    expect(ab.contentTime(30)).toBe(30)
    expect(ab.contentTime(60)).toBe(60)
    expect(ab.contentTime(74.9)).toBe(60)
    expect(ab.contentTime(75)).toBe(60)
    expect(ab.contentTime(100)).toBe(85)
  })

  it('maps content time back to the player clock, the cut itself staying before the ad', async () => {
    const { ab } = await midRoll()
    expect(ab.playerTimeFor(30)).toBe(30)
    expect(ab.playerTimeFor(60)).toBe(60)
    expect(ab.playerTimeFor(61)).toBe(76)
  })

  it('reports the creator\'s own duration', async () => {
    const { ab } = await midRoll()
    expect(ab.contentDuration(615)).toBe(600)
    expect(ab.contentDuration(10)).toBe(0)
  })

  it('without an ad every mapping is the identity', () => {
    const ab = createAdBreak()
    expect(ab.contentTime(42)).toBe(42)
    expect(ab.playerTimeFor(42)).toBe(42)
    expect(ab.contentDuration(100)).toBe(100)
    expect(ab.isInside(42)).toBe(false)
    expect(ab.endOfBreak()).toBeNull()
  })

  it('knows when the playhead is inside and how long is left', async () => {
    const { ab } = await midRoll()
    expect(ab.isInside(59.9)).toBe(false)
    expect(ab.isInside(60)).toBe(true)
    expect(ab.isInside(75)).toBe(false)
    expect(ab.secondsUntil(50)).toBe(10)
    expect(ab.secondsUntil(61)).toBeNull()
    expect(ab.secondsRemaining(70)).toBe(5)
    expect(ab.secondsRemaining(80)).toBeNull()
    expect(ab.endOfBreak()).toBeCloseTo(75.35)
  })
})

describe('countdown and seek lock', () => {
  it('counts down the last 3 seconds in whole seconds', async () => {
    const { ab } = await midRoll()
    expect(AD_COUNTDOWN_FROM).toBe(3)
    expect(ab.countdownAt(56)).toBeNull()
    expect(ab.countdownAt(57)).toBe(3)
    expect(ab.countdownAt(58.5)).toBe(2)
    expect(ab.countdownAt(59.99)).toBe(1)
    expect(ab.countdownAt(60)).toBeNull()
  })

  it('arms the lock only once the countdown has been on screen', async () => {
    const { ab } = await midRoll()
    expect(ab.seekLocked(58)).toBe(false)
    ab.countdownAt(58)
    expect(ab.seekLocked(58)).toBe(true)
    expect(ab.seekLocked(70)).toBe(true)
    expect(ab.seekLocked(56)).toBe(false)
    expect(ab.seekLocked(75)).toBe(false)
  })

  it('a pre-roll with no countdown never refuses a deep-link seek', async () => {
    const f = stubChecker({ session: { ad: { manifestUrl: `${BASE}/m/${SID}.m3u8` } }, info: { adStartAt: 0, adDurationSeconds: 10 } })
    const ab = createAdBreak()
    await ab.request(VIDEO)
    await ab.resolve()
    expect(f).toHaveBeenCalled()
    expect(ab.lockedSeekTarget(300, 0.2)).toBeNull()
  })

  it('refuses a forward jump out of the locked window but allows rewinds and stall nudges', async () => {
    const { ab } = await midRoll()
    ab.countdownAt(58)
    expect(ab.lockedSeekTarget(200, 62)).toBe(62)
    expect(ab.lockedSeekTarget(65, 58)).toBe(58)
    expect(ab.lockedSeekTarget(30, 62)).toBeNull()
    expect(ab.lockedSeekTarget(59, 58)).toBeNull()
    expect(ab.lockedSeekTarget(62.3, 62)).toBeNull()
    expect(ab.lockedSeekTarget(NaN, 62)).toBeNull()
  })

  it('no countdown and no lock for a spot already watched', async () => {
    const { ab } = await midRoll()
    ab.countdownAt(58)
    for (let t = 60; t <= 76; t += 0.25) ab.noteTime(t)
    expect(ab.spotConsumed).toBe(true)
    expect(ab.secondsUntil(50)).toBeNull()
    expect(ab.countdownAt(58)).toBeNull()
    expect(ab.seekLocked(65)).toBe(false)
  })
})

describe('skip', () => {
  it('is offered only inside the break after the server\'s threshold', async () => {
    const { ab } = await midRoll({}, { skipAfterSeconds: 5 })
    expect(ab.canSkip(64.9)).toBe(false)
    expect(ab.canSkip(65)).toBe(true)
    expect(ab.canSkip(75)).toBe(false)
    expect(ab.secondsUntilSkip(62)).toBe(3)
    expect(ab.secondsUntilSkip(66)).toBeNull()
  })

  it('is never offered when the server sent no threshold', async () => {
    const { ab } = await midRoll()
    expect(ab.skipOffered).toBe(false)
    expect(ab.canSkip(70)).toBe(false)
    expect(ab.secondsUntilSkip(61)).toBeNull()
  })

  it('pressing Skip tells the server and spends the spot', async () => {
    const { ab, f } = await midRoll({}, { skipAfterSeconds: 5 })
    ab.recordSkip()
    const [url, opts] = posts(f, '/skipped')[0]
    expect(url).toBe(`${BASE}/m/${SID}/skipped`)
    expect(opts).toMatchObject({ method: 'POST', keepalive: true })
    expect(ab.spotConsumed).toBe(true)
  })
})

describe('billing what actually played', () => {
  it('sends one billing beat after 3 seconds on screen and the full figure on the way out', async () => {
    const { ab, f } = await midRoll()
    expect(AD_BILLABLE_SECONDS).toBe(3)
    for (let t = 60; t <= 63; t += 0.25) ab.noteTime(t)
    let beats = posts(f, `/m/${SID}/w`)
    expect(beats).toHaveLength(1)
    expect(JSON.parse(beats[0][1].body).seconds).toBe(3)

    for (let t = 63.25; t < 75; t += 0.25) ab.noteTime(t)
    expect(posts(f, `/m/${SID}/w`)).toHaveLength(1)
    ab.noteTime(75.1)
    beats = posts(f, `/m/${SID}/w`)
    expect(beats).toHaveLength(2)
    expect(JSON.parse(beats[1][1].body).seconds).toBe(14.75)
    expect(ab.watchedSeconds).toBe(14.75)
    expect(beats[1][1].keepalive).toBe(true)
  })

  it('a paused, rewound or jumping playhead adds nothing', async () => {
    const { ab } = await midRoll()
    ab.noteTime(60)
    ab.noteTime(60.5)
    ab.noteTime(60.5)
    ab.noteTime(60.2)
    ab.noteTime(64)
    expect(ab.watchedSeconds).toBe(0.5)
  })

  it('remembers the spot as seen the moment it is entered', async () => {
    const { ab } = await midRoll()
    ab.noteTime(59)
    expect(recentAdKeys()).toEqual([])
    ab.noteTime(60.1)
    expect(recentAdKeys()).toEqual(['ad-1'])
  })

  it('dragging straight past an unwatched spot does not spend it', async () => {
    const { ab, f } = await midRoll()
    ab.noteTime(50)
    ab.noteTime(90)
    expect(ab.spotConsumed).toBe(false)
    expect(posts(f, '/w')).toHaveLength(0)
  })
})

describe('a spent spot is a hole in the timeline', () => {
  async function watched() {
    const r = await midRoll()
    for (let t = 60; t <= 75.5; t += 0.25) r.ab.noteTime(t)
    return r
  }

  it('jumps a forward arrival past the spot and a backward one to just before it', async () => {
    const { ab } = await watched()
    expect(ab.skipTargetFor(65, 50)).toBeCloseTo(75.35)
    expect(ab.skipTargetFor(65, 120)).toBeCloseTo(59.95)
    expect(ab.skipTargetFor(50, 40)).toBeNull()
  })

  it('a spent pre-roll sends a backward arrival past it, since nothing is in front of it', async () => {
    stubChecker({ session: { ad: { manifestUrl: `${BASE}/m/${SID}.m3u8` } }, info: { adStartAt: 0, adDurationSeconds: 10 } })
    const ab = createAdBreak()
    await ab.request(VIDEO)
    await ab.resolve()
    for (let t = 0; t <= 10.5; t += 0.25) ab.noteTime(t)
    expect(ab.skipTargetFor(3, 50)).toBeCloseTo(10.35)
  })

  it('nothing is skipped before the spot has run', async () => {
    const { ab } = await midRoll()
    expect(ab.skipTargetFor(65, 50)).toBeNull()
  })
})

describe('retireSpot', () => {
  it('silences all spot chrome while the seconds still count as the ad', async () => {
    const { ab } = await midRoll()
    ab.retireSpot()
    expect(ab.spotRetired).toBe(true)
    expect(ab.isInside(65)).toBe(false)
    expect(ab.spansSpot(65)).toBe(true)
  })
})

describe('banner', () => {
  async function withBanner({ spot = true } = {}) {
    const session = {
      banner: { manifestUrl: `${BASE}/m/${BANNER_SID}.m3u8`, adKey: 'b-1', overlay: { image: 'x.png' } },
    }
    const info = { bannerStartAt: 20, bannerDurationSeconds: 10, bannerCloseAfterSeconds: 4 }
    if (spot) {
      session.ad = { manifestUrl: `${BASE}/m/${SID}.m3u8`, adKey: 'ad-1' }
      Object.assign(info, { adStartAt: 10, adDurationSeconds: 5 })
    }
    const f = stubChecker({ session, info })
    const ab = createAdBreak()
    await ab.request(VIDEO)
    await ab.resolve()
    return { ab, f }
  }

  it('is visible in content time, shifted by a spot ahead of it', async () => {
    const { ab } = await withBanner()
    expect(ab.isBannerVisible(24.9)).toBe(false)
    expect(ab.isBannerVisible(25)).toBe(true)
    expect(ab.isBannerVisible(34.9)).toBe(true)
    expect(ab.isBannerVisible(35)).toBe(false)
  })

  it('is never shown while the spot plays', async () => {
    stubChecker({
      session: { ad: { manifestUrl: `${BASE}/m/${SID}.m3u8` }, banner: { manifestUrl: `${BASE}/m/${BANNER_SID}.m3u8` } },
      info: { adStartAt: 0, adDurationSeconds: 10, bannerStartAt: 0, bannerDurationSeconds: 30 },
    })
    const ab = createAdBreak()
    await ab.request(VIDEO)
    await ab.resolve()
    expect(ab.isBannerVisible(5)).toBe(false)
    expect(ab.isBannerVisible(12)).toBe(true)
  })

  it('may be closed only after the server\'s delay', async () => {
    const { ab } = await withBanner({ spot: false })
    expect(ab.bannerClosable(23.9)).toBe(false)
    expect(ab.bannerClosable(24)).toBe(true)
  })

  it('reports shown once, on the banner session when there is no spot', async () => {
    const { ab, f } = await withBanner({ spot: false })
    ab.reportBannerShown()
    ab.reportBannerShown()
    const calls = posts(f, '/banner-shown')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(`${BASE}/m/${BANNER_SID}/banner-shown`)
  })

  it('remembers the banner ad the first time it is on screen', async () => {
    const { ab } = await withBanner({ spot: false })
    ab.noteTime(5)
    expect(recentAdKeys()).toEqual([])
    ab.noteTime(21)
    expect(recentAdKeys()).toEqual(['b-1'])
  })

  it('dismiss hides it at once and returns the request for the caller to await', async () => {
    const { ab, f } = await withBanner()
    const p = ab.dismissBanner()
    expect(ab.bannerInfo).toBeNull()
    expect(ab.isBannerVisible(25)).toBe(false)
    await p
    expect(posts(f, '/dismiss')[0][0]).toBe(`${BASE}/m/${SID}/dismiss`)
  })

  it('dismiss still resolves when the request fails', async () => {
    const { ab } = await withBanner()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    await expect(ab.dismissBanner()).resolves.toBeUndefined()
  })
})

describe('ticker', () => {
  async function withTicker() {
    const f = stubChecker({
      session: {
        ad: { manifestUrl: `${BASE}/m/${SID}.m3u8` },
        ticker: { message: 'Hi', durationSeconds: 10, positionPercent: 50, shownUrl: `${BASE}/t/shown` },
      },
      info: { adStartAt: 0, adDurationSeconds: 20 },
    })
    const ab = createAdBreak()
    await ab.request({ ...VIDEO, ticker: true })
    await ab.resolve()
    return { ab, f }
  }

  it('crawls at its percentage of the CONTENT, never during the spot', async () => {
    const { ab } = await withTicker()
    // media 220s = 20s ad + 200s content; 50% -> content 100s -> player 120s
    expect(ab.isTickerVisible(119.9, 220)).toBe(false)
    expect(ab.isTickerVisible(120, 220)).toBe(true)
    expect(ab.isTickerVisible(129.9, 220)).toBe(true)
    expect(ab.isTickerVisible(130, 220)).toBe(false)
    expect(ab.isTickerVisible(5, 220)).toBe(false)
    expect(ab.isTickerVisible(120, 0)).toBe(false)
  })

  it('reports shown once', async () => {
    const { ab, f } = await withTicker()
    ab.reportTickerShown()
    ab.reportTickerShown()
    expect(f.mock.calls.filter(([u]) => u === `${BASE}/t/shown`)).toHaveLength(1)
  })
})

describe('reset', () => {
  it('forgets everything about the previous playback', async () => {
    const { ab } = await midRoll({}, { skipAfterSeconds: 2 })
    ab.countdownAt(58)
    ab.retireSpot()
    for (let t = 60; t <= 76; t += 0.5) ab.noteTime(t)
    ab.reset()
    expect(ab.active).toBe(false)
    expect(ab.resolved).toBe(false)
    expect(ab.spotRetired).toBe(false)
    expect(ab.spotConsumed).toBe(false)
    expect(ab.watchedSeconds).toBe(0)
    expect(ab.skipOffered).toBe(false)
    expect(ab.tickerInfo).toBeNull()
  })
})
