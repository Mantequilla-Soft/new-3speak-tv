// /clips, "Your stream clips" (H13): clips you made and clips of your streams,
// from the hangouts server (stand-in), picked and posted as Shorts one by one.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'
import { useAppStore } from '../../../src/lib/store'

const h = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../../../src/hooks/usePostClipAsShort', () => ({ usePostClipAsShort: () => ({ post: h.post, busy: false }) }))
vi.mock('../../../src/context/HangoutContext', () => ({ useHangout: () => ({ sessionToken: 'tok' }) }))
vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ getHangoutsEndpoints: () => [{ api: 'https://live.3speak.tv' }], defaultEndpoint: () => ({ api: 'https://live.3speak.tv' }) }))

const { default: StreamClipsHome } = await import('../../../src/page/StreamClipsHome.jsx')
const API = 'https://live.3speak.tv'
const clip = (over) => ({ room: 'badadib-r1', host: 'badadib', clipper: 'fan', source: 'viewer', status: 'ready', path: `/dvr/clips/${over.id}.mp4`, offsetSec: 60, vertical: { available: false, path: null }, createdAt: '2026-11-15T12:00:00Z', ...over })

beforeEach(() => {
  localStorage.clear()
  h.post.mockReset().mockResolvedValue(true)
  useAppStore.setState({ user: 'badadib' })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ keepHours: 48, clips: [
    clip({ id: 'c1' }), clip({ id: 'c2', clipper: null, source: 'auto' }), clip({ id: 'c3', status: 'pending', path: null }),
    clip({ id: 'c4', room: 'other-r', host: 'other', clipper: 'badadib' }),
  ] }) })))
})
afterEach(() => vi.unstubAllGlobals())

describe('Your stream clips', () => {
  it('groups by stream, shows how long clips are kept, waiting clips as pending', async () => {
    renderWithProviders(<StreamClipsHome />)
    expect(await screen.findByText('Clips you made and clips of your streams. Clips are kept for 48 hours.')).toBeInTheDocument()
    expect(screen.getByText('Your stream')).toBeInTheDocument()
    expect(screen.getByText("@other's stream")).toBeInTheDocument()
    expect(screen.getByText('Ready after the stream')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(fetch).toHaveBeenCalledWith(`${API}/clips/mine`, { headers: { Authorization: 'Bearer tok' } })
  })

  it('posts the selected clips one after the other: the first now, the rest from the queue', async () => {
    const { user } = renderWithProviders(<StreamClipsHome />)
    await screen.findByText('Your stream')
    const boxes = screen.getAllByRole('checkbox')
    await user.click(boxes[0])
    await user.click(boxes[1])
    await user.click(screen.getByRole('button', { name: /Post selected as Shorts \(2\)/ }))
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1))
    expect(h.post.mock.calls[0][0]).toMatchObject({ url: `${API}/dvr/clips/c1.mp4`, host: 'badadib', clipper: 'fan', room: 'badadib-r1' })
    expect(JSON.parse(localStorage.getItem('3s-clip-post-queue')).map((c) => c.id)).toEqual(['c2'])
    await user.click(screen.getByRole('button', { name: /Post the next one \(1 left\)/ }))
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2))
    expect(h.post.mock.calls[1][0]).toMatchObject({ url: `${API}/dvr/clips/c2.mp4`, clipper: null })
    expect(localStorage.getItem('3s-clip-post-queue')).toBeNull()
  })

  it('empty, and logged out', async () => {
    fetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ clips: [] }) }))
    renderWithProviders(<StreamClipsHome />)
    expect(await screen.findByText(/No clips yet/)).toBeInTheDocument()
    useAppStore.setState({ user: null })
    renderWithProviders(<StreamClipsHome />)
    expect(screen.getAllByText('Log in to post clips as Shorts.').length).toBeGreaterThan(0)
  })
})
