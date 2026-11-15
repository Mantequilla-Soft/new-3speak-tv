// @vitest-environment jsdom
// The Downloads page (src/page/Downloads.jsx): videos and audio saved in this
// browser together, the room they take against the storage cap, the cap itself,
// running downloads, removing, and playing (audio in the global player, a video
// in the offline player).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({ state: null }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/hooks/useOnline', () => ({ default: () => true }))
vi.mock('../../../src/lib/podcastDownloads', async (importOriginal) => ({
  ...(await importOriginal()),
  useDownloads: () => m.state,
  cancelDownload: vi.fn(),
  removeDownload: vi.fn(async () => {}),
  pruneExpired: vi.fn(async () => 0),
  setDownloadCap: vi.fn(),
  partBlob: vi.fn(async () => null),
}))
vi.mock('../../../src/components/Downloads/OfflineVideoPlayer', () => ({
  default: ({ entry }) => <div data-testid="offline-player">{entry.id}</div>,
}))

const dl = await import('../../../src/lib/podcastDownloads')
const { useAppStore } = await import('../../../src/lib/store')
const { default: Downloads } = await import('../../../src/page/Downloads.jsx')

const GB = 1e9
const VIDEO = {
  id: 'dlvideo:badadib/test-stream', kind: 'video', bytes: 30 * 1024 ** 2, savedAt: 2, expiresAt: Date.now() + 10.5 * 86400000,
  track: { author: 'badadib', permlink: 'test-stream', title: 'Test stream', duration: 104 },
}
const EPISODE = { id: 'feed1:ep1', bytes: 5 * 1024 ** 2, savedAt: 1, track: { _id: 'feed1:ep1', external: true, title: 'Episode one', show: 'A show', duration: 600 } }

beforeEach(() => {
  m.state = { items: [VIDEO, EPISODE], progress: {}, usedBytes: VIDEO.bytes + EPISODE.bytes, estimate: null, cap: 2 * GB, ready: true }
  act(() => useAppStore.setState({ audioCurrent: null, audioIsPlaying: false }))
})
afterEach(() => { vi.clearAllMocks() })

describe('the Downloads page', () => {
  it('lists videos and audio together, with the room they take against the cap', () => {
    renderWithProviders(<Downloads />)
    expect(screen.getByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
    expect(screen.getByText('Test stream')).toBeInTheDocument()
    expect(screen.getByText('Episode one')).toBeInTheDocument()
    expect(screen.getByText(/expires in 10 days/)).toBeInTheDocument()
    expect(screen.getByText(/of 2(\.0)? GB used/)).toBeInTheDocument()
    expect(dl.pruneExpired).toHaveBeenCalled()
  })

  it('filters to videos or audio', async () => {
    const { user } = renderWithProviders(<Downloads />)
    await user.click(screen.getByRole('tab', { name: /Videos/ }))
    expect(screen.getByText('Test stream')).toBeInTheDocument()
    expect(screen.queryByText('Episode one')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Audio/ }))
    expect(screen.queryByText('Test stream')).not.toBeInTheDocument()
  })

  it('sets the storage cap', async () => {
    const { user } = renderWithProviders(<Downloads />)
    const cap = screen.getAllByRole('tablist', { name: 'Storage limit' })[0]
    await user.click(within(cap).getByRole('tab', { name: /^5(\.0)? GB$/ }))
    expect(dl.setDownloadCap).toHaveBeenCalledWith(5 * GB)
  })

  it('plays a video in the offline player and audio in the audio player', async () => {
    const audioPlayQueued = vi.fn()
    act(() => useAppStore.setState({ audioPlayQueued }))
    const { user } = renderWithProviders(<Downloads />)
    const plays = screen.getAllByRole('button', { name: 'Play' })
    await user.click(plays[0])
    expect(screen.getByTestId('offline-player')).toHaveTextContent('dlvideo:badadib/test-stream')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getAllByRole('button', { name: 'Play' })[1])
    expect(audioPlayQueued).toHaveBeenCalledWith(EPISODE.track)
  })

  it('removes a download, and cancels one that is running', async () => {
    m.state = { ...m.state, progress: { 'dlvideo:badadib/other': 0.42 } }
    const { user } = renderWithProviders(<Downloads />)
    expect(screen.getByText('Downloading 42%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel download' }))
    expect(dl.cancelDownload).toHaveBeenCalledWith('dlvideo:badadib/other')
    await user.click(screen.getAllByRole('button', { name: 'Remove download' })[0])
    expect(dl.removeDownload).toHaveBeenCalledWith(VIDEO.id)
  })

  it('says how to save something when nothing is saved', () => {
    m.state = { items: [], progress: {}, usedBytes: 0, estimate: null, cap: 2 * GB, ready: true }
    renderWithProviders(<Downloads />)
    expect(screen.getByText('Nothing saved yet')).toBeInTheDocument()
  })
})
