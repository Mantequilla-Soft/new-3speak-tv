// @vitest-environment jsdom
/**
 * The Follow Feed's "Sort by" select (page/FollowFeed): Recommended asks the
 * checker for its ranking, Newest first adds ?chrono=1, and the choice is kept
 * in the persisted app store for the next visit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

vi.mock('sonner', async () => (await import('../components/_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('axios', async (importOriginal) => {
  const real = (await importOriginal()).default
  return { default: Object.assign(Object.create(real), { create: real.create.bind(real), get: vi.fn() }) }
})
vi.mock('../../../src/hooks/useLiveStreams', () => ({ useLiveStreams: () => [] }))
vi.mock('../../../src/hooks/useContentBatch', () => ({ useContentBatch: () => ({ getContentForVideo: () => null }) }))
vi.mock('../../../src/hooks/useWatchHistory', () => ({ useWatchHistory: () => ({ isWatched: () => false }) }))
vi.mock('../../../src/hooks/useViewCounts', () => ({ default: () => ({ getViewCount: () => 0 }) }))
vi.mock('../../../src/components/PopularCreators/PopularCreators', () => ({ default: () => null }))
vi.mock('../../../src/components/PullToRefresh/PullToRefresh', () => ({ default: ({ children }) => children }))
vi.mock('../../../src/components/Cards/Card3', () => ({
  default: ({ videos }) => <ul>{videos.map((v) => <li key={v.permlink}>{v.title}</li>)}</ul>,
}))

const { default: axios } = await import('axios')
const { default: FollowFeed } = await import('../../../src/page/FollowFeed.jsx')
const { useAppStore } = await import('../../../src/lib/store')

const lastUrl = () => axios.get.mock.calls.at(-1)[0]

beforeEach(() => {
  axios.get.mockReset()
  axios.get.mockResolvedValue({ data: { page: 1, totalPages: 1, videos: [{ author: 'badadib', permlink: 'abc', title: 'A video' }] } })
  useAppStore.setState({ user: 'badadib', followFeedSort: 'recommended' })
})

describe('Follow Feed sort', () => {
  it('Recommended asks for the ranked feed', async () => {
    renderWithProviders(<FollowFeed />)
    expect(await screen.findByText('A video')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('recommended')
    expect(lastUrl()).toContain('/badadib?')
    expect(lastUrl()).not.toContain('chrono=1')
  })

  it('Newest first refetches with chrono=1 and keeps the choice', async () => {
    const { user } = renderWithProviders(<FollowFeed />)
    await screen.findByText('A video')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'newest')
    await waitFor(() => expect(lastUrl()).toContain('chrono=1'))
    expect(useAppStore.getState().followFeedSort).toBe('newest')
    expect(JSON.parse(localStorage.getItem('user-store')).state.followFeedSort).toBe('newest')
  })

  it('opens on the saved order', async () => {
    useAppStore.setState({ followFeedSort: 'newest' })
    renderWithProviders(<FollowFeed />)
    await screen.findByText('A video')
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('newest')
    expect(lastUrl()).toContain('chrono=1')
  })

  it('no sort on the empty page', async () => {
    axios.get.mockResolvedValue({ data: { page: 1, totalPages: 0, videos: [] } })
    renderWithProviders(<FollowFeed />)
    expect(await screen.findByText('Nobody here yet')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull()
  })

  it('an unknown value falls back to Recommended', () => {
    useAppStore.getState().setFollowFeedSort('oldest')
    expect(useAppStore.getState().followFeedSort).toBe('recommended')
  })
})
