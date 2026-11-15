// Highlight clips that become Shorts (H13): the post-stream list of clips and
// moments, the fresh-clip sheet, and the hook that hands a clip to the Shorts
// upload with the other side's locked share. The hangouts server is a stand-in.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import { useAppStore } from '../../../src/lib/store'

const h = vi.hoisted(() => ({ post: vi.fn(), embed: {}, navigate: vi.fn() }))
vi.mock('../../../src/hooks/usePostClipAsShort', async (orig) => {
  const real = await orig()
  return { ...real, usePostClipAsShort: () => ({ post: h.post, busy: false }), __real: real.usePostClipAsShort }
})

const { default: StreamHighlightsPanel } = await import('../../../src/components/openpods/StreamHighlightsPanel.jsx')
const { default: ClipReadyModal } = await import('../../../src/components/openpods/ClipReadyModal.jsx')

const API = 'https://live.3speak.tv'
const clip = (over = {}) => ({ id: 'c1', room: 'badadib-r1', host: 'badadib', clipper: 'fan', source: 'viewer', path: '/dvr/clips/c1.mp4', offsetSec: 754, durationSec: 30, reasons: [], ...over })
let answer
beforeEach(() => {
  h.post.mockReset().mockResolvedValue(true)
  useAppStore.setState({ user: 'badadib' })
  answer = { host: 'badadib', isHost: true, liveAt: null, moments: [{ at: 1, offsetSec: 600, reasons: ['chat'] }], clips: [clip(), clip({ id: 'c2', clipper: null, source: 'auto', reasons: ['big_boost'], offsetSec: 900 })] }
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/highlights')) return { ok: true, status: 200, json: async () => answer }
    if (init?.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ deleted: true }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('StreamHighlightsPanel', () => {
  it('shows the host every clip with who made it, the clipper\'s share, and moments as replay Shorts', async () => {
    renderWithProviders(<StreamHighlightsPanel api={API} room="badadib-r1" token="tok" />)
    expect(await screen.findByText('Clipped by @fan')).toBeInTheDocument()
    expect(screen.getByText('Highlight')).toBeInTheDocument()
    expect(screen.getByText('Big boost')).toBeInTheDocument()
    expect(screen.getByText('at 12:34')).toBeInTheDocument()
    expect(screen.getByText('@fan made this clip and gets 30% of the Short\'s rewards.')).toBeInTheDocument()
    const make = screen.getByRole('link', { name: /Make a Short/ })
    expect(make).toHaveAttribute('href', '/@badadib/badadib-r1?t=555&short=555-605')
    expect(fetch).toHaveBeenCalledWith(`${API}/rooms/badadib-r1/highlights`, { headers: { Authorization: 'Bearer tok' } })
  })

  it('Post as Short hands the clip to the Shorts upload; Delete asks and removes it', async () => {
    const { user } = renderWithProviders(<StreamHighlightsPanel api={API} room="badadib-r1" token="tok" />)
    await screen.findByText('Clipped by @fan')
    await user.click(screen.getAllByRole('button', { name: /Post as Short/ })[0])
    expect(h.post).toHaveBeenCalledWith({ url: `${API}/dvr/clips/c1.mp4`, room: 'badadib-r1', host: 'badadib', clipper: 'fan', offsetSec: 754 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => expect(screen.queryByText('Clipped by @fan')).not.toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(`${API}/clips/c1`, { method: 'DELETE', headers: { Authorization: 'Bearer tok' } })
  })

  it('a viewer sees their own clip and the host\'s 50 %; compact hides an empty list', async () => {
    useAppStore.setState({ user: 'fan' })
    answer = { host: 'badadib', isHost: false, moments: [], clips: [clip()] }
    renderWithProviders(<StreamHighlightsPanel api={API} room="badadib-r1" token="tok" />)
    expect(await screen.findByText('Your clip')).toBeInTheDocument()
    expect(screen.getByText('@badadib gets 50% of the Short\'s rewards: it is their stream.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Make a Short/ })).not.toBeInTheDocument()

    answer = { host: 'badadib', isHost: true, moments: [], clips: [] }
    const { container } = renderWithProviders(<StreamHighlightsPanel api={API} room="other" token="tok" compact />)
    await waitFor(() => expect(container.querySelector('.stream-highlights')).toBeNull())
  })

  it('without a session it asks to log in; an error says so', async () => {
    renderWithProviders(<StreamHighlightsPanel api={API} room="r" token={null} />)
    expect(await screen.findByText('Log in to post clips as Shorts.')).toBeInTheDocument()
    fetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    renderWithProviders(<StreamHighlightsPanel api={API} room="r" token="tok" />)
    expect(await screen.findByText('Clips could not be loaded right now.')).toBeInTheDocument()
  })
})

describe('clips cut after the stream (no DVR)', () => {
  it('the host\'s end screen counts clips per viewer, says they are being cut, and shows pending ones as waiting', async () => {
    answer = { host: 'badadib', isHost: true, moments: [], clips: [
      clip({ id: 'p1', status: 'pending', path: null, vertical: { available: false } }),
      clip({ id: 'p2', status: 'pending', path: null }),
      clip({ id: 'a1', clipper: null, source: 'auto', status: 'pending', path: null }),
      clip({ id: 'u1', clipper: 'late', status: 'unavailable', reason: 'past_cap', path: null }),
      clip({ id: 'r1', clipper: 'badadib', source: 'host' }),
    ] }
    renderWithProviders(<StreamHighlightsPanel api={API} room="badadib-r1" token="tok" compact />)
    expect(await screen.findByText('4 clips from your stream')).toBeInTheDocument()
    expect(screen.getByText('@fan: 2 · @badadib: 1 · Automatic: 1')).toBeInTheDocument()
    expect(screen.getByText(/They are cut from the recording now/)).toBeInTheDocument()
    expect(screen.getAllByText('Ready after the stream')).toHaveLength(3)
    expect(screen.getByText('After the free 30 minutes')).toBeInTheDocument()
    // Only the ready clip can be posted.
    expect(screen.getAllByRole('button', { name: /Post as Short/ })).toHaveLength(1)
  })
})

describe('ClipReadyModal', () => {
  it('offers Post as Short with the host\'s share to a signed-in viewer', async () => {
    useAppStore.setState({ user: 'fan' })
    const onClose = vi.fn()
    const { user } = renderWithProviders(<ClipReadyModal open url={`${API}/dvr/clips/c1.mp4`} clip={clip()} room="badadib-r1" onClose={onClose} />)
    expect(screen.getByText('Your clip is ready')).toBeInTheDocument()
    expect(screen.getByText('@badadib gets 50% of the Short\'s rewards: it is their stream.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All your clips of this stream' })).toHaveAttribute('href', '/live/clips/badadib-r1')
    await user.click(screen.getByRole('button', { name: /Post as Short/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(h.post).toHaveBeenCalledWith(expect.objectContaining({ host: 'badadib', clipper: 'fan', room: 'badadib-r1' }))
  })

  it('a pending clip says it will be ready when the stream ends, and leads to Your stream clips', () => {
    useAppStore.setState({ user: 'fan' })
    renderWithProviders(<ClipReadyModal open url={null} clip={clip({ status: 'pending', path: null })} room="badadib-r1" onClose={() => {}} />)
    expect(screen.getByText('Your clip will be ready when the stream ends')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Your stream clips/ })).toHaveAttribute('href', '/clips')
    expect(screen.queryByRole('button', { name: /Post as Short/ })).not.toBeInTheDocument()
  })

  it('an unavailable clip says why', () => {
    renderWithProviders(<ClipReadyModal open url={null} clip={clip({ status: 'unavailable', reason: 'no_recording', path: null })} room="r" onClose={() => {}} />)
    expect(screen.getByText('The stream was not recorded')).toBeInTheDocument()
  })

  it('logged out: only Download, and a note to log in', () => {
    useAppStore.setState({ user: null })
    renderWithProviders(<ClipReadyModal open url={`${API}/dvr/clips/c1.mp4`} clip={clip({ clipper: null })} room="r" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /Post as Short/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument()
    expect(screen.getByText('Log in to post clips as Shorts.')).toBeInTheDocument()
  })
})
