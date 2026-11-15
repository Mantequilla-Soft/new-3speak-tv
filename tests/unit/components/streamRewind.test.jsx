// Rewind during a live stream (H14): the Rewind tile appears while the host's
// DVR runs, opens the DVR playlist over the live picture, and Go live closes it.
// The hangouts server and hls.js are stand-ins.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ instances: [], supported: true }))
vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported() { return h.supported }
    static Events = { LEVEL_LOADED: 'hlsLevelLoaded', ERROR: 'hlsError' }
    constructor(opts) { this.opts = opts; this.handlers = {}; this.loadSource = vi.fn(); this.attachMedia = vi.fn(); this.destroy = vi.fn(); h.instances.push(this) }
    on(ev, fn) { this.handlers[ev] = fn }
  }
  return { default: FakeHls }
})

const { StreamRewindButton, StreamRewindPlayer } = await import('../../../src/components/openpods/StreamRewind.jsx')
const { useStreamRewind } = await import('../../../src/hooks/useStreamRewind.js')

const API = 'https://live.3speak.tv/'
function Harness({ token = null }) {
  const rewind = useStreamRewind(API, 'badadib-r1', token)
  return (
    <div style={{ position: 'relative' }}>
      <StreamRewindPlayer rewind={rewind} />
      <StreamRewindButton rewind={rewind} />
      <StreamRewindButton rewind={rewind} variant="sidebar" />
      <StreamRewindButton rewind={rewind} variant="overlay" />
    </div>
  )
}

let answer
beforeEach(() => {
  h.instances.length = 0
  h.supported = true
  answer = { available: true, playlist: '/rooms/badadib-r1/dvr/hls/TOKEN/live.m3u8', windowSec: 600 }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => answer })))
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('rewind', () => {
  it('shows Rewind while the DVR runs and plays its playlist over the stream until Go live', async () => {
    const { user, container } = renderWithProviders(<Harness token="tok" />)
    const tiles = await screen.findAllByText('Rewind')
    expect(tiles.length).toBe(3)
    expect(fetch).toHaveBeenCalledWith('https://live.3speak.tv/rooms/badadib-r1/dvr/rewind', { headers: { Authorization: 'Bearer tok' } })
    expect(screen.getAllByTitle('Rewind up to 10 min')).toHaveLength(3)

    await user.click(container.querySelector('.stream-rewind-chip'))
    await waitFor(() => expect(container.querySelector('.stream-rewind')).not.toBeNull())
    expect(h.instances).toHaveLength(1)
    expect(h.instances[0].loadSource).toHaveBeenCalledWith('https://live.3speak.tv/rooms/badadib-r1/dvr/hls/TOKEN/live.m3u8')
    expect(screen.getByRole('slider', { name: 'Position in the stream' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeInTheDocument()

    await user.click(container.querySelector('.stream-rewind__live'))
    await waitFor(() => expect(container.querySelector('.stream-rewind')).toBeNull())
    expect(h.instances[0].destroy).toHaveBeenCalled()
  })

  it('nothing shows when the stream has no DVR, or the server cannot be reached', async () => {
    answer = { available: false }
    const { container } = renderWithProviders(<Harness />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(fetch.mock.calls[0][1]).toEqual({ headers: {} })
    expect(screen.queryByText('Rewind')).not.toBeInTheDocument()
    fetch.mockRejectedValue(new Error('down'))
    renderWithProviders(<Harness />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(container.querySelector('.stream-rewind')).toBeNull()
  })

  it('a fatal hls error says rewind is not available', async () => {
    const { user, container } = renderWithProviders(<Harness />)
    await user.click((await screen.findAllByText('Rewind'))[0])
    await waitFor(() => expect(h.instances).toHaveLength(1))
    h.instances[0].handlers.hlsError?.({}, { fatal: true })
    expect(await screen.findByText('Rewind is not available right now.')).toBeInTheDocument()
    expect(container.querySelector('.stream-rewind')).not.toBeNull()
  })

  it('without hls.js support or native HLS it shows the error', async () => {
    h.supported = false
    HTMLMediaElement.prototype.canPlayType = vi.fn(() => '')
    const { user } = renderWithProviders(<Harness />)
    await user.click((await screen.findAllByText('Rewind'))[0])
    expect(await screen.findByText('Rewind is not available right now.')).toBeInTheDocument()
  })
})
