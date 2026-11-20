// The Live tab in Home's side panel (components/HomeActivity): while nobody is
// live it lists the newest stream recording of each creator (owner 2026-11-20),
// from the checker's /feeds/stream-vods, without the hidden house hosts.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const liveNow = vi.hoisted(() => ({ list: [] }))
const axiosGet = vi.hoisted(() => vi.fn())

vi.mock('axios', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: { ...real.default, get: axiosGet } }
})
vi.mock('../../../src/lib/snaps', () => ({ fetchCommunityFeed: async () => ({ snaps: [] }) }))
vi.mock('../../../src/lib/playlistsFeed', () => ({ fetchPlaylistsFeed: async () => ({ playlists: [] }) }))
vi.mock('../../../src/hooks/useLiveStreams', () => ({ useLiveStreams: () => liveNow.list }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: HomeActivity } = await import('../../../src/components/HomeActivity/HomeActivity.jsx')

const VODS = [
  { author: 'mes', permlink: 'math-74', title: 'MES Math Q/A 74', created: '2026-11-18T19:07:00Z', duration: 1830 },
  { author: 'badadib', permlink: 'house', title: 'house test', created: '2026-11-18T10:00:00Z', duration: 60 },
  { author: 'meno', permlink: 'coffee', title: 'Morning Coffee', created: '2026-08-04T14:08:00Z', duration: 0 },
]

const vodCalls = () => axiosGet.mock.calls.map(([u]) => u).filter((u) => u.includes('/feeds/stream-vods'))

describe('Home side panel: recent stream recordings on the Live tab', () => {
  beforeEach(() => {
    liveNow.list = []
    axiosGet.mockReset()
    axiosGet.mockImplementation(async (url) => (url.includes('/feeds/stream-vods') ? { data: { videos: VODS } } : { data: {} }))
    act(() => useAppStore.setState({ authenticated: true, user: 'alice', incubationHandle: null }))
  })

  it('nobody live: the note, then one recording per creator linking to its watch page', async () => {
    renderWithProviders(<HomeActivity />)
    expect(vodCalls()).toHaveLength(0) // not asked before the tab is opened
    fireEvent.click(screen.getByRole('tab', { name: 'Live' }))

    expect(screen.getByText('Nobody is live right now.')).toBeInTheDocument()
    expect(await screen.findByText('Recent streams')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MES Math Q/A 74' })).toHaveAttribute('href', '/watch?v=mes/math-74')
    expect(screen.getByRole('link', { name: 'Morning Coffee' })).toHaveAttribute('href', '/watch?v=meno/coffee')
    expect(screen.getByText('30:30')).toBeInTheDocument()
    expect(screen.queryByText('house test')).not.toBeInTheDocument()
    expect(vodCalls()[0]).toMatch(/currentuser=alice/)
  })

  it('someone live: their stream only, no recordings asked for', async () => {
    liveNow.list = [{ roomName: 'room1', author: 'bob', title: 'Bob live', views: 3, created_at: '2026-11-20T10:00:00Z' }]
    renderWithProviders(<HomeActivity />)
    fireEvent.click(screen.getByRole('tab', { name: /Live/ }))

    expect(screen.getByRole('link', { name: 'Bob live' })).toBeInTheDocument()
    expect(screen.queryByText('Recent streams')).not.toBeInTheDocument()
    expect(vodCalls()).toHaveLength(0)
  })
})
