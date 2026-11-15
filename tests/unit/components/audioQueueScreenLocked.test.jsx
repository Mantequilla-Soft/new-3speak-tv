// @vitest-environment jsdom
// The owner's report (2026-11-15, the installed app on Android): "when I play a
// track in my audio queue and lock the screen, the next track is not playing
// automatically after the current ended", seen to stop "maybe when the ad should
// play", with the player paused a few seconds into the next track.
// The real player (components/GlobalAudioPlayer) with the real ad hook
// (hooks/useAudioAd) and a checker that always has a pre-roll spot: with the
// screen locked the next track gets its source and play() straight from the end
// of the last one, is never paused for a spot, and the lock screen shows it.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('axios', () => {
  const axios = { post: vi.fn(async () => ({ data: {} })), get: vi.fn(async () => ({ data: {} })), create: () => axios, interceptors: { request: { use: () => {} }, response: { use: () => {} } } }
  return { default: axios }
})
vi.mock('../../../src/utils/hiveUtils', () => ({ getUersContent: vi.fn(async () => null) }))
vi.mock('../../../src/utils/watchHistory', () => ({ recordWatch: vi.fn() }))
vi.mock('../../../src/hooks/useListenTime', () => ({ default: () => {} }))
vi.mock('../../../src/hooks/useReblog', () => ({ default: () => ({ canReblog: false }) }))
vi.mock('../../../src/lib/adBreak', () => ({ adCapId: () => 'cap1', recentAdKeys: () => [], rememberAdSeenFor: vi.fn() }))
vi.mock('../../../src/lib/podcastProgress', () => ({
  recordProgress: vi.fn(), flushProgress: vi.fn(), resumePosition: vi.fn(() => 0),
  sessionVouch: vi.fn(async () => ''), lastVouchUser: () => null,
}))
vi.mock('../../../src/lib/podcastDownloads', () => ({
  isDownloaded: () => false, localAudioUrl: vi.fn(async () => null), downloadTrack: vi.fn(async () => {}), useDownloads: () => ({ items: [], progress: {} }),
}))
vi.mock('../../../src/lib/podcastMedia', () => ({ fetchChapters: vi.fn(async () => []), fetchTranscript: vi.fn(async () => ({ cues: [] })), chapterAt: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/AudioPip', () => ({ openAudioPip: vi.fn(async () => null), watchAudioPip: () => () => {}, useAudioPipWindow: () => {} }))
vi.mock('../../../src/components/GlobalAudioPlayer/audioEffects', () => ({
  attach: () => null, detach: () => {}, canRoute: async () => false, markNoCors: () => {}, webAudioSupported: () => false, warmUp: () => {},
}))
vi.mock('../../../src/components/AudioItem/AudioItemView', () => ({ audioItemPath: (i) => `/audio?play=${i.owner}/${i.permlink}` }))
vi.mock('../../../src/components/PayoutAmount/PayoutAmount', () => ({ default: () => null }))
vi.mock('../../../src/components/UpvoteCount/UpvoteCount', () => ({ default: () => null }))
vi.mock('../../../src/components/tooltip/CommentVoteTooltip', () => ({ default: () => null }))
vi.mock('../../../src/components/AddToPlaylistModal/AddToPlaylistModal', () => ({ default: () => null }))
vi.mock('../../../src/components/tip-reward/TipModal', () => ({ default: () => null }))
vi.mock('../../../src/components/playVideo/BlogContent', () => ({ default: () => null }))
vi.mock('../../../src/components/Podcasts/PodcastTipModal', () => ({ default: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/AudioCommentPanel', () => ({ default: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/AudioHypeButton', () => ({ default: () => null }))
vi.mock('../../../src/components/ads/TickerCrawl', () => ({ default: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/Waveform', () => ({ default: () => null }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: GlobalAudioPlayer } = await import('../../../src/components/GlobalAudioPlayer/GlobalAudioPlayer.jsx')

// A stand-in <audio>, as in GlobalAudioPlayer.test.jsx.
const MEDIA_KEYS = ['play', 'pause', 'load', 'paused', 'currentTime', 'duration', 'readyState', 'currentSrc', 'src', 'canPlayType']
let savedMedia
beforeAll(() => {
  const proto = HTMLMediaElement.prototype
  savedMedia = MEDIA_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)])
  const fire = (el, type) => el.dispatchEvent(new Event(type))
  Object.defineProperties(proto, {
    paused: { configurable: true, get() { return this._paused !== false } },
    currentTime: { configurable: true, get() { return this._t || 0 }, set(v) { this._t = v } },
    duration: { configurable: true, get() { return this._dur ?? NaN } },
    readyState: { configurable: true, get() { return this._ready ?? 0 } },
    currentSrc: { configurable: true, get() { return this.getAttribute('src') || '' } },
    src: { configurable: true, get() { return this.getAttribute('src') || '' }, set(v) { this.setAttribute('src', v); this._t = 0; this._ready = 0; this._paused = true } },
    canPlayType: { configurable: true, writable: true, value: () => '' },
    load: { configurable: true, writable: true, value() {} },
    play: { configurable: true, writable: true, value: vi.fn(function play() { if (this._paused !== false) { this._paused = false; fire(this, 'play'); fire(this, 'playing') } return Promise.resolve() }) },
    pause: { configurable: true, writable: true, value: vi.fn(function pause() { if (this._paused === false) { this._paused = true; fire(this, 'pause') } }) },
  })
})
afterAll(() => {
  const proto = HTMLMediaElement.prototype
  for (const [k, d] of savedMedia) { if (d) Object.defineProperty(proto, k, d); else delete proto[k] }
})

const SPOT = { audioUrl: 'https://checker.test/m/tts/abc.mp3', durationSeconds: 9.5, positionPercent: 0, message: 'Try it', shownUrl: 'https://checker.test/m/s1/ticker-shown', adKey: 'k1', capMinutes: 5 }
class FakeAudio extends EventTarget {
  constructor() { super(); Object.assign(this, { src: '', paused: true, ended: false, currentTime: 0, volume: 1, muted: false }); spots.push(this) }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve() }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
  removeAttribute() {}
  load() {}
}

let spots
let fetchMock
let session
const track = (n) => ({ _id: `id-${n}`, owner: 'badadib', permlink: `audio-${n}`, title: `Track ${n}`, audio_cid: `cid${n}`, duration: 120, thumbnail_url: '' })
const A = track(1)
const B = track(2)
const C = track(3)
const store = () => useAppStore.getState()
const audio = () => document.querySelector('audio')
const sessionAsks = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/m/session')).map(([, o]) => JSON.parse(o.body))
const setHidden = (on) => {
  Object.defineProperty(document, 'visibilityState', { value: on ? 'hidden' : 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}
// The end of a track as a browser reports it, nothing flushed but what the
// event itself starts: no timers advanced, no animation frames.
const reachEnd = async () => {
  const el = audio()
  el._paused = true
  el.dispatchEvent(new Event('pause'))
  await act(async () => { el.dispatchEvent(new Event('ended')) })
}

beforeEach(() => {
  localStorage.clear()
  spots = []
  globalThis.Audio = FakeAudio
  fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => (String(url).endsWith('/m/session') ? { ad: null, audioAd: { ...SPOT } } : {}) }))
  vi.stubGlobal('fetch', fetchMock)
  const handlers = {}
  session = { metadata: null, playbackState: 'none', handlers, setActionHandler: vi.fn((a, fn) => { handlers[a] = fn }), setPositionState: vi.fn() }
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
  vi.stubGlobal('MediaMetadata', class MediaMetadata { constructor(init) { Object.assign(this, init) } })
  useAppStore.setState({
    audioCurrent: null, audioQueue: [], audioAutoplayList: [], audioLast: null, audioIsPlaying: false,
    audioRestoredAt: null, audioStartAt: null, audioClipEnd: null, audioCurrentTime: 0, audioDuration: 0,
    audioExpanded: false, audioShowQueue: false, audioDock: null, audioDockOpener: null, authenticated: false, user: null,
  })
  HTMLMediaElement.prototype.play.mockClear()
  HTMLMediaElement.prototype.pause.mockClear()
})
afterEach(() => {
  delete document.visibilityState
  delete navigator.mediaSession
  vi.unstubAllGlobals()
})

// A queue of three, the first one started by a tap while the screen is on, its
// pre-roll heard, then the screen goes off.
async function startQueueThenLock() {
  renderWithProviders(<GlobalAudioPlayer />)
  await act(async () => {
    store().audioPlay(A)
    store().audioAddToQueue(B)
    store().audioAddToQueue(C)
  })
  await act(async () => {})
  // The pre-roll of the first track plays and ends; the track goes on.
  expect(spots).toHaveLength(1)
  await act(async () => { spots[0].ended = true; spots[0].dispatchEvent(new Event('ended')) })
  expect(audio().paused).toBe(false)
  await act(async () => { setHidden(true) })
}

describe('the queue with the screen locked', () => {
  it('the next track starts from the end of the last one, without a spot, and keeps playing', async () => {
    await startQueueThenLock()
    const el = audio()
    const nextBefore = session.handlers.nexttrack
    HTMLMediaElement.prototype.play.mockClear()
    HTMLMediaElement.prototype.pause.mockClear()
    await reachEnd()
    expect(store().audioCurrent).toBe(B)
    // Same element, new source, play() called: the only way a phone carries on.
    expect(audio()).toBe(el)
    expect(el.getAttribute('src')).toBe('https://ipfs-audio.3speak.tv/ipfs/cid2')
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    // A few seconds in, where the player sat paused before: still playing.
    await act(async () => { el._t = 7; el.dispatchEvent(new Event('timeupdate')) })
    await act(async () => {})
    expect(el.paused).toBe(false)
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled()
    // No spot asked for the track that began with the screen off.
    expect(sessionAsks().map((b) => b.permlink)).toEqual(['audio-1'])
    expect(spots).toHaveLength(1)
    // The lock screen shows it, and its buttons stayed put.
    expect(session.metadata).toMatchObject({ title: 'Track 2', artist: '@badadib' })
    expect(session.playbackState).toBe('playing')
    expect(session.handlers.nexttrack).toBe(nextBefore)
  })

  it('goes on through the whole queue, and the lock screen Next works between', async () => {
    await startQueueThenLock()
    await reachEnd()
    expect(store().audioCurrent).toBe(B)
    await act(async () => { session.handlers.nexttrack() })
    expect(store().audioCurrent).toBe(C)
    expect(audio().getAttribute('src')).toBe('https://ipfs-audio.3speak.tv/ipfs/cid3')
    expect(audio().paused).toBe(false)
    expect(session.metadata).toMatchObject({ title: 'Track 3' })
  })

  // A phone may still say "visible" right after the screen went off, but the
  // window has lost the focus: the old code held the next track's opening for the
  // spot there (paused, in the background) and played the spot on its own element.
  it('the same when the phone still reports the page visible but the window lost the focus', async () => {
    renderWithProviders(<GlobalAudioPlayer />)
    await act(async () => { store().audioPlay(A); store().audioAddToQueue(B) })
    await act(async () => {})
    await act(async () => { spots[0].ended = true; spots[0].dispatchEvent(new Event('ended')) })
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }))
    const hf = document.hasFocus
    document.hasFocus = () => false
    try {
      await act(async () => { window.dispatchEvent(new Event('blur')) })
      HTMLMediaElement.prototype.pause.mockClear()
      await reachEnd()
      await act(async () => {})
      expect(store().audioCurrent).toBe(B)
      expect(audio().paused).toBe(false)
      expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled()
      expect(spots).toHaveLength(1)
    } finally {
      document.hasFocus = hf
    }
  })

  it('with the screen on, the next track still gets its pre-roll first', async () => {
    renderWithProviders(<GlobalAudioPlayer />)
    await act(async () => { store().audioPlay(A); store().audioAddToQueue(B) })
    await act(async () => {})
    await act(async () => { spots[0].ended = true; spots[0].dispatchEvent(new Event('ended')) })
    await reachEnd()
    await act(async () => {})
    expect(store().audioCurrent).toBe(B)
    expect(spots).toHaveLength(2)
    expect(spots[1].paused).toBe(false)
    expect(audio().paused).toBe(true)
  })
})
