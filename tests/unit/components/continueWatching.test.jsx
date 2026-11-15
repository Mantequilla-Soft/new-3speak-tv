// Continue watching on Home (components/ContinueWatching): the strip only for a
// viewer the checker says is opted in, the cards open where the video was left,
// and the x takes one off the strip with Undo.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const fetchContinueWatching = vi.hoisted(() => vi.fn())
const hideFromContinueWatching = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/continueWatching', () => ({ fetchContinueWatching, hideFromContinueWatching }))
const success = vi.hoisted(() => vi.fn())
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success, error }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: ContinueWatching } = await import('../../../src/components/ContinueWatching/ContinueWatching.jsx')

const video = (permlink, position, duration) => ({
  author: 'badadib', permlink, title: `Video ${permlink}`, images: { thumbnail: 'https://img.3speak.tv/x/thumbnail.png' },
  _progressKey: `badadib/asset-${permlink}`,
  progress: { position, duration, pct: Math.round((position / duration) * 1000) / 10, at: new Date().toISOString() },
})

beforeEach(() => {
  fetchContinueWatching.mockReset()
  hideFromContinueWatching.mockReset()
  success.mockReset()
  error.mockReset()
  useAppStore.setState({ authenticated: true, user: 'fan' })
})

describe('continue watching', () => {
  it('shows nothing when the viewer is not opted into viewer rewards', async () => {
    fetchContinueWatching.mockResolvedValue({ enabled: false, videos: [] })
    const { container } = renderWithProviders(<ContinueWatching />)
    await waitFor(() => expect(fetchContinueWatching).toHaveBeenCalledWith('fan'))
    expect(container.querySelector('.continue-watching')).toBeNull()
  })

  it('nothing signed out, and the checker is not asked', () => {
    useAppStore.setState({ authenticated: false, user: null })
    const { container } = renderWithProviders(<ContinueWatching />)
    expect(container.querySelector('.continue-watching')).toBeNull()
    expect(fetchContinueWatching).not.toHaveBeenCalled()
  })

  it('folded to the summary, Show opens the cards with where each was left', async () => {
    fetchContinueWatching.mockResolvedValue({ enabled: true, videos: [video('a', 120, 600), video('b', 300, 1200)] })
    const { user } = renderWithProviders(<ContinueWatching />)
    expect(await screen.findByText('2 videos')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show' }))
    const links = screen.getAllByRole('link')
    // A few seconds back from the spot it was left.
    expect(links[0]).toHaveAttribute('href', '/@badadib/a?t=117')
    expect(links[1]).toHaveAttribute('href', '/@badadib/b?t=297')
    expect(within(links[0]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    expect(within(links[0]).getByText('@badadib · 8 min left')).toBeInTheDocument()
  })

  it('the x takes one off at once, and Undo puts it back', async () => {
    hideFromContinueWatching.mockResolvedValue()
    fetchContinueWatching.mockResolvedValue({ enabled: true, videos: [video('a', 120, 600), video('b', 300, 1200)] })
    const { user } = renderWithProviders(<ContinueWatching />)
    await user.click(await screen.findByRole('button', { name: 'Show' }))
    await user.click(screen.getAllByRole('button', { name: 'Remove from Continue watching' })[0])

    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('1 video')).toBeInTheDocument()
    expect(hideFromContinueWatching).toHaveBeenCalledWith('fan', 'badadib/asset-a')
    await waitFor(() => expect(success).toHaveBeenCalled())

    success.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2))
    expect(hideFromContinueWatching).toHaveBeenLastCalledWith('fan', 'badadib/asset-a', false)
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/@badadib/a?t=117')
  })

  it('puts it straight back when the checker refuses', async () => {
    hideFromContinueWatching.mockRejectedValue(new Error('500'))
    fetchContinueWatching.mockResolvedValue({ enabled: true, videos: [video('a', 120, 600)] })
    const { user } = renderWithProviders(<ContinueWatching />)
    await user.click(await screen.findByRole('button', { name: 'Show' }))
    await user.click(screen.getByRole('button', { name: 'Remove from Continue watching' }))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
