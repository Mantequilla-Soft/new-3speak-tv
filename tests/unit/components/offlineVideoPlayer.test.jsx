// @vitest-environment jsdom
// The offline video player (components/Downloads/OfflineVideoPlayer): a saved
// video through hls.js. A fatal media error gets at most MAX_RECOVERIES tries,
// then the "cannot play" note, never an endless recover loop.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ instance: null }))
vi.mock('hls.js', () => {
  class Hls {
    static isSupported() { return true }
    static Events = { ERROR: 'hlsError' }
    static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' }
    constructor() {
      this.handlers = {}
      this.recoverMediaError = vi.fn()
      this.destroy = vi.fn()
      h.instance = this
    }
    on(ev, fn) { this.handlers[ev] = fn }
    loadSource() {}
    attachMedia() {}
    emit(data) { this.handlers.hlsError?.('hlsError', data) }
  }
  return { default: Hls, LoadStats: class {} }
})

const { default: OfflineVideoPlayer, MAX_RECOVERIES } = await import('../../../src/components/Downloads/OfflineVideoPlayer.jsx')

const entry = { id: 'dlvideo:badadib/clip', track: { title: 'Clip' }, parts: [{ key: 'k#0', duration: 4 }] }

beforeEach(() => {
  h.instance = null
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
})

async function mounted() {
  renderWithProviders(<OfflineVideoPlayer entry={entry} />)
  await vi.waitFor(() => expect(h.instance).not.toBeNull())
  return h.instance
}

describe('offline video player', () => {
  it('retries a fatal media error at most twice, then shows the note', async () => {
    const hls = await mounted()
    expect(MAX_RECOVERIES).toBe(2)
    act(() => hls.emit({ fatal: true, type: 'mediaError' }))
    act(() => hls.emit({ fatal: true, type: 'mediaError' }))
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("This browser can't play saved videos.")).toBeNull()
    act(() => hls.emit({ fatal: true, type: 'mediaError' }))
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(2)
    expect(screen.getByText("This browser can't play saved videos.")).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
  })

  it('a fatal network error shows the note at once; a non-fatal one changes nothing', async () => {
    const hls = await mounted()
    act(() => hls.emit({ fatal: false, type: 'mediaError' }))
    expect(document.querySelector('video')).not.toBeNull()
    act(() => hls.emit({ fatal: true, type: 'networkError' }))
    expect(hls.recoverMediaError).not.toHaveBeenCalled()
    expect(document.querySelector('.dl-player__note')).not.toBeNull()
  })
})
