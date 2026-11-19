// @vitest-environment jsdom
// Phone fullscreen for a stream (utils/streamFullscreen.js): the whole page,
// turned sideways; leaving it again; the iPhone falls back to the video's own.
import { describe, it, expect, vi } from 'vitest'
import { toggleStreamFullscreen, releaseStreamOrientation } from '../../../src/utils/streamFullscreen.js'

function fakeDoc({ full = null, enabled = true, video = null } = {}) {
  const requestFullscreen = vi.fn(() => Promise.resolve())
  return {
    fullscreenElement: full,
    fullscreenEnabled: enabled,
    exitFullscreen: vi.fn(() => Promise.resolve()),
    documentElement: { requestFullscreen: enabled ? requestFullscreen : undefined },
    querySelector: () => video,
    requestFullscreen,
  }
}

describe('toggleStreamFullscreen', () => {
  it('takes the whole page fullscreen and turns the phone sideways', async () => {
    const doc = fakeDoc()
    const lock = vi.fn(() => Promise.resolve())
    expect(toggleStreamFullscreen(doc, { orientation: { lock } })).toBe('page')
    expect(doc.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
    await Promise.resolve(); await Promise.resolve()
    expect(lock).toHaveBeenCalledWith('landscape')
  })

  it('stays fullscreen when the phone cannot turn', async () => {
    const doc = fakeDoc()
    const lock = vi.fn(() => Promise.reject(new Error('not supported')))
    expect(toggleStreamFullscreen(doc, { orientation: { lock } })).toBe('page')
    await new Promise((r) => setTimeout(r, 0))
    expect(doc.exitFullscreen).not.toHaveBeenCalled()
  })

  it('leaves when already fullscreen', () => {
    const doc = fakeDoc({ full: {} })
    expect(toggleStreamFullscreen(doc, {})).toBe('exit')
    expect(doc.exitFullscreen).toHaveBeenCalled()
  })

  it('an iPhone opens the stream video in the system player', () => {
    const video = { webkitEnterFullscreen: vi.fn() }
    expect(toggleStreamFullscreen(fakeDoc({ enabled: false, video }), {})).toBe('video')
    expect(video.webkitEnterFullscreen).toHaveBeenCalled()
    expect(toggleStreamFullscreen(fakeDoc({ enabled: false }), {})).toBe('none')
  })
})

describe('releaseStreamOrientation', () => {
  it('unlocks, and never throws where there is nothing to unlock', () => {
    const unlock = vi.fn()
    releaseStreamOrientation({ orientation: { unlock } })
    expect(unlock).toHaveBeenCalled()
    expect(() => releaseStreamOrientation({ orientation: { unlock: () => { throw new Error('x') } } })).not.toThrow()
    expect(() => releaseStreamOrientation(undefined)).not.toThrow()
  })
})
