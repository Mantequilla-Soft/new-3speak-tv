// Spoken ticker spots (src/hooks/useAudioAd.js + src/lib/audioAd.js): the global audio
// player pauses the track at the booked position, plays the spot, and resumes.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

const store = vi.hoisted(() => ({ state: { user: null, audioDuration: 600, audioSetIsPlaying: () => {} } }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => store.state } }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))
vi.mock('../../../src/lib/adBreak', () => ({
  adCapId: () => 'cap1', recentAdKeys: () => [], rememberAdSeenFor: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let mod
let fetchMock
let root
let spot
let adEls
let playRejects

const SPOT = {
  audioUrl: 'https://checker.test/m/tts/abc.mp3', durationSeconds: 9.5, positionPercent: 0,
  message: 'Try it', shownUrl: 'https://checker.test/m/s1/ticker-shown', adKey: 'k1', capMinutes: 5,
}

function fakeMain() {
  const el = new EventTarget()
  Object.assign(el, {
    currentTime: 0, duration: 600, paused: true, volume: 0.5, muted: false,
    play: vi.fn(async () => { el.paused = false; el.dispatchEvent(new Event('play')) }),
    pause: vi.fn(() => { el.paused = true }),
  })
  return el
}

class FakeAudio extends EventTarget {
  constructor() {
    super()
    Object.assign(this, { src: '', paused: true, ended: false, currentTime: 0, volume: 1, muted: false })
    adEls.push(this)
  }
  play() {
    if (playRejects) return Promise.reject(new Error('NotAllowedError'))
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
  removeAttribute() {}
  load() {}
}

const shown = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/ticker-shown'))
const sessions = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/m/session')).map(([, o]) => JSON.parse(o.body))

async function mount(el, track) {
  const ref = { current: el }
  const out = {}
  function Probe({ t }) { Object.assign(out, mod.default(ref, t, 'plain')); return null }
  await act(async () => { root.render(createElement(Probe, { t: track })) })
  await act(async () => {})
  return out
}

beforeEach(async () => {
  vi.resetModules()
  adEls = []
  playRejects = false
  spot = { ...SPOT }
  store.state.audioDuration = 600
  globalThis.Audio = FakeAudio
  fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => (url.endsWith('/m/session') ? { ad: null, audioAd: spot } : {}) }))
  globalThis.fetch = fetchMock
  mod = await import('../../../src/hooks/useAudioAd.js')
  root = createRoot(document.createElement('div'))
})
afterEach(() => { act(() => root.unmount()) })

describe('asking', () => {
  it('asks for 3Speak audio only, never for outside episodes or live streams', () => {
    expect(mod._test.itemOf({ owner: 'badadib', permlink: 'abc' })).toBe('badadib/abc')
    expect(mod._test.itemOf({ external: true, owner: 'x', permlink: 'y' })).toBeNull()
    expect(mod._test.itemOf({ live: true, owner: 'x', permlink: 'y' })).toBeNull()
  })

  it('sends the audio surface and says it can play a spot', async () => {
    await mount(fakeMain(), { owner: 'badadib', permlink: 'abc' })
    expect(sessions()[0]).toMatchObject({ surface: 'audio', audioSpot: true, owner: 'badadib', permlink: 'abc', capId: 'cap1' })
    expect(adEls[0].src).toBe(SPOT.audioUrl)
  })
})

describe('playing', () => {
  it('a pre-roll pauses the track, plays the spot, reports it and resumes from the start', async () => {
    const main = fakeMain()
    const ad = await mount(main, { owner: 'badadib', permlink: 'abc' })
    // The answer came in just after the track started.
    main.currentTime = 0.6
    await act(async () => { await main.play() })
    expect(main.paused).toBe(true)
    expect(adEls[0].paused).toBe(false)
    expect(ad.active).toBe(true)
    expect(ad.spot.message).toBe('Try it')

    await act(async () => { adEls[0].ended = true; adEls[0].dispatchEvent(new Event('ended')) })
    expect(shown()).toHaveLength(1)
    expect(main.currentTime).toBe(0)
    expect(main.paused).toBe(false)
    expect(ad.active).toBe(false)
    // Its link stays offered after it is over.
    expect(ad.heardSpot.message).toBe('Try it')
  })

  // The answer still out when the track starts: its opening is held, not heard.
  const deferAnswer = () => {
    let answer
    const pending = new Promise((r) => { answer = r })
    fetchMock.mockImplementation(async (url) => (url.endsWith('/m/session')
      ? { ok: true, json: async () => { await pending; return { ad: null, audioAd: spot } } }
      : { ok: true, json: async () => ({}) }))
    return () => answer()
  }

  it('the opening is held while the answer is out, so a pre-roll really comes first', async () => {
    const answer = deferAnswer()
    const main = fakeMain()
    const ad = await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(main.paused).toBe(true)
    expect(adEls).toHaveLength(0)

    await act(async () => { answer() })
    await act(async () => {})
    expect(adEls[0].paused).toBe(false)
    expect(main.paused).toBe(true)
    expect(ad.active).toBe(true)

    await act(async () => { adEls[0].ended = true; adEls[0].dispatchEvent(new Event('ended')) })
    expect(main.paused).toBe(false)
    expect(main.currentTime).toBe(0)
  })

  it('a later spot releases the held opening at once', async () => {
    spot.positionPercent = 50
    const answer = deferAnswer()
    const main = fakeMain()
    await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(main.paused).toBe(true)
    await act(async () => { answer() })
    await act(async () => {})
    expect(main.paused).toBe(false)
    expect(adEls[0].paused).toBe(true)
  })

  it('no answer within the hold lets the track go on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      deferAnswer()
      const main = fakeMain()
      await mount(main, { owner: 'badadib', permlink: 'abc' })
      await act(async () => { await main.play() })
      expect(main.paused).toBe(true)
      await act(async () => { vi.advanceTimersByTime(2600) })
      expect(main.paused).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a mid-roll waits for its position', async () => {
    spot.positionPercent = 50
    const main = fakeMain()
    await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    main.currentTime = 120; main.dispatchEvent(new Event('timeupdate'))
    expect(adEls[0].paused).toBe(true)
    main.currentTime = 300.2; main.dispatchEvent(new Event('timeupdate'))
    expect(adEls[0].paused).toBe(false)
    expect(main.paused).toBe(true)
  })

  it('a play on the track during the spot toggles the spot instead', async () => {
    const main = fakeMain()
    const ad = await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(ad.toggle()).toBe(true)
    expect(adEls[0].paused).toBe(true)
    await act(async () => { await main.play() })
    expect(main.paused).toBe(true)
    expect(adEls[0].paused).toBe(false)
  })

  it('a spot the browser refuses is dropped and the track plays on, unreported', async () => {
    playRejects = true
    const main = fakeMain()
    const ad = await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    await act(async () => {})
    expect(main.paused).toBe(false)
    expect(shown()).toHaveLength(0)
    expect(ad.active).toBe(false)
    expect(ad.heardSpot).toBeNull()
  })

  it('no answer means no spot', async () => {
    spot = null
    const main = fakeMain()
    await mount(main, { owner: 'someone', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(main.paused).toBe(false)
    expect(adEls).toHaveLength(0)
  })
})

// The screen locked (or another app in front): a phone only lets background audio
// go on in the element that already plays, so nothing may pause the track there.
// The owner's report: the next track of the queue did not start with the screen
// locked, and the player sat paused a few seconds into it, "maybe when the ad
// should play".
describe('with the listener away', () => {
  let restore = []
  const setHidden = (on) => {
    Object.defineProperty(document, 'visibilityState', { value: on ? 'hidden' : 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  // A phone that still says "visible" but has lost the focus (screen off).
  const setTouchUnfocused = () => {
    const mm = window.matchMedia
    const hf = document.hasFocus
    window.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} })
    document.hasFocus = () => false
    restore.push(() => { window.matchMedia = mm; document.hasFocus = hf })
    window.dispatchEvent(new Event('blur'))
  }
  afterEach(() => {
    delete document.visibilityState
    restore.forEach((r) => r())
    restore = []
  })

  it('a track that starts with the screen locked asks for no spot and is never paused', async () => {
    setHidden(true)
    const main = fakeMain()
    const ad = await mount(main, { owner: 'badadib', permlink: 'next' })
    await act(async () => { await main.play() })
    await act(async () => {})
    expect(sessions()).toHaveLength(0)
    expect(adEls).toHaveLength(0)
    expect(main.pause).not.toHaveBeenCalled()
    expect(main.paused).toBe(false)
    expect(ad.active).toBe(false)
  })

  it('the same on a phone that still reports the page visible but has lost the focus', async () => {
    setTouchUnfocused()
    const main = fakeMain()
    await mount(main, { owner: 'badadib', permlink: 'next' })
    await act(async () => { await main.play() })
    await act(async () => {})
    expect(sessions()).toHaveLength(0)
    expect(main.pause).not.toHaveBeenCalled()
  })

  it('a desktop window in the background (visible, not focused) still gets its spot', async () => {
    const hf = document.hasFocus
    document.hasFocus = () => false
    restore.push(() => { document.hasFocus = hf })
    const main = fakeMain()
    await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(adEls[0].paused).toBe(false)
    expect(main.paused).toBe(true)
  })

  it('locking the screen during the hold lets the track go on at once, not after the hold timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      let answer
      const pending = new Promise((r) => { answer = r })
      fetchMock.mockImplementation(async (url) => (url.endsWith('/m/session')
        ? { ok: true, json: async () => { await pending; return { ad: null, audioAd: spot } } }
        : { ok: true, json: async () => ({}) }))
      const main = fakeMain()
      await mount(main, { owner: 'badadib', permlink: 'abc' })
      await act(async () => { await main.play() })
      expect(main.paused).toBe(true) // held for the answer
      await act(async () => { setHidden(true) })
      expect(main.paused).toBe(false) // no timer had to run
      // The answer comes in late (a slow checker) with the screen still off: passed over.
      main.currentTime = 7
      await act(async () => { answer() })
      await act(async () => {})
      expect(main.paused).toBe(false)
      expect(adEls[0].paused).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a late pre-roll answer that arrives after the screen was locked does not pause the track (stuck at 0:07)', async () => {
    let answer
    const pending = new Promise((r) => { answer = r })
    fetchMock.mockImplementation(async (url) => (url.endsWith('/m/session')
      ? { ok: true, json: async () => { await pending; return { ad: null, audioAd: spot } } }
      : { ok: true, json: async () => ({}) }))
    const main = fakeMain()
    main.currentTime = 4 // past the opening: not held
    await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(main.paused).toBe(false)
    setHidden(true)
    main.currentTime = 7
    await act(async () => { answer() })
    await act(async () => {})
    main.dispatchEvent(new Event('timeupdate'))
    expect(main.paused).toBe(false)
    expect(adEls[0].paused).toBe(true)
  })

  it('locking the screen while a spot plays ends the spot and the track goes on, unreported', async () => {
    const main = fakeMain()
    const ad = await mount(main, { owner: 'badadib', permlink: 'abc' })
    await act(async () => { await main.play() })
    expect(ad.active).toBe(true)
    expect(main.paused).toBe(true)
    await act(async () => { setHidden(true) })
    expect(adEls[0].paused).toBe(true)
    expect(main.paused).toBe(false)
    expect(shown()).toHaveLength(0)
    expect(ad.active).toBe(false)
  })
})
