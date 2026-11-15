// @vitest-environment jsdom
/**
 * The watch history page (/watched/:username), Audio tab: 3Speak audio plays in
 * the global player, an outside podcast episode shows its show and cover and opens
 * in the podcast player, and both show how far the listener got.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

vi.mock('sonner', async () => (await import('../components/_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/watchHistory', () => ({ deleteWatchHistoryEntry: vi.fn(async () => true) }))

const { default: WatchedView } = await import('../../../src/page/WatchedView.jsx')
const { useAppStore } = await import('../../../src/lib/store')
const { deleteWatchHistoryEntry } = await import('../../../src/utils/watchHistory')

const EP = '6aeb69e6696f90cea1328cc7:woMAUv9ELz6UQDwM'
const now = Math.floor(Date.now() / 1000)
const page = {
  success: true,
  totalPages: 1,
  counts: { videos: 4, shorts: 0, audio: 2 },
  videos: [
    {
      _id: EP, external: true, owner: '', title: 'An outside episode', show: 'A show', show_id: '6aeb69e6696f90cea1328cc7',
      thumbnail_url: 'https://example.com/show.jpg', art: 'tok.abc', duration: 5130,
      progress: { pos: 2565, dur: 5130, done: false }, _audio: true, _podcast: true, _historyKey: `_podcast/${EP}`, watched_at: now - 60,
    },
    {
      _id: '6a0000000000000000000001', owner: 'badadib', permlink: 'abc123', title: 'A 3Speak track', thumbnail_url: '',
      duration: 300, progress: { pos: 300, dur: 300, done: true }, _audio: true, _historyKey: 'badadib/abc123', watched_at: now - 120,
    },
  ],
}

let fetchSpy
beforeEach(() => {
  useAppStore.setState({ user: 'badadib', watchHistoryEnabled: true, audioPlay: vi.fn(), audioQueueIfPlaying: () => false })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('type=audio') ? page : { success: true, counts: page.counts, videos: [], totalPages: 1 }),
  }))
})
afterEach(() => fetchSpy.mockRestore())

const openAudio = async (user) => {
  await user.click(await screen.findByRole('tab', { name: /Audio/ }))
  return screen.findByText('An outside episode')
}

describe('WatchedView, Audio tab', () => {
  it('counts the listens in the tab', async () => {
    renderWithProviders(<WatchedView />, { route: '/watched/badadib', path: '/watched/:username' })
    expect(await screen.findByRole('tab', { name: /Audio.*2/ })).toBeTruthy()
  })

  it('an outside episode: show name, cover, opens the episode in the podcast player, progress bar', async () => {
    const { user } = renderWithProviders(<WatchedView />, { route: '/watched/badadib', path: '/watched/:username' })
    const title = await openAudio(user)
    const link = title.closest('a')
    expect(link.getAttribute('href')).toBe(`/audio?type=external&episode=${encodeURIComponent(EP)}`)
    expect(within(link).getByText(/^A show · /)).toBeTruthy()
    expect(link.querySelector('img').getAttribute('src')).toMatch(/\/art\/tok\.abc\/256\.jpg$/)
    expect(link.querySelector('.watched-row__progress span').style.width).toBe('50%')
  })

  it('a 3Speak track plays in the global player with only 3Speak tracks queued after it', async () => {
    const { user } = renderWithProviders(<WatchedView />, { route: '/watched/badadib', path: '/watched/:username' })
    await openAudio(user)
    const btn = screen.getByText('A 3Speak track').closest('button')
    expect(within(btn).getByText(/^@badadib · /)).toBeTruthy()
    expect(btn.querySelector('.watched-row__progress span').style.width).toBe('100%')
    await user.click(btn)
    const [item, context] = useAppStore.getState().audioPlay.mock.calls[0]
    expect(item.permlink).toBe('abc123')
    expect(context.map((v) => v._historyKey)).toEqual(['badadib/abc123'])
  })

  it('removing an outside episode deletes its history key', async () => {
    const { user } = renderWithProviders(<WatchedView />, { route: '/watched/badadib', path: '/watched/:username' })
    await openAudio(user)
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(deleteWatchHistoryEntry).toHaveBeenCalledWith('badadib', '_podcast', EP)
  })
})
