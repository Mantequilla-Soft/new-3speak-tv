// Server-side ads in a player (src/hooks/useAdPlayback.jsx): the disclosure,
// the countdown and seek lock before a break, the resume and Skip countdowns,
// skipping, the spent-spot jump and the locked-seek backstop on the <video>
// element, closing a drawn or a burned banner (the burned one swaps the source
// and keeps the position, with all ad chrome silenced meanwhile), counting a
// drawn banner and a ticker crossing, and asking for a spot per video.
//
// The ad break itself (lib/adBreak.js, tested on its own) is replaced by a
// stand-in with fixed windows, so these tests check what the hook does with its
// answers: a spot from 10 s to 25 s, Skip after 5 s.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const SPOT = { start: 10, end: 25, skipAfter: 5 }
const ads = vi.hoisted(() => ({ current: null, remembered: [] }))
vi.mock('../../../src/lib/adBreak', () => ({
  createAdBreak: () => ads.current,
  rememberAdSeenFor: (minutes, key) => ads.remembered.push([minutes, key]),
}))
const metaCache = vi.hoisted(() => ({ meta: null }))
vi.mock('../../../src/lib/videoMetaCache', () => ({ resolveVideoMeta: async () => metaCache.meta }))
vi.mock('../../../src/components/ads/AdOverlay', () => ({ default: () => null }))
vi.mock('../../../src/components/ads/AdSkip', () => ({ default: () => null }))
vi.mock('../../../src/components/ads/BannerClick', () => ({ default: () => null }))
vi.mock('../../../src/components/ads/TickerCrawl', () => ({ default: () => null }))
const { useAdPlayback } = await import('../../../src/hooks/useAdPlayback.jsx')

function fakeBreak() {
  const inSpot = (t) => t >= SPOT.start && t < SPOT.end
  const ab = {
    active: false, bannerInfo: null, bannerOverlay: false, tickerInfo: null, info: null, skipOffered: true, spotConsumed: false,
    banner: { start: 30, end: 40, closableAfter: 2 },
    ticker: { start: 50, end: 70 },
    isInside: (t) => ab.active && inSpot(t),
    isBannerVisible: (t) => !!ab.bannerInfo && t >= ab.banner.start && t < ab.banner.end,
    bannerClosable: (t) => t - ab.banner.start >= ab.banner.closableAfter,
    countdownAt: (t) => (t < SPOT.start && SPOT.start - t <= 3 ? Math.ceil(SPOT.start - t) : null),
    seekLocked: (t) => ab.active && t >= SPOT.start - 3 && t < SPOT.end,
    secondsRemaining: (t) => SPOT.end - t,
    canSkip: (t) => t - SPOT.start >= SPOT.skipAfter,
    secondsUntilSkip: (t) => (t - SPOT.start >= SPOT.skipAfter ? null : SPOT.start + SPOT.skipAfter - t),
    endOfBreak: () => SPOT.end + 0.05,
    spotStart: () => SPOT.start,
    isTickerVisible: (t) => !!ab.tickerInfo && t >= ab.ticker.start && t < ab.ticker.end,
    skipTargetFor: vi.fn(() => null),
    lockedSeekTarget: vi.fn(() => null),
    noteTime: vi.fn(),
    recordSkip: vi.fn(),
    retireSpot: vi.fn(),
    // Like the real one: the banner is gone locally at once, the request follows.
    dismissBanner: vi.fn(() => { ab.bannerInfo = null; return Promise.resolve() }),
    reportBannerShown: vi.fn(),
    reportTickerShown: vi.fn(),
    reset: vi.fn(() => { ab.active = false; ab.bannerInfo = null; ab.tickerInfo = null }),
    request: vi.fn(async () => null),
    resolve: vi.fn(),
  }
  return ab
}

let ab
let video
let player
let rafQueue

function mount(initial = {}) {
  const videoElRef = { current: video }
  let state = { currentTime: 0, duration: 120, paused: false, ...initial }
  const hook = renderHook(({ s }) => useAdPlayback({ player, playerState: s, videoElRef, videoAttached: true }), { initialProps: { s: state } })
  const at = (t, patch = {}) => { state = { ...state, currentTime: t, ...patch }; hook.rerender({ s: state }) }
  return { ...hook, at, videoElRef }
}
const fire = (type) => act(() => { video.dispatchEvent(new Event(type)) })
const setPaused = (p) => Object.defineProperty(video, 'paused', { configurable: true, get: () => p })

