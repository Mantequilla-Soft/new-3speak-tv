// @vitest-environment jsdom
// The watch page's own states (page/Watch.jsx): it renders the player at once
// while the post loads, shows "not found" with a Retry, a network error with a
// Retry, hard-blocks a hidden creator, and tells a missing scheduled post apart.
// When the player gives up, a definite 404 marks the video unavailable and is
// reported; a transport failure only offers a retry. The player SDK, the post
// view (PlayVideo) and every data hook are stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('../components/_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ call: async () => [] }), getHiveUrl: () => 'https://api.hive.example' }))
vi.mock('@hiveio/dhive', () => ({ Client: class { constructor() { this.database = { call: async () => [] } } } }))
vi.mock('../../../src/lib/videoData', () => ({
  fetchVideoDetails: (...a) => m.details(...a),
  fetchPlaySource: async () => null,
  fetchTrendingFeed: async () => ({ videos: [] }),
  fetchAuthorVideos: async () => ({ videos: [] }),
  fetchRelatedFeed: async () => ({ videos: [] }),
}))
vi.mock('@mantequilla-soft/3speak-player/react', () => {
  // Stable functions, as the SDK's hook hands out: the page's effects depend on them.
  const noop = () => {}
  const state = { duration: 0, currentTime: 0, paused: true }
  const load = (...a) => m.load(...a)
  return {
    usePlayer: (opts) => {
      m.playerOpts = opts
      return {
        ref: noop, state, player: m.player, load, pause: noop, togglePlay: noop, seek: noop,
        setMuted: noop, setVolume: noop, togglePip: noop, setQuality: noop, setPlaybackRate: noop,
      }
    },
  }
})
vi.mock('@mantequilla-soft/3speak-player', () => ({ ThreeSpeakApi: class { } }))
vi.mock('../../../src/hooks/useAdPlayback', () => ({
  useAdPlayback: () => ({
    adBreakRef: { current: { contentTime: (t) => t, contentDuration: (d) => d } }, chrome: { adPlaying: false }, beginVideo: () => {},
    loadWithSpot: async () => 'plain', tickerVisible: false, tickerHeld: false,
  }),
}))
vi.mock('../../../src/hooks/useGatedPlayback', () => ({ useGatedPlayback: () => ({ state: 'idle', isEntitled: false, manifestUrl: null, previewUrl: null }) }))
vi.mock('../../../src/hooks/useSubtitles', () => ({ default: () => ({ availableLanguages: [], selectedLang: null, selectLanguage: () => {}, cues: [], loading: false, subtitleStyle: {}, updateStyle: () => {} }) }))
vi.mock('../../../src/hooks/useWatchDuration', () => ({ default: () => {} }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false, loading: false }) }))
vi.mock('../../../src/hooks/useContentBatch', () => ({ useContentBatch: () => ({ getContentForVideo: () => null }) }))
vi.mock('../../../src/hooks/useAiFilteredShorts', () => ({ useAiFilteredShorts: (list) => list }))
vi.mock('../../../src/hooks/useGridMetrics', () => ({ useGridColumns: () => 1, useShortsPerRow: () => 3 }))
vi.mock('../../../src/hooks/useStreamChatMirror', () => ({ useStreamChatMirror: () => null }))
vi.mock('../../../src/utils/hiddenCreators', () => ({ isCreatorHidden: (...a) => m.hidden(...a), batchCheckHidden: async () => new Set() }))
vi.mock('../../../src/utils/reputation', () => ({ batchGetReputations: async () => new Map(), LOW_REP_THRESHOLD: 15 }))
vi.mock('../../../src/utils/watchHistory', () => ({ recordWatch: vi.fn(), batchCheckWatched: async () => new Map() }))
vi.mock('../../../src/utils/feedWatched', () => ({ dropWatchedFromFeeds: () => {} }))
vi.mock('../../../src/utils/playlistVideos', () => ({ fetchVideosForPlaylist: async () => [] }))
vi.mock('../../../src/utils/scheduledPosts', () => ({ fetchScheduledPost: (...a) => m.scheduled(...a), getScheduledEmbedRef: () => null }))
vi.mock('../../../src/lib/recordView', () => ({ recordView: vi.fn() }))
vi.mock('../../../src/lib/reportUnavailable', () => ({ reportVideoUnavailable: (...a) => m.report(...a) }))
vi.mock('../../../src/lib/deadVideos', () => ({ useDeadVideos: () => new Set(), videoKey: (a, p) => `${a}/${p}` }))
vi.mock('../../../src/lib/hiveRenderer', () => ({ getHiveRenderer: async () => (md) => md }))
// The page's children, each tested on its own.
vi.mock('../../../src/components/playVideo/PlayVideo', () => ({
  default: (p) => (
    <section aria-label="Player">
      <h1>{p.videoDetails?.title || 'Untitled while loading'}</h1>
      <video ref={p.videoRef} />
      {p.playlistData && <p>{`Playlist ${p.playlistData.playlist.name}, video ${p.playlistData.currentIndex + 1} of ${p.playlistData.videos.length}`}</p>}
      {p.mediaUnavailable && <p>Media unavailable</p>}
      {p.mediaBlocked && <button type="button" onClick={p.onRetryPlayback}>Retry playback</button>}
      {p.belowPlayerSlot}
      {p.recommendations}
    </section>
  ),
}))
vi.mock('../../../src/components/SEOHead', () => ({ default: ({ title }) => <meta name="test-title" content={title} /> }))
vi.mock('../../../src/components/Cards/Card3', () => ({ default: () => null }))
vi.mock('../../../src/components/ShortsRow/ShortsRow', () => ({ default: () => null }))
vi.mock('../../../src/components/ReactionPlayer/ReactionPlayer', () => ({ default: () => null }))
vi.mock('../../../src/components/playVideo/WatchTabs', () => ({ default: () => null }))
vi.mock('../../../src/components/gated/GuestListEditor', () => ({ default: () => null }))
vi.mock('../../../src/components/SurfBar/SurfBar', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/EditScheduledModal', () => ({ default: () => null }))
vi.mock('../../../src/components/AmbientGlow/AmbientGlow', () => ({ default: () => null, useAmbientGlow: () => ({ glowMode: 'off', toggleGlow: () => {} }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Watch } = await import('../../../src/page/Watch.jsx')

const POST = { title: 'A day at the lake', body: 'Hello', author: { username: 'badadib' }, stats: {}, json_metadata: '{}' }

function mount(route = '/watch?v=badadib/lake-day') {
  return renderWithProviders(<Watch />, { route, path: '/watch' })
}

// A stand-in for the SDK player: events the test can fire, calls it can read.
function fakePlayer() {
  const handlers = {}
  return {
    handlers,
    element: null,
    on: vi.fn((event, fn) => { handlers[event] = fn; return () => { delete handlers[event] } }),
    emit: (event, arg) => act(() => handlers[event]?.(arg)),
    play: vi.fn(async () => {}),
    seek: vi.fn(), setMuted: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn(),
    getQualities: vi.fn(() => [{ index: 0, height: 1080 }, { index: 1, height: 720 }, { index: 2, height: 480 }]),
    getCurrentQuality: vi.fn(() => -1),
    setQuality: vi.fn(),
  }
}

beforeEach(() => {
  m.player = null
  m.details = vi.fn(async () => POST)
  m.hidden = vi.fn(async () => false)
  m.scheduled = vi.fn(async () => null)
  m.report = vi.fn()
  m.load = vi.fn(async () => {})
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  useAppStore.setState({ user: null, incubationHandle: null, inlineShorts: false })
})

describe('the watch page', () => {
  it('shows the player at once while the post is still loading, with no error', async () => {
    m.details = vi.fn(() => new Promise(() => {}))
    mount()
    expect(screen.getByRole('region', { name: 'Player' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Untitled while loading' })).toBeInTheDocument()
    expect(screen.queryByText(/not found|Network error/)).not.toBeInTheDocument()
    expect(m.details).toHaveBeenCalledWith('badadib', 'lake-day')
  })

  it('fills in the post once it arrives', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'A day at the lake' })).toBeInTheDocument()
  })

  it('reads the video from the /@author/permlink form too', async () => {
    renderWithProviders(<Watch routeV="badadib/other-day" />, { route: '/@badadib/other-day', path: '*' })
    await waitFor(() => expect(m.details).toHaveBeenCalledWith('badadib', 'other-day'))
  })

  it('says the video was not found, and Retry asks again', async () => {
    m.details = vi.fn(async () => null)
    const { user } = mount()
    expect(await screen.findByText('Video not found or failed to load.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Player' })).not.toBeInTheDocument()

    m.details.mockResolvedValue(POST)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'A day at the lake' })).toBeInTheDocument()
  })

  it('says it is a network error when loading fails, and Retry recovers', async () => {
    m.details = vi.fn(async () => { throw new Error('Failed to fetch') })
    const { user } = mount()
    expect(await screen.findByText('Network error. Please check your connection.', {}, { timeout: 4000 })).toBeInTheDocument()
    // The query retries once before giving up.
    expect(m.details).toHaveBeenCalledTimes(2)
    m.details = vi.fn(async () => POST)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'A day at the lake' })).toBeInTheDocument()
  })

  it('blocks the page of a hidden creator, with a way home', async () => {
    m.hidden = vi.fn(async () => true)
    const { user } = mount()
    expect(await screen.findByText('This video is not available.')).toBeInTheDocument()
    expect(m.hidden).toHaveBeenCalledWith('badadib')
    await user.click(screen.getByRole('button', { name: 'Go Home' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('does not ask Hive for a post when the address names no video', () => {
    mount('/watch')
    expect(m.details).not.toHaveBeenCalled()
  })

  it('a scheduled post that is gone says so and leads back to the profile', async () => {
    const { user } = mount('/watch?v=badadib/later&scheduled=1')
    expect(await screen.findByText(/Scheduled post not found/)).toBeInTheDocument()
    expect(m.scheduled).toHaveBeenCalledWith('badadib', 'later')
    expect(m.details).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Back to profile' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/profile')
  })

  it('a scheduled post that exists plays from the checker\'s copy', async () => {
    m.scheduled = vi.fn(async () => ({ owner: 'badadib', title: 'Coming soon', body: '', createdAt: '2026-11-01T00:00:00Z' }))
    mount('/watch?v=badadib/later&scheduled=1')
    expect(await screen.findByRole('heading', { name: 'Coming soon' })).toBeInTheDocument()
  })

  describe('when the player gives up', () => {
    async function failWith(err) {
      mount()
      await screen.findByRole('heading', { name: 'A day at the lake' })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      act(() => m.playerOpts.onError(err))
    }

    it('a 404 from the origin marks the video unavailable and reports it', async () => {
      await failWith({ fatal: true, code: 404, message: 'HLS fatal error: manifestLoadError' })
      expect(screen.getByText('Media unavailable')).toBeInTheDocument()
      expect(m.report).toHaveBeenCalledWith('badadib', 'lake-day', null)
    })

    it('a blocked or dropped request only offers a retry, and reports nothing', async () => {
      await failWith({ fatal: true, code: 0, message: 'HLS fatal error: manifestLoadError' })
      expect(screen.queryByText('Media unavailable')).not.toBeInTheDocument()
      expect(m.report).not.toHaveBeenCalled()
      await act(async () => { screen.getByRole('button', { name: 'Retry playback' }).click() })
      expect(screen.queryByRole('button', { name: 'Retry playback' })).not.toBeInTheDocument()
    })

    it('a server error is treated as a transport problem too', async () => {
      await failWith({ fatal: true, code: 503, message: 'x' })
      expect(screen.getByRole('button', { name: 'Retry playback' })).toBeInTheDocument()
      expect(m.report).not.toHaveBeenCalled()
    })

    it('ignores errors the player recovers from by itself', async () => {
      await failWith({ fatal: false, code: 404 })
      expect(screen.queryByText('Media unavailable')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry playback' })).not.toBeInTheDocument()
    })
  })

  describe('with the player attached', () => {
    beforeEach(() => { m.player = fakePlayer() })
    afterEach(() => localStorage.clear())

    it('loads the video once the post says it is not members-only', async () => {
      mount()
      await waitFor(() => expect(m.load).toHaveBeenCalledWith('badadib/lake-day'))
      expect(m.load).toHaveBeenCalledTimes(1)
    })

    it('a source that cannot be resolved at all marks the video unavailable and reports it', async () => {
      m.load = vi.fn(async () => { throw new Error('no stream') })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mount()
      expect(await screen.findByText('Media unavailable')).toBeInTheDocument()
      expect(m.report).toHaveBeenCalledWith('badadib', 'lake-day', null)
    })

    it('on ready, restores the saved mute, volume and preferred quality', async () => {
      localStorage.setItem('3speak-muted', '1')
      localStorage.setItem('3speak-volume', '0.4')
      localStorage.setItem('3speak-quality-pref', '720')
      mount()
      await waitFor(() => expect(m.player.handlers.ready).toBeTypeOf('function'))
      m.player.element = document.createElement('video')
      Object.defineProperty(m.player.element, 'readyState', { value: 4 })
      m.player.emit('ready', { isVertical: true })
      expect(m.player.setMuted).toHaveBeenCalledWith(true)
      expect(m.player.setVolume).toHaveBeenCalledWith(0.4)
      expect(m.player.setQuality).toHaveBeenCalledWith(1)
      expect(m.player.play).toHaveBeenCalled()
    })

    it('a preferred quality above every rung picks the highest one below it, else the lowest', async () => {
      localStorage.setItem('3speak-quality-pref', '600')
      mount()
      await waitFor(() => expect(m.player.handlers.ready).toBeTypeOf('function'))
      m.player.emit('ready', { isVertical: false })
      expect(m.player.setQuality).toHaveBeenLastCalledWith(2)
      localStorage.setItem('3speak-quality-pref', '240')
      m.player.emit('ready', { isVertical: false })
      expect(m.player.setQuality).toHaveBeenLastCalledWith(2)
    })

    it('in a playlist, the end of a video moves on to the next one in it', async () => {
      const playlist = { id: 'pl-1', name: 'Best of' }
      const videos = [{ author: 'badadib', permlink: 'lake-day' }, { author: 'badadib', permlink: 'forest-day' }]
      renderWithProviders(<Watch />, {
        route: { pathname: '/watch', search: '?v=badadib/lake-day&playlist=pl-1&pos=0', state: { playlist, videos, currentIndex: 0 } },
        path: '/watch',
      })
      expect(await screen.findByText('Playlist Best of, video 1 of 2')).toBeInTheDocument()
      await waitFor(() => expect(m.player.handlers.ended).toBeTypeOf('function'))
      m.player.emit('ended')
      expect(screen.getByTestId('location')).toHaveTextContent('/@badadib/forest-day?playlist=pl-1&pos=1')
    })

    it('an "ended" in the middle of a video (an emptied buffer) is not a real end', async () => {
      const playlist = { id: 'pl-1', name: 'Best of' }
      const videos = [{ author: 'badadib', permlink: 'lake-day' }, { author: 'badadib', permlink: 'forest-day' }]
      renderWithProviders(<Watch />, {
        route: { pathname: '/watch', search: '?v=badadib/lake-day&playlist=pl-1&pos=0', state: { playlist, videos, currentIndex: 0 } },
        path: '/watch',
      })
      await screen.findByText('Playlist Best of, video 1 of 2')
      const el = document.querySelector('video')
      Object.defineProperty(el, 'duration', { value: 300, configurable: true })
      Object.defineProperty(el, 'currentTime', { value: 120, configurable: true })
      m.player.emit('ended')
      expect(screen.getByTestId('location')).toHaveTextContent('/watch?v=badadib/lake-day')
    })
  })
})
