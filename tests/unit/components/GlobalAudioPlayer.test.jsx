// @vitest-environment jsdom
// The audio player at the foot of every page (components/GlobalAudioPlayer/GlobalAudioPlayer.jsx).
// Driven through the real Zustand audio slice and a stand-in <audio> element:
// play and pause, previous and next through the queue or the page's list, the
// queue window, the speed and sleep menus, volume, and what the phone's lock
// screen shows and controls (Media Session), including a track that starts on
// its own while the screen is off.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react'
import { renderWithProviders, stubClipboard, toastMessages } from './_render.jsx'

const hive = vi.hoisted(() => ({ getContent: null }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('axios', () => {
  const axios = { post: vi.fn(async () => ({ data: {} })), get: vi.fn(async () => ({ data: {} })), create: () => axios, interceptors: { request: { use: () => {} }, response: { use: () => {} } } }
  return { default: axios }
})
vi.mock('../../../src/utils/hiveUtils', () => ({ getUersContent: (...a) => hive.getContent(...a) }))
vi.mock('../../../src/utils/watchHistory', () => ({ recordWatch: vi.fn() }))
vi.mock('../../../src/hooks/useListenTime', () => ({ default: () => {} }))
vi.mock('../../../src/hooks/useAudioAd', () => ({ default: () => ({ toggle: () => false, spot: null, heardSpot: null, playing: false }) }))
vi.mock('../../../src/hooks/useReblog', () => ({ default: () => ({ canReblog: false }) }))
vi.mock('../../../src/lib/podcastProgress', () => ({
  recordProgress: vi.fn(), flushProgress: vi.fn(), resumePosition: vi.fn(() => 0),
  sessionVouch: vi.fn(async () => ''), lastVouchUser: () => null,
}))
vi.mock('../../../src/lib/podcastDownloads', () => ({
  isDownloaded: () => false, localAudioUrl: vi.fn(async () => null), downloadTrack: vi.fn(async () => {}), useDownloads: () => ({ items: [], progress: {} }),
}))
vi.mock('../../../src/lib/podcastMedia', () => ({
  fetchChapters: vi.fn(async () => []),
  fetchTranscript: vi.fn(async () => ({ cues: [] })),
  chapterAt: (list, time) => [...list].reverse().find((c) => c.start <= time) || null,
}))
vi.mock('../../../src/components/GlobalAudioPlayer/AudioPip', () => ({
  openAudioPip: vi.fn(async () => null), watchAudioPip: () => () => {}, useAudioPipWindow: () => {},
}))
vi.mock('../../../src/components/GlobalAudioPlayer/audioEffects', () => ({
  attach: () => null, detach: () => {}, canRoute: async () => false, markNoCors: () => {}, webAudioSupported: () => false, warmUp: () => {},
}))
vi.mock('../../../src/components/AudioItem/AudioItemView', () => ({ audioItemPath: (i) => `/audio?play=${i.owner}/${i.permlink}` }))
// Children with their own data fetching, each tested on its own.
vi.mock('../../../src/components/PayoutAmount/PayoutAmount', () => ({ default: ({ amount }) => <span>${amount}</span> }))
vi.mock('../../../src/components/UpvoteCount/UpvoteCount', () => ({ default: ({ count }) => <span>{count} votes</span> }))
vi.mock('../../../src/components/tooltip/CommentVoteTooltip', () => ({ default: () => null }))
vi.mock('../../../src/components/AddToPlaylistModal/AddToPlaylistModal', () => ({ default: () => null }))
vi.mock('../../../src/components/tip-reward/TipModal', () => ({ default: () => null }))
vi.mock('../../../src/components/playVideo/BlogContent', () => ({ default: () => <div>Post body</div> }))
vi.mock('../../../src/components/Podcasts/PodcastTipModal', () => ({ default: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/AudioCommentPanel', () => ({ default: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/AudioHypeButton', () => ({ default: () => null }))
vi.mock('../../../src/components/ads/TickerCrawl', () => ({ default: () => null }))
vi.mock('../../../src/components/GlobalAudioPlayer/Waveform', () => ({ default: () => <div data-testid="waveform" /> }))

const { toast } = await import('sonner')
const axios = (await import('axios')).default
const aioha = await import('../../../src/hive-api/aioha')
const podcastMedia = await import('../../../src/lib/podcastMedia')
const downloads = await import('../../../src/lib/podcastDownloads')
const pip = await import('../../../src/components/GlobalAudioPlayer/AudioPip')
const { CHECKER_URL } = await import('../../../src/utils/config')
const { useAppStore } = await import('../../../src/lib/store')
const { notifyMediaPlay } = await import('../../../src/utils/mediaCoordinator')
const { default: GlobalAudioPlayer } = await import('../../../src/components/GlobalAudioPlayer/GlobalAudioPlayer.jsx')
const { default: EmbedCodeHost } = await import('../../../src/components/Embed/EmbedCodeModal.jsx')

// ── a stand-in <audio>: jsdom loads and plays nothing ─────────────────────────
const MEDIA_KEYS = ['play', 'pause', 'load', 'paused', 'currentTime', 'duration', 'readyState', 'currentSrc', 'src', 'canPlayType']
let savedMedia
beforeAll(() => {
  // jsdom has no layout; the transcript scrolls the spoken line into view.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  const proto = HTMLMediaElement.prototype
  savedMedia = MEDIA_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)])
  const fire = (el, type) => el.dispatchEvent(new Event(type))
  Object.defineProperties(proto, {
    paused: { configurable: true, get() { return this._paused !== false } },
    currentTime: { configurable: true, get() { return this._t || 0 }, set(v) { this._t = v } },
    duration: { configurable: true, get() { return this._dur ?? NaN } },
    readyState: { configurable: true, get() { return this._ready ?? 0 } },
    currentSrc: { configurable: true, get() { return this.getAttribute('src') || '' } },
    // A new source starts over: position 0, no metadata yet, paused (the load algorithm).
    src: { configurable: true, get() { return this.getAttribute('src') || '' }, set(v) { this.setAttribute('src', v); this._t = 0; this._ready = 0; this._dur = undefined; this._paused = true } },
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

const audio = () => document.querySelector('audio')
const fire = (type) => act(() => { audio().dispatchEvent(new Event(type)) })
// The end of the track, the way a browser reports it: paused first, then ended.
const reachEnd = () => act(() => { const el = audio(); el._paused = true; el.dispatchEvent(new Event('pause')); el.dispatchEvent(new Event('ended')) })
// The element got its metadata: seeks now land.
const loaded = (duration = 120) => act(() => { const el = audio(); el._ready = 4; el._dur = duration; el.dispatchEvent(new Event('loadedmetadata')) })
const at = (sec) => act(() => { audio()._t = sec; audio().dispatchEvent(new Event('timeupdate')) })

// ── Media Session (the lock screen / notification) ────────────────────────────
let session
function installMediaSession() {
  const handlers = {}
  session = {
    metadata: null,
    playbackState: 'none',
    handlers,
    setActionHandler: vi.fn((action, fn) => { handlers[action] = fn }),
    setPositionState: vi.fn(),
  }
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
  vi.stubGlobal('MediaMetadata', class MediaMetadata { constructor(init) { Object.assign(this, init) } })
}

const track = (n, extra = {}) => ({
  _id: `id-${n}`, owner: 'badadib', permlink: `audio-${n}`, title: `Track ${n}`,
  audio_cid: `cid${n}`, duration: 120, thumbnail_url: '', ...extra,
})
const A = track(1)
const B = track(2)
const C = track(3)
const CDN = 'https://ipfs-audio.3speak.tv/ipfs'

const store = () => useAppStore.getState()
const play = (t, list) => act(() => store().audioPlay(t, list))

function mount() {
  return renderWithProviders(<><GlobalAudioPlayer /><EmbedCodeHost /></>)
}

beforeEach(() => {
  localStorage.clear()
  installMediaSession()
  hive.getContent = vi.fn(async () => null)
  useAppStore.setState({
    audioCurrent: null, audioQueue: [], audioAutoplayList: [], audioLast: null, audioIsPlaying: false,
    audioRestoredAt: null, audioStartAt: null, audioClipEnd: null, audioCurrentTime: 0, audioDuration: 0,
    audioExpanded: false, audioShowQueue: false, audioDock: null, audioDockOpener: null,
    authenticated: false, user: null,
  })
  axios.get.mockReset().mockResolvedValue({ data: {} })
  axios.post.mockReset().mockResolvedValue({ data: {} })
  aioha.isLoggedIn.mockReturnValue(false)
  HTMLMediaElement.prototype.play.mockClear()
  HTMLMediaElement.prototype.pause.mockClear()
})
afterEach(() => {
  delete navigator.mediaSession
  document.documentElement.style.removeProperty('--audio-np-clearance')
})

describe('the audio player: playing and pausing', () => {
  it('shows no controls while nothing is playing and the queue is empty', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(audio()).toHaveStyle({ display: 'none' })
  })

  it('starts a track from the 3Speak audio gateway and shows what plays', () => {
    mount()
    play(A)
    expect(audio()).toHaveAttribute('src', `${CDN}/cid1`)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(screen.getByText('Track 1')).toBeInTheDocument()
    expect(screen.getByText('@badadib')).toBeInTheDocument()
    expect(screen.getAllByText('0:00 / 2:00')[0]).toBeVisible()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(store().audioIsPlaying).toBe(true)
  })

  it('pauses and resumes from the play button', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(audio().paused).toBe(true)
    expect(store().audioIsPlaying).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(audio().paused).toBe(false)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('follows the position the element reports', () => {
    mount()
    play(A)
    loaded()
    at(75)
    expect(store().audioCurrentTime).toBe(75)
    expect(screen.getAllByText('1:15 / 2:00')[0]).toBeVisible()
  })

  it('skips 10 seconds back and forward from the full player, never past either end', async () => {
    const { user } = mount()
    play(A)
    loaded()
    await user.click(screen.getByRole('button', { name: 'Expand player' }))
    at(5)
    await user.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
    expect(audio().currentTime).toBe(0)
    at(115)
    await user.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(audio().currentTime).toBeLessThanOrEqual(120)
    at(30)
    await user.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(audio().currentTime).toBe(40)
  })

  it('pauses when a video or a short starts playing elsewhere', () => {
    mount()
    play(A)
    act(() => notifyMediaPlay('video'))
    expect(audio().paused).toBe(true)
    expect(store().audioIsPlaying).toBe(false)
  })

  it('does not pause for its own play announcements', () => {
    mount()
    play(A)
    act(() => notifyMediaPlay('audio'))
    expect(audio().paused).toBe(false)
  })

  it('loads a track restored from the last visit paused, at the spot it was left', () => {
    mount()
    act(() => store().audioLoadPaused(A, 42))
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    loaded()
    expect(audio().currentTime).toBe(42)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('tries the second gateway when the first cannot serve the file', () => {
    mount()
    play(A)
    fire('error')
    expect(audio()).toHaveAttribute('src', 'https://ipfs-3speak.b-cdn.net/ipfs/cid1')
    // and gives up quietly after the last one
    fire('error')
    expect(audio()).toHaveAttribute('src', 'https://ipfs-3speak.b-cdn.net/ipfs/cid1')
  })

  // ipfs-audio sends no Content-Type on a mid-file range, which the browser's ORB
  // check blocks unless the file is asked for in CORS mode. b-cdn sends the CORS
  // header twice (CORS fails there) but types every range, so it stays plain.
  it('asks ipfs-audio in CORS mode and the fallback gateway plainly', () => {
    mount()
    play(A)
    expect(audio()).toHaveAttribute('src', `${CDN}/cid1`)
    expect(audio()).toHaveAttribute('crossorigin', 'anonymous')
    fire('error')
    expect(audio()).toHaveAttribute('src', 'https://ipfs-3speak.b-cdn.net/ipfs/cid1')
    expect(audio()).not.toHaveAttribute('crossorigin')
    // The next 3Speak track is back on ipfs-audio, in CORS mode again.
    play(B)
    expect(audio()).toHaveAttribute('src', `${CDN}/cid2`)
    expect(audio()).toHaveAttribute('crossorigin', 'anonymous')
  })

  it('plays an outside podcast episode without CORS', () => {
    mount()
    play(A)
    play({ _id: 'ep-9', external: true, src: 'https://pod.example/ep9.mp3', title: 'Episode nine', show: 'A show', duration: 600 })
    expect(audio()).toHaveAttribute('src', 'https://pod.example/ep9.mp3')
    expect(audio()).not.toHaveAttribute('crossorigin')
  })

  it('stops at the end of a clip', () => {
    mount()
    act(() => store().audioPlayAt(A, 10, 40))
    loaded()
    expect(audio().currentTime).toBe(10)
    expect(screen.getByRole('button', { name: /Clip, stops at 0:40/ })).toBeInTheDocument()
    at(40)
    expect(audio().paused).toBe(true)
    expect(store().audioClipEnd).toBeNull()
  })

  it('closing the player stops the track and remembers where it was', async () => {
    const { user } = mount()
    play(A)
    loaded()
    at(33)
    await user.click(screen.getByRole('button', { name: 'Close player' }))
    expect(store().audioCurrent).toBeNull()
    expect(audio()).not.toHaveAttribute('src')
    expect(store().audioLast).toEqual({ track: A, t: 33 })
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })
})

describe('the audio player: previous, next and the end of a track', () => {
  it('Next plays the following track of the page it was started from', async () => {
    const { user } = mount()
    play(A, [A, B, C])
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    expect(store().audioCurrent).toBe(B)
    expect(audio()).toHaveAttribute('src', `${CDN}/cid2`)
  })

  it('Next on the last track of the list does nothing', async () => {
    const { user } = mount()
    play(C, [A, B, C])
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    expect(store().audioCurrent).toBe(C)
  })

  it('Previous restarts the track after its first seconds, and goes back before that', async () => {
    const { user } = mount()
    play(B, [A, B, C])
    loaded()
    at(20)
    await user.click(screen.getAllByRole('button', { name: 'Previous' })[0])
    expect(audio().currentTime).toBe(0)
    expect(store().audioCurrent).toBe(B)
    await user.click(screen.getAllByRole('button', { name: 'Previous' })[0])
    expect(store().audioCurrent).toBe(A)
  })

  it('the queue goes before the page list', async () => {
    const { user } = mount()
    play(A, [A, B])
    act(() => { store().audioAddToQueue(A); store().audioAddToQueue(C) })
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    expect(store().audioCurrent).toBe(C)
  })

  it('a track that ends starts the next one by itself', () => {
    mount()
    play(A, [A, B])
    reachEnd()
    expect(store().audioCurrent).toBe(B)
    expect(audio()).toHaveAttribute('src', `${CDN}/cid2`)
  })

  // Next and Previous used to drop the page's list (audioPlay without it makes a
  // list of one), so an album stopped after its second track.
  it('Next keeps going through the page list after the first skip', async () => {
    const { user } = mount()
    play(A, [A, B, C])
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    expect(store().audioCurrent).toBe(C)
  })

  it('a page list plays through to its end on its own', () => {
    mount()
    play(A, [A, B, C])
    reachEnd()
    reachEnd()
    expect(store().audioCurrent).toBe(C)
  })

  it('Previous keeps the page list, so Next still works after it', async () => {
    const { user } = mount()
    play(B, [A, B, C])
    await user.click(screen.getAllByRole('button', { name: 'Previous' })[0])
    expect(store().audioCurrent).toBe(A)
    expect(store().audioAutoplayList).toEqual([A, B, C])
  })

  it('a listened track joins the watch history once, for a signed-in listener', async () => {
    const { recordWatch } = await import('../../../src/utils/watchHistory')
    act(() => useAppStore.setState({ user: 'listener' }))
    mount()
    play(A)
    loaded()
    at(10)
    expect(recordWatch).not.toHaveBeenCalled()
    at(31)
    at(40)
    expect(recordWatch).toHaveBeenCalledTimes(1)
    expect(recordWatch).toHaveBeenCalledWith('listener', 'badadib', 'audio-1')
  })
})

describe('the audio player: the lock screen and media keys (Media Session)', () => {
  it('tells the system the title, the creator and the cover of the track', () => {
    mount()
    play(A)
    expect(session.metadata).toMatchObject({
      title: 'Track 1',
      artist: '@badadib',
      album: '3Speak',
      artwork: [{ src: new URL('/img/u/badadib/avatar/large', window.location.href).href }],
    })
    expect(session.playbackState).toBe('playing')
  })

  it('updates the lock screen when the track changes', () => {
    mount()
    play(A)
    play(B)
    expect(session.metadata.title).toBe('Track 2')
  })

  it('names the show, not an account, for an outside podcast episode', () => {
    mount()
    play({ _id: 'ep-1', external: true, src: 'https://pod.example/ep1.mp3', title: 'Episode one', show: 'A show', art: 'art1', duration: 600 })
    expect(audio()).toHaveAttribute('src', 'https://pod.example/ep1.mp3')
    expect(session.metadata).toMatchObject({ title: 'Episode one', artist: 'A show', album: '' })
    expect(session.metadata.artwork[0].src).toMatch(/\/art\/art1\/512\.jpg$/)
  })

  it('falls back to "Untitled" for a track without a title', () => {
    mount()
    play(track(9, { title: '' }))
    expect(session.metadata.title).toBe('Untitled')
  })

  it('reports paused to the system when playback pauses', () => {
    mount()
    play(A)
    act(() => audio().pause())
    expect(session.playbackState).toBe('paused')
  })

  it('a track that starts by itself with the screen off still reaches the lock screen', () => {
    const vis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      mount()
      play(A, [A, B])
      // iOS drops what the lock screen showed when the source changes.
      session.metadata = null
      reachEnd()
      expect(store().audioCurrent).toBe(B)
      expect(session.metadata).toMatchObject({ title: 'Track 2', artist: '@badadib' })
      expect(session.playbackState).toBe('playing')
    } finally {
      delete document.visibilityState
      if (vis) Object.defineProperty(Document.prototype, 'visibilityState', vis)
    }
  })

  it('with a track brought back from the last visit, tells the lock screen again once a new source plays, not on every resume', async () => {
    // Loaded before the player mounts, as after a reload.
    useAppStore.setState({ audioCurrent: A, audioAutoplayList: [A], audioRestoredAt: 0, audioDuration: 120 })
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Play' }))
    session.metadata = null
    fire('playing')
    // The same source as before (a resume after buffering): nothing to re-send.
    expect(session.metadata).toBeNull()
    // A new source (iOS drops the lock screen on it): told again.
    act(() => { audio().setAttribute('src', `${CDN}/other-gateway`) })
    fire('playing')
    expect(session.metadata).toMatchObject({ title: 'Track 1', artist: '@badadib' })
  })

  // The <audio> element used to be remounted when the player went from empty to
  // playing (the returns had different roots), leaving the re-tell bound to the
  // detached element for the whole session.
  it('started from an empty player, still tells the lock screen again on a new source', () => {
    mount()
    const before = audio()
    play(A)
    expect(audio()).toBe(before) // one element for the whole session
    session.metadata = null
    act(() => { audio().setAttribute('src', `${CDN}/other-gateway`) })
    fire('playing')
    expect(session.metadata).toMatchObject({ title: 'Track 1' })
  })

  it('answers the headphone and lock-screen buttons', () => {
    mount()
    play(B, [A, B, C])
    loaded()
    for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward']) {
      expect(typeof session.handlers[a]).toBe('function')
    }
    act(() => session.handlers.pause())
    expect(audio().paused).toBe(true)
    act(() => session.handlers.play())
    expect(audio().paused).toBe(false)
    act(() => session.handlers.seekto({ seekTime: 50 }))
    expect(audio().currentTime).toBe(50)
    act(() => session.handlers.seekbackward())
    expect(audio().currentTime).toBe(40)
    act(() => session.handlers.seekforward())
    expect(audio().currentTime).toBe(50)
    act(() => session.handlers.nexttrack())
    expect(store().audioCurrent).toBe(C)
  })

  it('the lock screen\'s previous button goes back a track', () => {
    mount()
    play(B, [A, B, C])
    act(() => session.handlers.previoustrack())
    expect(store().audioCurrent).toBe(A)
  })

  it('shows the timeline on the lock screen with the duration, the position and the speed', () => {
    mount()
    play(A)
    loaded()
    at(30)
    fire('seeked')
    expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: 120, position: 30, playbackRate: 1 })
  })

  it('a live stream offers no seeking on the lock screen and no timeline', () => {
    mount()
    play({ _id: 'live-1', external: true, live: true, src: 'https://live.example/stream.mp3', title: 'On air', show: 'Radio' })
    expect(session.handlers.seekto).toBeNull()
    expect(session.handlers.seekforward).toBeNull()
    expect(session.setPositionState).toHaveBeenCalledWith()
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Back 15 seconds' })).not.toBeInTheDocument()
  })

  it('clears its buttons from the system when the player goes away', () => {
    const { unmount } = mount()
    play(A)
    unmount()
    expect(session.handlers.nexttrack).toBeNull()
    expect(session.handlers.play).toBeNull()
  })
})

describe('the audio player: the queue', () => {
  it('opens the queue window with the queued tracks and a count on the button', async () => {
    const { user } = mount()
    play(A)
    act(() => { store().audioAddToQueue(B); store().audioAddToQueue(C) })
    const btn = screen.getByRole('button', { name: /^Queue/ })
    expect(btn).toHaveTextContent('2')
    await user.click(btn)
    const panel = screen.getByRole('heading', { name: 'Queue' }).closest('.audio-queue-panel')
    expect(within(panel).getByText('Track 2')).toBeInTheDocument()
    expect(within(panel).getByText('Track 3')).toBeInTheDocument()
  })

  it('says so when the queue is empty', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: /^Queue/ }))
    expect(screen.getByText('Queue is empty.')).toBeInTheDocument()
  })

  it('plays a queued track when it is picked', async () => {
    const { user } = mount()
    play(A)
    act(() => { store().audioAddToQueue(B) })
    await user.click(screen.getByRole('button', { name: /^Queue/ }))
    await user.click(screen.getByText('Track 2'))
    expect(store().audioCurrent).toBe(B)
  })

  it('moves, removes and clears queued tracks', async () => {
    const { user } = mount()
    play(A)
    act(() => { store().audioAddToQueue(B); store().audioAddToQueue(C) })
    await user.click(screen.getByRole('button', { name: /^Queue/ }))
    await user.click(screen.getByRole('button', { name: 'Move Track 2 down' }))
    expect(store().audioQueue.map((t) => t._id)).toEqual(['id-3', 'id-2'])
    await user.click(screen.getByRole('button', { name: 'Move Track 3 down' }))
    expect(store().audioQueue.map((t) => t._id)).toEqual(['id-2', 'id-3'])

    const rows = document.querySelectorAll('.audio-queue-item')
    await user.click(rows[0].querySelector('.audio-queue-actions button:last-child'))
    expect(store().audioQueue.map((t) => t._id)).toEqual(['id-3'])

    await user.click(screen.getByRole('button', { name: /^Clear$/ }))
    expect(store().audioQueue).toEqual([])
    expect(screen.getByText('Queue is empty.')).toBeInTheDocument()
  })

  it('closes the queue window from its X', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: /^Queue/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('heading', { name: 'Queue' })).not.toBeInTheDocument()
    expect(store().audioShowQueue).toBe(false)
  })

  // BUG: the remove button of every queued track holds only an icon, with no
  // aria-label or title, so a screen reader announces just "button"
  // (GlobalAudioPlayer.jsx:1295). The move buttons read out "↑" and "↓" (:1293-1294).
  it('BUG: every queue button has a meaningful accessible name', async () => {
    const { user } = mount()
    play(A)
    act(() => { store().audioAddToQueue(B) })
    await user.click(screen.getByRole('button', { name: /^Queue/ }))
    const row = screen.getByText('Track 2').closest('li')
    for (const b of within(row).getAllByRole('button')) expect(b).toHaveAccessibleName(/remove|move/i)
  })

  it('after closing, keeps a small "continue" bar while the queue holds something', async () => {
    const { user } = mount()
    play(A)
    act(() => { store().audioAddToQueue(B) })
    loaded()
    at(65)
    await user.click(screen.getByRole('button', { name: 'Close player' }))
    const resume = screen.getByRole('button', { name: 'Continue at 1:05' })
    expect(screen.getByText('Track 1')).toBeInTheDocument()
    await user.click(resume)
    expect(store().audioCurrent).toEqual(A)
    loaded()
    expect(audio().currentTime).toBe(65)
  })

  it('the continue bar offers the top of the queue when nothing was playing, and its X clears the queue', async () => {
    const { user } = mount()
    act(() => { store().audioAddToQueue(B); store().audioAddToQueue(C) })
    expect(screen.getByText('Track 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Up next' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear queue' }))
    expect(store().audioQueue).toEqual([])
    expect(screen.queryByRole('button', { name: 'Up next' })).not.toBeInTheDocument()
  })

  it('the continue bar starts the top of the queue', async () => {
    const { user } = mount()
    act(() => { store().audioAddToQueue(B); store().audioAddToQueue(C) })
    await user.click(screen.getByRole('button', { name: 'Up next' }))
    expect(store().audioCurrent).toBe(B)
    expect(store().audioAutoplayList).toEqual([B, C])
  })
})

