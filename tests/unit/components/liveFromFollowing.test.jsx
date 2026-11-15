// "Live now from people you follow" on Home (components/LiveFromFollowing): only
// while someone followed is live, one chip per host to its watch page, and
// creators set to Off stay out. The live list and the levels are stand-ins.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ streams: [], levels: {} }))
vi.mock('../../../src/hooks/useLiveStreams', () => ({ useLiveStreams: () => h.streams }))
vi.mock('../../../src/lib/notifyLevels', async (orig) => ({ ...(await orig()), useNotifyLevels: () => h.levels }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: LiveFromFollowing } = await import('../../../src/components/LiveFromFollowing/LiveFromFollowing.jsx')

const live = (author, roomName, title) => ({ _liveStream: true, author, roomName, title })

beforeEach(() => {
  h.streams = []
  h.levels = {}
  useAppStore.setState({ authenticated: true, user: 'fan' })
})

describe('Live now from people you follow', () => {
  it('shows nothing when nobody followed is live', () => {
    const { container } = renderWithProviders(<LiveFromFollowing />)
    expect(container.querySelector('.live-from-following')).toBeNull()
  })

  it('one chip per live host, linking to the stream', () => {
    h.streams = [live('badadib', 'room-1', 'Building in public'), live('badadib', 'room-0', 'Older'), live('quiet', 'q', 'Quiet hour')]
    renderWithProviders(<LiveFromFollowing />)
    expect(screen.getByText('2 people you follow are live now')).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/watch/room-1', '/watch/q'])
  })

  it('leaves out creators set to Off', () => {
    h.streams = [live('badadib', 'room-1', 'x'), live('quiet', 'q', 'y')]
    h.levels = { quiet: 'off' }
    renderWithProviders(<LiveFromFollowing />)
    expect(screen.getByText('1 person you follow is live now')).toBeInTheDocument()
  })

  it('nothing signed out', () => {
    h.streams = [live('badadib', 'room-1', 'x')]
    useAppStore.setState({ authenticated: false, user: null })
    const { container } = renderWithProviders(<LiveFromFollowing />)
    expect(container.querySelector('.live-from-following')).toBeNull()
  })
})