beforeEach(() => {
  vi.useFakeTimers()
  ab = fakeBreak()
  ads.current = ab
  ads.remembered = []
  metaCache.meta = null
  video = document.createElement('video')
  setPaused(false)
  player = { seek: vi.fn(), hls: null }
  rafQueue = []
  vi.stubGlobal('requestAnimationFrame', (fn) => { rafQueue.push(fn); return rafQueue.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})
afterEach(() => vi.useRealTimers())

describe('with no ad on this playback', () => {
  it('shows no ad chrome at all', () => {
    const { result } = mount()
    expect(result.current).toMatchObject({ sponsorVisible: false, bannerVisible: false, tickerVisible: false, adCountdown: null, adLocked: false, resumeIn: null, canSkipAd: false, skipIn: null })
    expect(result.current.chrome).toMatchObject({ adPlaying: false, sponsorLabel: null, adSkip: null, tickerSlot: null })
  })
})

describe('a video spot', () => {
  beforeEach(() => { ab.active = true })

  it('counts down the last 3 seconds before the break and locks the timeline with the hint', () => {
    const h = mount()
    h.at(6)
    expect(h.result.current).toMatchObject({ adCountdown: null, adLocked: false })
    h.at(7.2)
    expect(h.result.current).toMatchObject({ adCountdown: 3, adLocked: true, sponsorVisible: false })
    h.at(9.5)
    expect(h.result.current.adCountdown).toBe(1)
  })

  it('during the spot: the disclosure, whole seconds to resume, and seconds to Skip', () => {
    const h = mount()
    h.at(11.3)
    expect(h.result.current).toMatchObject({ sponsorVisible: true, adCountdown: null, adLocked: true, resumeIn: 14, canSkipAd: false, skipIn: 4 })
    expect(h.result.current.chrome.adPlaying).toBe(true)
    expect(h.result.current.chrome.sponsorLabel.props).toMatchObject({ resumeIn: 14 })
    expect(h.result.current.chrome.adSkip.props).toMatchObject({ secondsUntil: 4, onSkip: null })
  })

  it('offers Skip once the server threshold has passed', () => {
    const h = mount()
    h.at(15.5)
    expect(h.result.current).toMatchObject({ canSkipAd: true, skipIn: null })
    expect(h.result.current.chrome.adSkip.props.onSkip).toBe(h.result.current.skipAd)
  })

  it('no Skip control when the server offers none', () => {
    ab.skipOffered = false
    const h = mount()
    h.at(16)
    expect(h.result.current.chrome.adSkip).toBeNull()
  })

  it('skipping records it and seeks just past the break, where the chrome clears', () => {
    const h = mount()
    h.at(16)
    act(() => h.result.current.skipAd())
    expect(ab.recordSkip).toHaveBeenCalled()
    expect(player.seek).toHaveBeenCalledWith(25.05)
    h.at(25.05)
    expect(h.result.current).toMatchObject({ canSkipAd: false, sponsorVisible: false })
  })

  it('skipping still seeks when recording it throws, and does nothing without a break end', () => {
    ab.recordSkip.mockImplementation(() => { throw new Error('x') })
    const h = mount()
    act(() => h.result.current.skipAd())
    expect(player.seek).toHaveBeenCalledTimes(1)
    ab.endOfBreak = () => NaN
    act(() => h.result.current.skipAd())
    expect(player.seek).toHaveBeenCalledTimes(1)
  })

  it('after the spot everything clears', () => {
    const h = mount()
    h.at(12)
    h.at(26)
    expect(h.result.current).toMatchObject({ sponsorVisible: false, adLocked: false, resumeIn: null, skipIn: null })
  })

  it('a spot that ends clears its chrome when the break goes inactive', () => {
    const h = mount()
    h.at(12)
    ab.active = false
    h.at(12.5)
    expect(h.result.current).toMatchObject({ sponsorVisible: false, adLocked: false, resumeIn: null, canSkipAd: false, skipIn: null })
  })
})

describe('the <video> element guard', () => {
  it('jumps out of a spot already watched, on any event', () => {
    ab.skipTargetFor.mockImplementation((at) => (at >= 10 && at < 25 ? 25.05 : null))
    mount()
    video.currentTime = 12
    fire('timeupdate')
    expect(video.currentTime).toBe(25.05)
    expect(ab.noteTime).toHaveBeenCalledWith(12)
  })

  it('refuses a seek past a break not yet watched, but never ordinary playback into it', () => {
    ab.lockedSeekTarget.mockImplementation((at, from) => (from != null && from < 10 && at >= 25 ? 10 : null))
    mount()
    video.currentTime = 5
    fire('timeupdate')
    video.currentTime = 40
    fire('seeking')
    expect(video.currentTime).toBe(10)
    expect(ab.lockedSeekTarget).toHaveBeenCalledWith(40, 5)

    ab.lockedSeekTarget.mockClear()
    video.currentTime = 10.2
    fire('timeupdate')
    expect(ab.lockedSeekTarget).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(10.2)
  })

  it('watches the run-up to a spent spot frame by frame and leaves just before the cut', () => {
    ab.spotConsumed = true
    mount()
    video.currentTime = 8.4 // 1.6 s out: not yet
    fire('timeupdate')
    expect(rafQueue).toHaveLength(0)
    video.currentTime = 8.6
    fire('timeupdate')
    expect(rafQueue).toHaveLength(1)
    video.currentTime = 9.9
    act(() => rafQueue.shift()())
    expect(video.currentTime).toBe(25.05)
  })

  it('does not watch frames far from the cut, while paused, or for an unspent spot', () => {
    ab.spotConsumed = true
    mount()
    video.currentTime = 3
    fire('timeupdate')
    setPaused(true)
    video.currentTime = 9
    fire('timeupdate')
    expect(rafQueue).toHaveLength(0)
    ab.spotConsumed = false
    setPaused(false)
    fire('timeupdate')
    expect(rafQueue).toHaveLength(0)
  })

  it('keeps watching frames while still approaching, and stops once far away again', () => {
    ab.spotConsumed = true
    mount()
    video.currentTime = 8.6
    fire('timeupdate')
    video.currentTime = 9.0
    act(() => rafQueue.shift()())
    expect(rafQueue).toHaveLength(1)
    video.currentTime = 2
    act(() => rafQueue.shift()())
    expect(rafQueue).toHaveLength(0)
  })

  it('stops guarding and cancels a pending frame on unmount', () => {
    ab.spotConsumed = true
    ab.skipTargetFor.mockReturnValue(99)
    const h = mount()
    ab.skipTargetFor.mockReturnValue(null)
    video.currentTime = 9
    fire('timeupdate')
    h.unmount()
    expect(cancelAnimationFrame).toHaveBeenCalled()
    ab.skipTargetFor.mockReturnValue(99)
    video.currentTime = 12
    fire('timeupdate')
    expect(video.currentTime).toBe(12)
  })
})

describe('a drawn banner', () => {
  beforeEach(() => {
    ab.bannerInfo = { durationSeconds: 8, placement: 'bottom', brand: { clickUrl: 'https://brand.test' }, advertiser: 'brand' }
    ab.bannerOverlay = true
  })

  it('shows in its window, closable after its threshold', () => {
    const h = mount()
    h.at(31)
    expect(h.result.current.bannerVisible).toBe(true)
    expect(h.result.current.chrome.bannerHit.props).toMatchObject({ visible: true, overlay: true, placement: 'bottom', clickUrl: 'https://brand.test' })
    h.at(41)
    expect(h.result.current.bannerVisible).toBe(false)
  })

  it('is counted once it has been on screen for its booked seconds', () => {
    const h = mount()
    h.at(31)
    act(() => { vi.advanceTimersByTime(7999) })
    expect(ab.reportBannerShown).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(ab.reportBannerShown).toHaveBeenCalledTimes(1)
  })

  it('leaving its window before then cancels the claim', () => {
    const h = mount()
    h.at(31)
    act(() => { vi.advanceTimersByTime(3000) })
    h.at(45)
    act(() => { vi.advanceTimersByTime(10000) })
    expect(ab.reportBannerShown).not.toHaveBeenCalled()
  })

  it('closing it hides it at once and tells the server, with no reload', async () => {
    player.hls = { loadSource: vi.fn(), url: 'https://cdn.test/m.m3u8', once: vi.fn(), startLoad: vi.fn() }
    const h = mount()
    h.at(33)
    await act(async () => { await h.result.current.dismissBanner() })
    expect(h.result.current.bannerVisible).toBe(false)
    expect(ab.dismissBanner).toHaveBeenCalled()
    expect(player.hls.loadSource).not.toHaveBeenCalled()
  })
})

describe('a burned-in banner', () => {
  let hls
  let onParsed
  beforeEach(() => {
    ab.active = true
    ab.bannerInfo = { durationSeconds: 8 }
    hls = { url: 'https://cdn.test/m.m3u8', loadSource: vi.fn(), startLoad: vi.fn(), once: vi.fn((_e, fn) => { onParsed = fn }) }
    player.hls = hls
    video.play = vi.fn(async () => {})
  })

  it('is not counted by the page (the server counts its segments)', () => {
    const h = mount()
    h.at(31)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(ab.reportBannerShown).not.toHaveBeenCalled()
  })

  it('closing swaps the source, resumes at the same position, and silences ad chrome meanwhile', async () => {
    const h = mount()
    h.at(9) // a countdown is up
    expect(h.result.current.adCountdown).toBe(1)
    video.currentTime = 33
    await act(async () => { await h.result.current.dismissBanner() })
    expect(ab.dismissBanner).toHaveBeenCalled()
    expect(hls.loadSource).toHaveBeenCalledWith('https://cdn.test/m.m3u8')
    expect(h.result.current).toMatchObject({ adCountdown: null, adLocked: false, bannerVisible: false })

    // The reload walks through zero, where an early spot would look live: nothing shows.
    h.at(12)
    expect(h.result.current.sponsorVisible).toBe(false)

    act(() => onParsed())
    expect(hls.startLoad).toHaveBeenCalledWith(33)
    expect(video.play).toHaveBeenCalled()
    h.at(12.5)
    expect(h.result.current.sponsorVisible).toBe(true)
  })

  it('retires a spot that already ran before the swap', async () => {
    const h = mount()
    video.currentTime = 33
    await act(async () => { await h.result.current.dismissBanner() })
    expect(ab.retireSpot).toHaveBeenCalled()
  })

  it('keeps a spot not yet reached', async () => {
    const h = mount()
    video.currentTime = 5
    await act(async () => { await h.result.current.dismissBanner() })
    expect(ab.retireSpot).not.toHaveBeenCalled()
  })

  it('a paused video stays paused after the swap', async () => {
    setPaused(true)
    const h = mount()
    video.currentTime = 33
    await act(async () => { await h.result.current.dismissBanner() })
    act(() => onParsed())
    expect(video.play).not.toHaveBeenCalled()
  })

  it('a manifest that never parses un-silences the chrome after 8 s', async () => {
    const h = mount()
    video.currentTime = 33
    await act(async () => { await h.result.current.dismissBanner() })
    h.at(12)
    expect(h.result.current.sponsorVisible).toBe(false)
    act(() => { vi.advanceTimersByTime(8000) })
    h.at(12.2)
    expect(h.result.current.sponsorVisible).toBe(true)
  })

  it('without hls.js to reload, the chrome comes straight back', async () => {
    player.hls = null
    const h = mount()
    await act(async () => { await h.result.current.dismissBanner() })
    h.at(12)
    expect(h.result.current.sponsorVisible).toBe(true)
  })

  it('a failing server call does not stop the swap', async () => {
    ab.dismissBanner.mockImplementation(() => { ab.bannerInfo = null; return Promise.reject(new Error('offline')) })
    const h = mount()
    video.currentTime = 33
    await act(async () => { await h.result.current.dismissBanner() })
    expect(hls.loadSource).toHaveBeenCalled()
  })
})

describe('the ticker', () => {
  beforeEach(() => {
    ab.tickerInfo = { durationSeconds: 10, adKey: 'ad-1', capMinutes: 60, account: 'brand', message: 'Buy', style: 'plain' }
  })

  const play = (h, from, to, step = 0.5) => { for (let t = from; t <= to + 1e-9; t += step) h.at(Number(t.toFixed(2))) }

  it('shows in its window and is counted once a whole crossing was watched', () => {
    const h = mount()
    h.at(50)
    expect(h.result.current.tickerVisible).toBe(true)
    expect(h.result.current.chrome.tickerSlot.props).toMatchObject({ hidden: false, message: 'Buy', durationSeconds: 10, paused: false })
    play(h, 50.5, 59)
    expect(ab.reportTickerShown).not.toHaveBeenCalled()
    play(h, 59.5, 60)
    expect(ab.reportTickerShown).toHaveBeenCalledTimes(1)
    expect(ads.remembered).toEqual([[60, 'ad-1']])
    play(h, 60.5, 66)
    expect(ab.reportTickerShown).toHaveBeenCalledTimes(1)
  })

  it('a seek inside the window is not time watched', () => {
    const h = mount()
    h.at(50)
    h.at(60) // a jump
    play(h, 60.5, 65)
    expect(ab.reportTickerShown).not.toHaveBeenCalled()
  })

  it('a paused video or a background tab does not count', () => {
    const h = mount({ paused: true })
    play(h, 50, 69)
    expect(ab.reportTickerShown).not.toHaveBeenCalled()
    expect(h.result.current.chrome.tickerSlot.props.paused).toBe(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    h.at(50, { paused: false })
    play(h, 50.5, 69)
    expect(ab.reportTickerShown).not.toHaveBeenCalled()
  })

  it('leaving the window part way starts the count over', () => {
    const h = mount()
    play(h, 50, 56)
    h.at(80)
    expect(h.result.current.tickerVisible).toBe(false)
    play(h, 50, 56)
    expect(ab.reportTickerShown).not.toHaveBeenCalled()
  })

  it('a video spot cutting in holds it hidden, keeping its watched seconds', () => {
    // A spot inside the ticker window for this test.
    ab.active = true
    ab.isInside = (t) => t >= 55 && t < 58
    ab.isTickerVisible = (t) => t >= 50 && t < 70 && !(t >= 55 && t < 58)
    const h = mount()
    play(h, 50, 54.5)
    h.at(55)
    expect(h.result.current.tickerHeld).toBe(true)
    expect(h.result.current.chrome.tickerSlot.props).toMatchObject({ hidden: true, paused: true })
    h.at(58)
    expect(h.result.current.tickerHeld).toBe(false)
    play(h, 58.5, 64)
    expect(ab.reportTickerShown).toHaveBeenCalledTimes(1)
  })
})

describe('per video', () => {
  const source = { url: 'https://cdn.test/v.m3u8', fallbacks: ['https://cdn2.test/v.m3u8'], poster: 'p.jpg' }
  let api
  let loadVideo
  beforeEach(() => {
    api = { fetchSource: vi.fn(async () => source) }
    loadVideo = vi.fn(async () => {})
  })

  it('beginVideo starts a new break and ticker run', () => {
    ab.bannerInfo = { durationSeconds: 1 }
    const h = mount()
    h.at(31)
    act(() => h.result.current.beginVideo())
    expect(ab.reset).toHaveBeenCalled()
    expect(h.result.current.bannerVisible).toBe(false)
  })

  it('loads the stitched source when the server books a spot, keeping the original as a fallback', async () => {
    metaCache.meta = { owner: 'asset-owner', permlink: 'asset-perm' }
    ab.request.mockResolvedValue({ manifestUrl: 'https://stitch.test/s.m3u8' })
    const h = mount()
    let outcome
    await act(async () => { outcome = await h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 'p1', viewer: 'v', loadVideo, isActive: () => true }) })
    expect(outcome).toBe('spot')
    expect(ab.request).toHaveBeenCalledWith({ owner: 'asset-owner', permlink: 'asset-perm', viewer: 'v', manifestUrl: source.url, ticker: true })
    expect(loadVideo).toHaveBeenCalledWith({ url: 'https://stitch.test/s.m3u8', fallbacks: [source.url, ...source.fallbacks], poster: 'p.jpg' })
    expect(ab.resolve).toHaveBeenCalled()
  })

  it('no spot booked: the caller plays it plainly', async () => {
    const h = mount()
    await expect(h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 'p1', loadVideo, isActive: () => true })).resolves.toBe('plain')
    expect(ab.request.mock.calls[0][0]).toMatchObject({ owner: 'badadib', permlink: 'p1' })
    expect(loadVideo).not.toHaveBeenCalled()
  })

  it('never asks for a spot on a short', async () => {
    metaCache.meta = { short: true }
    const h = mount()
    await expect(h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 's1', loadVideo, isActive: () => true })).resolves.toBe('plain')
    expect(ab.request).not.toHaveBeenCalled()
  })

  it('a failure anywhere is a plain playback, never an error', async () => {
    api.fetchSource.mockRejectedValue(new Error('404'))
    const h = mount()
    await expect(h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 'p1', loadVideo, isActive: () => true })).resolves.toBe('plain')
    api.fetchSource.mockResolvedValue({})
    await expect(h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 'p1', loadVideo, isActive: () => true })).resolves.toBe('plain')
  })

  it('a caller that moved on gets "stale" and nothing is loaded', async () => {
    ab.request.mockResolvedValue({ manifestUrl: 'https://stitch.test/s.m3u8' })
    let active = true
    ab.request.mockImplementation(async () => { active = false; return { manifestUrl: 'x' } })
    const h = mount()
    await expect(h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 'p1', loadVideo, isActive: () => active })).resolves.toBe('stale')
    expect(loadVideo).not.toHaveBeenCalled()
    api.fetchSource.mockRejectedValue(new Error('x'))
    await expect(h.result.current.loadWithSpot({ api, author: 'badadib', permlink: 'p1', loadVideo, isActive: () => false })).resolves.toBe('stale')
  })
})