describe('the audio player: the opened player and its menus', () => {
  it('expands and collapses, saying which it will do', async () => {
    const { user } = mount()
    play(A)
    const expand = screen.getByRole('button', { name: 'Expand player' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    await user.click(expand)
    expect(store().audioExpanded).toBe(true)
    expect(screen.getByRole('button', { name: 'Collapse player' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Playback speed: 1×' })).toBeInTheDocument()
  })

  it('the bar\'s "more" tile holds what its tiles used to (20a): open, queue, volume', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'More options' }))
    const menu = screen.getByRole('dialog')
    expect(within(menu).getByRole('button', { name: /Queue/ })).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: /Close player/ })).toBeInTheDocument()
    await user.click(within(menu).getByRole('button', { name: /Volume/ }))
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Expand player/ }))
    expect(store().audioExpanded).toBe(true)
  })

  it('opening on a phone audio page goes to its Player tab instead', async () => {
    const opener = vi.fn()
    act(() => useAppStore.setState({ audioDockOpener: opener }))
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Expand player' }))
    expect(opener).toHaveBeenCalledTimes(1)
    expect(store().audioExpanded).toBe(false)
  })

  it('changes the playback speed and remembers it for next time', async () => {
    act(() => useAppStore.setState({ audioExpanded: true }))
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Playback speed: 1×' }))
    const menu = screen.getByRole('dialog', { name: 'Speed' })
    const options = within(menu).getAllByRole('radio')
    expect(options.map((o) => o.textContent)).toEqual(['0.5×', '0.8×', '1×', '1.2×', '1.5×', '1.8×', '2×'])
    expect(within(menu).getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(menu).getByRole('radio', { name: '1.5×' }))
    expect(screen.queryByRole('dialog', { name: 'Speed' })).not.toBeInTheDocument()
    expect(audio().playbackRate).toBe(1.5)
    expect(localStorage.getItem('3speak-audio-speed')).toBe('1.5')
    expect(screen.getByRole('button', { name: 'Playback speed: 1.5×' })).toBeInTheDocument()
    // and the next track keeps it
    play(B)
    expect(audio().playbackRate).toBe(1.5)
  })

  it('a menu closes on Escape and gives the focus back to its button', async () => {
    act(() => useAppStore.setState({ audioExpanded: true }))
    const { user } = mount()
    play(A)
    const btn = screen.getByRole('button', { name: 'Playback speed: 1×' })
    await user.click(btn)
    expect(screen.getByRole('dialog', { name: 'Speed' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Speed' })).not.toBeInTheDocument()
    expect(btn).toHaveFocus()
  })

  it('"at the end of this episode" stops there instead of starting the next track', async () => {
    act(() => useAppStore.setState({ audioExpanded: true }))
    const { user } = mount()
    play(A, [A, B])
    await user.click(screen.getByRole('button', { name: 'Sleep timer' }))
    await user.click(screen.getByRole('radio', { name: 'At the end of this episode' }))
    expect(screen.getByRole('button', { name: 'Stops in 2:00' })).toHaveTextContent('2:00')
    reachEnd()
    expect(store().audioCurrent).toBe(A)
    expect(screen.getByRole('button', { name: 'Sleep timer' })).toBeInTheDocument()
  })

  it('a sleep timer counts down, fades out and pauses on time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      act(() => useAppStore.setState({ audioExpanded: true }))
      const { user } = renderWithProviders(<GlobalAudioPlayer />, { fakeTimers: true })
      play(A)
      await user.click(screen.getByRole('button', { name: 'Sleep timer' }))
      await user.click(screen.getByRole('radio', { name: '5 minutes' }))
      expect(screen.getByRole('button', { name: /Stops in 5:00|Stops in 4:59/ })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(4 * 60 * 1000 + 56 * 1000) })
      expect(audio().paused).toBe(false)
      expect(audio().volume).toBeLessThan(1)
      act(() => { vi.advanceTimersByTime(5000) })
      expect(audio().paused).toBe(true)
      // the volume the fade took is given back
      expect(audio().volume).toBe(1)
      expect(screen.getByRole('button', { name: 'Sleep timer' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sets the volume from its slider, mutes at zero and keeps it for the next visit', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Volume' }))
    const slider = screen.getByRole('slider', { name: 'Volume' })
    fireEvent.change(slider, { target: { value: '0.4' } })
    expect(audio().volume).toBe(0.4)
    expect(localStorage.getItem('audio-volume')).toBe('0.4')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(audio().muted).toBe(true)
    expect(localStorage.getItem('audio-muted')).toBe('1')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument()
  })

  it('starts at the volume saved last time', () => {
    localStorage.setItem('audio-volume', '0.3')
    mount()
    play(A)
    expect(audio().volume).toBe(0.3)
  })

  it('opens the track page from its title, and the creator from the name', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByText('Track 1'))
    expect(screen.getByTestId('location')).toHaveTextContent('/audio?play=badadib/audio-1')
    await user.click(screen.getByText('@badadib'))
    expect(screen.getByTestId('location')).toHaveTextContent('/@badadib?tab=audio')
  })

  it('shares a 3Speak link and opens the embed dialog from the share menu', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const menu = screen.getByRole('dialog', { name: 'Share track' })
    const clipboard = stubClipboard()
    try {
      await user.click(within(menu).getByRole('button', { name: 'Copy 3Speak link' }))
      expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/audio?play=badadib/audio-1`)
      await waitFor(() => expect(toastMessages(toast.success)).toContain('3Speak link copied!'))
    } finally { clipboard.restore() }

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('button', { name: /Embed on a website/i }))
    expect(screen.getByRole('dialog', { name: 'Embed this audio' })).toBeInTheDocument()
  })

  it('shows the Hive votes and payout of the track post', async () => {
    hive.getContent = vi.fn(async () => ({
      active_votes: [{ voter: 'x' }, { voter: 'y' }], pending_payout_value: '1.25 HBD', body: 'Notes', json_metadata: '{"tags":["music","mantecurated"]}',
    }))
    act(() => useAppStore.setState({ audioExpanded: true }))
    mount()
    play(track(4, { post_permlink: 'post-4' }))
    expect(hive.getContent).toHaveBeenCalledWith('badadib', 'post-4')
    await waitFor(() => expect(screen.getAllByText('2 votes').length).toBeGreaterThan(0))
    expect(screen.getAllByText('$1.25').length).toBeGreaterThan(0)
    expect(screen.getByText('#music')).toBeInTheDocument()
    expect(screen.getByText('Curated')).toBeInTheDocument()
  })
})

describe('the audio player: requests from other pages', () => {
  it('a page can toggle playback and seek without touching the player', () => {
    mount()
    play(A)
    loaded()
    act(() => store().audioRequestToggle())
    expect(audio().paused).toBe(true)
    act(() => store().audioRequestToggle())
    expect(audio().paused).toBe(false)
    act(() => store().audioRequestSeek(88))
    expect(audio().currentTime).toBe(88)
  })
})

describe('the audio player: transcripts and chapters', () => {
  const SRT = '1\n00:00:00,000 --> 00:00:05,000\nHello there\n\n2\n00:00:05,000 --> 00:00:09,500\nSecond line\n'
  const withSubs = track(5, { subtitle_languages: ['en', 'de'] })

  beforeEach(() => {
    axios.get.mockImplementation(async (url) => {
      if (url === `${CHECKER_URL}/audio/audio-5/subtitles`) return { data: { found: true, subtitles: { subtitles: { en: 'cid-en', de: 'cid-de' } } } }
      if (url === `${CDN}/cid-en`) return { data: SRT }
      if (url === `${CDN}/cid-de`) return { data: '1\n00:00:00,000 --> 00:00:05,000\nHallo\n' }
      return { data: {} }
    })
  })

  it('shows the transcript of a 3Speak track and jumps to a line when it is picked', async () => {
    const { user } = mount()
    play(withSubs)
    const button = await screen.findAllByRole('button', { name: 'Transcript' })
    expect(button[0]).toHaveAttribute('aria-pressed', 'false')
    await user.click(button[0])
    expect(await screen.findByText('Hello there')).toBeInTheDocument()
    expect(screen.getByText('Second line')).toBeInTheDocument()
    expect(localStorage.getItem('3speak-audio-transcript')).toBe('1')

    audio().pause()
    await user.click(screen.getByText('Second line'))
    expect(audio().currentTime).toBe(5)
    expect(audio().paused).toBe(false)
  })

  it('marks the line being spoken', async () => {
    localStorage.setItem('3speak-audio-transcript', '1')
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    mount()
    play(withSubs)
    await screen.findByText('Hello there')
    loaded()
    at(6)
    expect(screen.getByText('Second line').closest('.audio-cue')).toHaveClass('audio-cue-active')
    expect(scroll).toHaveBeenCalled()
  })

  it('switches the transcript language and remembers it', async () => {
    localStorage.setItem('3speak-audio-transcript', '1')
    const { user } = mount()
    play(withSubs)
    await screen.findByText('Hello there')
    await user.click(screen.getByRole('button', { name: 'DE' }))
    expect(await screen.findByText('Hallo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DE' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('3speak-audio-transcript-lang')).toBe('de')
  })

  it('offers no transcript button for a track without subtitles', () => {
    mount()
    play(A)
    expect(screen.queryByRole('button', { name: 'Transcript' })).not.toBeInTheDocument()
  })

  it('lists the chapters of an outside episode and jumps between them', async () => {
    podcastMedia.fetchChapters.mockResolvedValueOnce([
      { start: 0, title: 'Intro' },
      { start: 60, title: 'The interview', url: 'https://example.org/guest' },
    ])
    act(() => useAppStore.setState({ audioExpanded: true }))
    const { user } = mount()
    play({ _id: 'ep-2', external: true, chapters: true, src: 'https://pod.example/ep2.mp3', title: 'Episode two', show: 'A show', duration: 600 })
    const list = await screen.findByRole('region', { name: 'Chapters' })
    expect(podcastMedia.fetchChapters).toHaveBeenCalledWith('ep-2', { private: false })
    expect(within(list).getByRole('button', { name: /Intro/ })).toHaveAttribute('aria-current', 'true')

    await user.click(within(list).getByRole('button', { name: 'Next chapter' }))
    expect(audio().currentTime).toBe(60)
    at(61)
    expect(within(list).getByRole('button', { name: /The interview/ })).toHaveAttribute('aria-current', 'true')
    expect(within(list).getByRole('link', { name: /Chapter link/ })).toHaveAttribute('href', 'https://example.org/guest')
    expect(screen.getByText('The interview', { selector: '.audio-np-chapter-now' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Next chapter' })).toBeDisabled()

    await user.click(within(list).getByRole('button', { name: 'Previous chapter' }))
    expect(audio().currentTime).toBe(0)
    at(30)
    await user.click(within(list).getByRole('button', { name: /The interview/ }))
    expect(audio().currentTime).toBe(60)
  })
})

describe('the audio player: an outside podcast episode', () => {
  const ep = { _id: 'ep-3', external: true, src: 'https://pod.example/ep3.mp3', title: 'Episode three', show: 'A show', show_id: 'feed-9', summary: 'What this one is about', duration: 900 }

  it('opens the show from its name and the episode page from the show notes', async () => {
    act(() => useAppStore.setState({ audioExpanded: true }))
    const { user } = mount()
    play(ep)
    await user.click(screen.getByText('A show'))
    expect(screen.getByTestId('location')).toHaveTextContent('/audio?type=external&podcast=feed-9')
    act(() => useAppStore.setState({ audioExpanded: true }))
    await user.click(screen.getByRole('button', { name: /What this one is about/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/audio?type=external&episode=ep-3')
  })

  it('picks up an episode where it was left last time', async () => {
    const progress = await import('../../../src/lib/podcastProgress')
    progress.resumePosition.mockReturnValueOnce(321)
    mount()
    play(ep)
    loaded(900)
    expect(audio().currentTime).toBe(321)
  })
})

describe('the audio player: saving for offline, effects and the pop-out window', () => {
  beforeEach(() => act(() => useAppStore.setState({ audioExpanded: true })))

  it('saves the track for offline listening and confirms it', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(downloads.downloadTrack).toHaveBeenCalledWith(A)
    await waitFor(() => expect(toastMessages(toast.success)).toContain('Saved for offline listening'))
  })

  it('explains why a track could not be saved', async () => {
    downloads.downloadTrack.mockRejectedValueOnce(Object.assign(new Error('big'), { code: 'too_large' }))
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('This episode is too big to save.'))
  })

  it('says nothing when the listener cancelled the download', async () => {
    downloads.downloadTrack.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'cancelled' }))
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await act(async () => {})
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('turns voice boost on, remembers it, and says when the browser cannot do it', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Audio effects' }))
    const boost = screen.getByRole('switch', { name: /Voice boost/ })
    expect(boost).toHaveAttribute('aria-checked', 'false')
    await user.click(boost)
    expect(boost).toHaveAttribute('aria-checked', 'true')
    expect(JSON.parse(localStorage.getItem('3speak-audio-effects'))).toEqual({ boost: true, skip: false })
    expect(screen.getByText('Not available for this episode.')).toBeInTheDocument()
  })

  it('asks for the pop-out window from its button', async () => {
    const { user } = mount()
    play(A)
    await user.click(screen.getByRole('button', { name: 'Pop out player' }))
    expect(pip.openAudioPip).toHaveBeenCalledTimes(1)
  })

  it('opens the audio page of a tag', async () => {
    hive.getContent = vi.fn(async () => ({ active_votes: [], json_metadata: '{"tags":["music"]}' }))
    const { user } = mount()
    play(track(6, { post_permlink: 'post-6' }))
    await user.click(await screen.findByText('#music'))
    expect(screen.getByTestId('location')).toHaveTextContent('/audio?tag=music')
    expect(store().audioExpanded).toBe(false)
  })
})

describe('the audio player: pay per listen', () => {
  const paid = track(7, { ppl: true })

  it('opens no listen session for a listener who is not signed in', () => {
    mount()
    play(paid)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('opens a session for a signed-in listener and sends a heartbeat while the track plays', async () => {
    aioha.isLoggedIn.mockReturnValue(true)
    act(() => useAppStore.setState({ authenticated: true, user: 'listener' }))
    axios.post.mockImplementation(async (url) => (url.endsWith('/audio/play-start')
      ? { data: { sid: 's-1', token: 'tk', payable: true, beatSeconds: 10 } }
      : { data: {} }))
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mount()
    play(paid)
    expect(axios.post).toHaveBeenCalledWith(`${CHECKER_URL}/audio/play-start`, { permlink: 'audio-7', username: 'listener' })
    await act(async () => {})
    loaded()
    at(5)
    expect(axios.post).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1_011_000)
    at(16)
    await act(async () => {})
    expect(axios.post).toHaveBeenLastCalledWith(`${CHECKER_URL}/audio/play-beat`, { sid: 's-1', token: 'tk' })
  })
})
