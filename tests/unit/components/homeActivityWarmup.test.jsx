// The Warm-up tab in Home's side panel (components/HomeActivity): warm-up
// accounts see their goals first (owner 2026-11-12); everyone else does not
// get the tab at all.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('axios', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: { ...real.default, get: vi.fn(async () => ({ data: {} })) } }
})
vi.mock('../../../src/lib/snaps', () => ({ fetchCommunityFeed: async () => ({ snaps: [] }) }))
vi.mock('../../../src/lib/playlistsFeed', () => ({ fetchPlaylistsFeed: async () => ({ playlists: [] }) }))
vi.mock('../../../src/hooks/useLiveStreams', () => ({ useLiveStreams: () => [] }))
vi.mock('../../../src/lib/incubation', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    fetchIncubationProgress: async () => ({ track: 'creator', minCommentChars: 40, tasks: [
      { type: 'video', done: false, have: 1, need: 3 },
      { type: 'follow', done: true, have: 5, need: 5 },
    ] }),
    onIncubationProgress: () => () => {},
  }
})

const { useAppStore } = await import('../../../src/lib/store')
const { default: HomeActivity } = await import('../../../src/components/HomeActivity/HomeActivity.jsx')

const tabNames = () => screen.getAllByRole('tab').map((x) => x.textContent)

describe('Home side panel: Warm-up tab', () => {
  beforeEach(() => { act(() => useAppStore.setState({ authenticated: true, user: null, incubationHandle: null })) })

  it('a warm-up account gets Warm-up first, open, with its goals', async () => {
    act(() => useAppStore.setState({ incubationHandle: 'newbie' }))
    renderWithProviders(<HomeActivity />)
    expect(tabNames()[0]).toBe('Warm-up')
    expect(screen.getByRole('tab', { name: 'Warm-up' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('1 of 2 done')).toBeInTheDocument()
    expect(screen.getByText('Upload 3 videos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /See all/ })).toHaveAttribute('href', '/profile')
  })

  it('a Hive account has no Warm-up tab', () => {
    act(() => useAppStore.setState({ user: 'alice' }))
    renderWithProviders(<HomeActivity />)
    expect(tabNames()).not.toContain('Warm-up')
    expect(screen.getByRole('tab', { name: 'Community' })).toHaveAttribute('aria-selected', 'true')
  })
})
