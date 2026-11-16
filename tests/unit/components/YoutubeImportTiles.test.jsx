// @vitest-environment jsdom
// The import page's tiles (src/page/YoutubeImportPage.jsx): a click ticks a tile
// (red frame), one ticked item can go to the uploader, a tile already on 3Speak
// opens its post. The importer API is a stand-in.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/lib/youtubeImport', async (importOriginal) => ({
  ...(await importOriginal()),
  getImportStatus: vi.fn(async () => ({
    user: 'alice', channels: [], links: { rss: ['https://testfeed.okinoko.io/feed.xml'] }, sources: ['youtube', 'rss'],
    limits: { maxDurationS: 1800, podcastMaxDurationS: 14400, maxHeight: 480, baseHeight: 480, premiumHeight: 1080 },
    imported: { 'rss:CCCCCCCCCCCCCCCC': 'old-post' }, inBatch: {},
  })),
  getImportBatches: vi.fn(async () => ({ max: 5, spacingMin: 30, granted: true, audio: true, batches: [] })),
  getAutoImports: vi.fn(async () => ({ available: true, intervalMin: 15, maxPerDay: 5, configs: [] })),
  listPodcastEpisodes: vi.fn(async () => ({
    shows: [{ url: 'https://testfeed.okinoko.io/feed.xml', id: '0123456789abcdef01234567', title: 'Test feed', code: null }],
    feedId: '0123456789abcdef01234567', page: 0, hasMore: false, total: 3,
    videos: ['A', 'B', 'C'].map((c, i) => ({ id: `rss:${c.repeat(16)}`, token: `t${i}`, platform: 'rss', title: `Episode ${i + 1}`, channelTitle: 'Test feed', duration: 60, thumbnail: '', type: 'podcast' })),
  })),
  startImportJob: vi.fn(async () => ({ id: 'job1', status: 'queued', progress: 0 })),
  getImportJob: vi.fn(async () => ({ id: 'job1', status: 'downloading', progress: 40 })),
}))

const { useAppStore } = await import('../../../src/lib/store')
const { startImportJob, getAutoImports } = await import('../../../src/lib/youtubeImport')
const { default: YoutubeImportPage } = await import('../../../src/page/YoutubeImportPage.jsx')

beforeEach(() => { vi.clearAllMocks(); useAppStore.setState({ user: 'alice', authenticated: true }) })
afterEach(() => useAppStore.setState({ user: null, authenticated: false }))

const open = () => renderWithProviders(<YoutubeImportPage />, { route: '/import?platform=rss', path: '/import' })
const tile = (name) => screen.getByRole('button', { name: new RegExp(name) })

describe('import tiles', () => {
  it('a click ticks a tile with a red frame, a second click unticks it', async () => {
    const { user } = open()
    await screen.findByText('Episode 1')
    await user.click(tile('Episode 1'))
    expect(tile('Episode 1')).toHaveAttribute('aria-pressed', 'true')
    expect(tile('Episode 1').closest('.yt-import__card')).toHaveClass('yt-import__card--picked')
    // No row opens: the page keeps its grid.
    expect(document.querySelector('.yt-import__card--selected')).toBeNull()
    expect(screen.getByRole('region', { name: '1 selected' })).toBeInTheDocument()
    await user.click(tile('Episode 1'))
    expect(tile('Episode 1')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: /selected/ })).toBeNull()
  })

  it('one ticked: it can go to the uploader, with its progress in a card above the list', async () => {
    const { user } = open()
    await screen.findByText('Episode 1')
    await user.click(tile('Episode 2'))
    const bar = screen.getByRole('region', { name: '1 selected' })
    await user.click(within(bar).getByRole('button', { name: 'Edit and publish' }))
    expect(startImportJob).toHaveBeenCalledWith(expect.objectContaining({ token: 't1' }))
    expect(document.getElementById('yt-import-single')).toHaveTextContent('Episode 2')
  })

  it('two ticked: only the batch import', async () => {
    const { user } = open()
    await screen.findByText('Episode 1')
    await user.click(tile('Episode 1'))
    await user.click(tile('Episode 2'))
    const bar = screen.getByRole('region', { name: '2 selected' })
    expect(within(bar).queryByRole('button', { name: 'Edit and publish' })).toBeNull()
    expect(within(bar).getByRole('button', { name: /Publish in the background \(2\)/ })).toBeEnabled()
  })

  it('a tile already on 3Speak opens its post instead', async () => {
    const { user } = open()
    await screen.findByText('Episode 3')
    await user.click(tile('Episode 3'))
    expect(screen.getByTestId('location')).toHaveTextContent('/@alice/old-post')
  })

  it('with automatic import on: a new episode waits for it, one it failed can be imported by hand', async () => {
    const before = getAutoImports.getMockImplementation()
    getAutoImports.mockImplementation(async () => ({
      available: true, intervalMin: 15, maxPerDay: 5,
      configs: [{
        feedUrl: 'https://testfeed.okinoko.io/feed.xml', feedId: '0123456789abcdef01234567', enabled: true,
        enabledAt: new Date(Date.now() - 3600 * 1000).toISOString(), baseline: [], failed: ['rss:BBBBBBBBBBBBBBBB'],
        settings: {}, options: {}, status: {},
      }],
    }))
    try {
      const { user } = open()
      await screen.findByText('Episode 1')
      // Episode 1 is new: the next check takes it, so it cannot be ticked.
      await vi.waitFor(() => expect(tile('Episode 1')).toBeDisabled())
      expect(tile('Episode 2')).toBeEnabled()
      await user.click(tile('Episode 2'))
      expect(tile('Episode 2')).toHaveAttribute('aria-pressed', 'true')
    } finally {
      getAutoImports.mockImplementation(before)
    }
  })
})
