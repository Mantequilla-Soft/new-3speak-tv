// Scrub-preview frames (src/hooks/useSeekPreview.js): a hidden low-res player is
// attached per video, loaded only on the first hover of the timeline, seeked to
// the time under the cursor (always the latest one, never a backlog), and the box
// is clamped inside the track. Also the time label format.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React, { useRef } from 'react'
import { render, act } from '@testing-library/react'

const preview = vi.hoisted(() => ({ players: [], create: null }))
vi.mock('../../../src/lib/lowResPreviewPlayer', () => ({
  createLowResPreviewPlayer: (...a) => preview.create(...a),
}))
const { default: useSeekPreview } = await import('../../../src/hooks/useSeekPreview.js')

let api
let videoEl
function Scrubber({ videoId = 'badadib/p1', duration = 100, withTrack = true }) {
  const trackRef = useRef(withTrack ? { getBoundingClientRect: () => ({ left: 50, width: 400 }) } : null)
  api = useSeekPreview({ videoId, trackRef, duration, getPlaybackHeight: () => 720 })
  return <video ref={(el) => { api.videoRef.current = el; if (el) videoEl = el }} />
}
const fire = (type) => act(() => { videoEl.dispatchEvent(new Event(type)) })

beforeEach(() => {
  preview.players = []
  preview.create = vi.fn((el, opts) => {
    const p = { el, opts, load: vi.fn(async () => {}), destroy: vi.fn() }
    preview.players.push(p)
    return p
  })
})

describe('the time label', () => {
  it.each([[0, '0:00'], [5.9, '0:05'], [65, '1:05'], [3600, '1:00:00'], [3725, '1:02:05'], [-3, '0:00'], ['x', '0:00']])(
    '%s s reads %s', (s, label) => {
      render(<Scrubber />)
      expect(api.fmtTime(s)).toBe(label)
    })
})

describe('the hidden player', () => {
  it('is attached per video without loading anything', () => {
    render(<Scrubber />)
    expect(preview.create).toHaveBeenCalledWith(videoEl, expect.objectContaining({ loop: false }))
    expect(preview.create.mock.calls[0][1].getPlaybackHeight()).toBe(720)
    expect(preview.players[0].load).not.toHaveBeenCalled()
  })

  it('loads the stream on the first hover only', () => {
    render(<Scrubber />)
    act(() => api.showAt(100))
    act(() => api.showAt(200))
    expect(preview.players[0].load).toHaveBeenCalledTimes(1)
    expect(preview.players[0].load).toHaveBeenCalledWith('badadib/p1')
  })

  it('a failed load is tried again on the next hover', async () => {
    render(<Scrubber />)
    preview.players[0].load.mockRejectedValueOnce(new Error('network'))
    await act(async () => { api.showAt(100) })
    act(() => api.showAt(100))
    expect(preview.players[0].load).toHaveBeenCalledTimes(2)
  })

  it('is destroyed when the video changes or the scrubber unmounts', () => {
    const r = render(<Scrubber />)
    r.rerender(<Scrubber videoId="badadib/p2" />)
    expect(preview.players[0].destroy).toHaveBeenCalled()
    expect(preview.players).toHaveLength(2)
    r.unmount()
    expect(preview.players[1].destroy).toHaveBeenCalled()
  })

  it('without a video id attaches nothing', () => {
    render(<Scrubber videoId="" />)
    expect(preview.create).not.toHaveBeenCalled()
  })
})

describe('hovering the timeline', () => {
  it('shows the box at the cursor with the time under it', () => {
    render(<Scrubber />)
    act(() => api.showAt(250)) // halfway along a 400px track starting at 50
    expect(api.preview).toEqual({ visible: true, leftPx: 200 - 84, time: 50 })
    expect(api.previewWidth).toBe(168)
  })

  it.each([[0, 0, 0], [1000, 400 - 168, 100]])('clamps the box inside the track (x=%i)', (x, left, time) => {
    render(<Scrubber />)
    act(() => api.showAt(x))
    expect(api.preview).toMatchObject({ leftPx: left, time })
  })

  it('seeks once the stream has data, then chases only the latest time', () => {
    render(<Scrubber />)
    act(() => api.showAt(90)) // 10 s
    expect(videoEl.currentTime).toBe(0)
    fire('loadeddata')
    expect(videoEl.currentTime).toBe(10)

    // While a seek runs, newer hovers wait; 'seeked' applies the latest one.
    Object.defineProperty(videoEl, 'seeking', { configurable: true, value: true })
    act(() => api.showAt(130))
    act(() => api.showAt(170)) // 30 s
    expect(videoEl.currentTime).toBe(10)
    Object.defineProperty(videoEl, 'seeking', { configurable: true, value: false })
    fire('seeked')
    expect(videoEl.currentTime).toBe(30)
  })

  it('does not re-seek for a time within 0.2 s of the current frame', () => {
    render(<Scrubber />)
    fire('loadeddata')
    act(() => api.showAt(90))
    const set = vi.spyOn(videoEl, 'currentTime', 'set')
    act(() => api.showAt(90.1))
    expect(set).not.toHaveBeenCalled()
  })

  it('does nothing without a track or a duration', () => {
    render(<Scrubber duration={0} />)
    act(() => api.showAt(100))
    expect(api.preview.visible).toBe(false)
    render(<Scrubber withTrack={false} />)
    act(() => api.showAt(100))
    expect(api.preview.visible).toBe(false)
  })

  it('hiding hides the box but keeps the stream loaded', () => {
    render(<Scrubber />)
    act(() => api.showAt(100))
    act(() => api.hide())
    expect(api.preview.visible).toBe(false)
    expect(preview.players[0].destroy).not.toHaveBeenCalled()
    const before = api.preview
    act(() => api.hide())
    expect(api.preview).toBe(before)
    expect(api.frameless).toBe(false)
  })
})
