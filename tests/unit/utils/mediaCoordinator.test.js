// @vitest-environment jsdom
// One player at a time (src/utils/mediaCoordinator.js): a player starting
// tells every OTHER kind of player to pause, never itself.
import { describe, it, expect, vi } from 'vitest'
import { notifyMediaPlay, onMediaPlay } from '../../../src/utils/mediaCoordinator.js'

describe('media coordination', () => {
  it('notifies the other players, not the one that started', () => {
    const audio = vi.fn()
    const video = vi.fn()
    const offAudio = onMediaPlay('audio', audio)
    const offVideo = onMediaPlay('video', video)
    notifyMediaPlay('video')
    expect(audio).toHaveBeenCalledWith({ type: 'video' })
    expect(video).not.toHaveBeenCalled()
    offAudio()
    offVideo()
  })

  it('stops notifying after unsubscribing', () => {
    const short = vi.fn()
    const off = onMediaPlay('short', short)
    off()
    notifyMediaPlay('audio')
    expect(short).not.toHaveBeenCalled()
  })

  it('ignores events without a type', () => {
    const audio = vi.fn()
    const off = onMediaPlay('audio', audio)
    window.dispatchEvent(new CustomEvent('mantequilla-media-play', { detail: {} }))
    window.dispatchEvent(new CustomEvent('mantequilla-media-play'))
    expect(audio).not.toHaveBeenCalled()
    off()
  })

  it('does nothing outside a browser', () => {
    vi.stubGlobal('window', undefined)
    expect(() => notifyMediaPlay('audio')).not.toThrow()
    const off = onMediaPlay('audio', vi.fn())
    expect(off).toBeTypeOf('function')
    expect(() => off()).not.toThrow()
  })
})
