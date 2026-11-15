// @vitest-environment jsdom
// A sound's page (src/page/SoundPage.jsx, /sound/:id): the sound, its original
// Short, the Shorts using it, trending sounds, and "Use this sound", which opens
// the shorts editor with the sound and its credit.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ sound: null, trending: [], settings: {}, track: null }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({ ...(await importOriginal()), FEATURE_EDITOR: true }))
vi.mock('../../../src/lib/sounds', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSound: vi.fn(async () => m.sound),
  fetchTrendingSounds: vi.fn(async () => m.trending),
}))
vi.mock('../../../src/lib/videoAsAudio', () => ({
  videoAudioTrack: vi.fn(async () => m.track),
  playVideoAsAudio: vi.fn(async () => m.track),
}))
vi.mock('../../../src/utils/creatorSettings', () => ({
  creatorKey: (u) => u, getCreatorSettings: async () => m.settings, isUploadBlocked: (s) => s?.canUpload === false,
}))
// The Shorts grid is the app's own card grid, tested on its own: here a list of titles.
vi.mock('../../../src/components/Cards/Card3', () => ({
  default: ({ videos }) => <ul data-testid="grid">{videos.map((v) => <li key={v.permlink}>{v.title} ({v.author}/{v.permlink})</li>)}</ul>,
}))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const videoAsAudio = await import('../../../src/lib/videoAsAudio')
const { default: SoundPage } = await import('../../../src/page/SoundPage.jsx')

const SHORT_SOUND = {
  success: true,
  sound: { id: 'short_badadib_orig-1', kind: 'short', title: 'My beat', artist: '@badadib', account: 'badadib' },
  original: { author: 'badadib', permlink: 'orig-1', owner: 'badadib', embed_permlink: 'o1', title: 'My beat', thumbnail_url: null },
  uses: 2,
  shorts: [
    { author: 'fan', permlink: 'use-2', owner: 'fan', embed_permlink: 'u2', title: 'Use two', thumbnail_url: null },
    { author: 'fan', permlink: 'use-1', owner: 'fan', embed_permlink: 'u1', title: 'Use one', thumbnail_url: null },
  ],
}

let opened
const onOpen = (e) => opened.push(e.detail)
const mount = (id = 'short_badadib_orig-1') => renderWithProviders(<SoundPage />, { route: `/sound/${id}`, path: '/sound/:id' })

beforeEach(() => {
  opened = []
  m.sound = SHORT_SOUND
  m.trending = []
  m.settings = {}
  m.track = { _id: 'video:badadib/o1', src: 'https://play.example/hls?u=480' }
  act(() => useAppStore.setState({ user: 'fan', incubationHandle: null }))
  window.addEventListener('open-shorts-editor', onOpen)
})
afterEach(() => {
  window.removeEventListener('open-shorts-editor', onOpen)
  vi.clearAllMocks()
})

describe('a sound page', () => {
  it('shows the sound, how many Shorts use it, the original and the Shorts using it', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'My beat' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '@badadib' })).toHaveAttribute('href', '/@badadib')
    expect(screen.getByText('2 Shorts use it')).toBeInTheDocument()
    expect(screen.getByText('Shorts made with this sound give @badadib 5% of their rewards.')).toBeInTheDocument()
    const grids = screen.getAllByTestId('grid')
    expect(grids[0]).toHaveTextContent('My beat (badadib/o1)')
    expect(grids[1]).toHaveTextContent('Use two (fan/u2)')
    expect(grids[1]).toHaveTextContent('Use one (fan/u1)')
  })

  it('"Use this sound" opens the editor with the original\'s audio and the credit that pays its creator', async () => {
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Use this sound' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0].sound).toEqual({
      url: 'https://play.example/hls?u=480',
      name: 'My beat',
      credit: { id: 'short_badadib_orig-1', title: 'My beat', artist: '@badadib', source: '3speak', account: 'badadib', sourceUrl: 'https://3speak.tv/sound/short_badadib_orig-1' },
    })
  })

  it('a library song plays its own file and is handed to the editor as it is', async () => {
    m.sound = { success: true, sound: { id: 'lib-carefree', kind: 'library', title: 'Carefree', artist: 'Kevin MacLeod', source: 'incompetech.com', license: 'CC BY 4.0', audio_url: 'https://editor.example/music/carefree.mp3' }, original: null, uses: 0, shorts: [] }
    const { user } = mount('lib-carefree')
    expect(await screen.findByText('No Shorts with this sound yet')).toBeInTheDocument()
    expect(screen.getByText('License: CC BY 4.0')).toBeInTheDocument()
    expect(document.querySelector('audio')).toHaveAttribute('src', 'https://editor.example/music/carefree.mp3')
    await user.click(screen.getByRole('button', { name: 'Use this sound' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0].sound.url).toBe('https://editor.example/music/carefree.mp3')
    expect(opened[0].sound.credit).toMatchObject({ id: 'lib-carefree', title: 'Carefree', source: 'incompetech.com' })
  })

  it('Listen plays a Short\'s sound in the audio player', async () => {
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Listen' }))
    expect(videoAsAudio.playVideoAsAudio).toHaveBeenCalledWith(expect.objectContaining({ author: 'badadib', permlink: 'o1' }), expect.any(Object))
  })

  it('signed out, or blocked from uploading: no editor', async () => {
    act(() => useAppStore.setState({ user: null }))
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Use this sound' }))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Sign in to make a Short with this sound.']))
    act(() => useAppStore.setState({ user: 'fan' }))
    m.settings = { canUpload: false }
    await user.click(screen.getByRole('button', { name: 'Use this sound' }))
    await act(async () => {})
    expect(opened).toEqual([])
  })

  it('an unknown sound, or a bad address, says so', async () => {
    m.sound = null
    mount('lib-nothing')
    expect(await screen.findByText('This sound could not be found')).toBeInTheDocument()
  })

  it('lists trending sounds other than this one', async () => {
    m.trending = [{ id: 'short_badadib_orig-1', title: 'My beat', uses: 2 }, { id: 'lib-carefree', title: 'Carefree', uses: 5 }]
    mount()
    const link = await screen.findByRole('link', { name: /Carefree/ })
    expect(link).toHaveAttribute('href', '/sound/lib-carefree')
    expect(screen.queryByRole('link', { name: /^My beat/ })).not.toBeInTheDocument()
  })
})
