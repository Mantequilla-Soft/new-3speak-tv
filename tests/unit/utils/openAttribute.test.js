// OpenAttribute metadata for our posts (src/utils/openAttribute.js).
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  oaEnvelope, orientationOf, probeVideoOrientation, threespeakVideo, threespeakAudio, OA_ARTICLE, OA_MICROPOST,
} from '../../../src/utils/openAttribute.js'

describe('oaEnvelope', () => {
  it('sits at the top level next to the attributes, never wrapping them', () => {
    const meta = { app: '3speak', ...oaEnvelope(OA_ARTICLE), ...threespeakVideo({ surface: 'watch', orientation: 'landscape' }) }
    expect(meta.oa).toEqual({ v: 1, object: 'Article' })
    expect(meta['threespeak.video']).toEqual({ surface: 'watch', orientation: 'landscape' })
    expect(oaEnvelope(OA_MICROPOST)).toEqual({ oa: { v: 1, object: 'MicroPost' } })
  })
})

describe('orientationOf', () => {
  it('tells landscape, vertical and square apart', () => {
    expect(orientationOf(1920, 1080)).toBe('landscape')
    expect(orientationOf(1080, 1920)).toBe('vertical')
    expect(orientationOf(720, 720)).toBe('square')
    expect(orientationOf('1920', '1080')).toBe('landscape')
  })

  it('is null when a side is unknown', () => {
    expect(orientationOf(0, 1080)).toBeNull()
    expect(orientationOf(1920, undefined)).toBeNull()
    expect(orientationOf('x', 'y')).toBeNull()
  })
})

describe('threespeakVideo', () => {
  it('needs both surface and orientation', () => {
    expect(threespeakVideo({ surface: 'watch' })).toEqual({})
    expect(threespeakVideo({ orientation: 'vertical' })).toEqual({})
    expect(threespeakVideo()).toEqual({})
  })

  it('adds a positive duration, except on live', () => {
    expect(threespeakVideo({ surface: 'shorts', orientation: 'vertical', duration: '42.5' }))
      .toEqual({ 'threespeak.video': { surface: 'shorts', orientation: 'vertical', duration: 42.5 } })
    expect(threespeakVideo({ surface: 'watch', orientation: 'landscape', duration: 0 })['threespeak.video'].duration).toBeUndefined()
    expect(threespeakVideo({ surface: 'watch', orientation: 'landscape', duration: 'abc' })['threespeak.video'].duration).toBeUndefined()
    expect(threespeakVideo({ surface: 'live', orientation: 'landscape', duration: 300 })['threespeak.video'].duration).toBeUndefined()
  })

  it('adds startsAt for an announced stream', () => {
    expect(threespeakVideo({ surface: 'live', orientation: 'landscape', startsAt: '2026-11-01T18:00:00Z' }))
      .toEqual({ 'threespeak.video': { surface: 'live', orientation: 'landscape', startsAt: '2026-11-01T18:00:00Z' } })
  })
})

describe('threespeakAudio', () => {
  it('defaults the type to voice_message', () => {
    expect(threespeakAudio()).toEqual({ 'threespeak.audio': { type: 'voice_message' } })
  })

  it('keeps genre, a positive bpm and a positive duration', () => {
    expect(threespeakAudio({ type: 'music', genre: '  lo-fi ', bpm: '90', duration: 185 }))
      .toEqual({ 'threespeak.audio': { type: 'music', genre: 'lo-fi', bpm: 90, duration: 185 } })
    expect(threespeakAudio({ bpm: -1, duration: 'x' })).toEqual({ 'threespeak.audio': { type: 'voice_message' } })
  })
})

describe('probeVideoOrientation', () => {
  afterEach(() => vi.useRealTimers())

  const fakeVideo = () => {
    const v = { videoWidth: 0, videoHeight: 0, src: '' }
    vi.stubGlobal('document', { createElement: () => v })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return v
  }

  it('reads the orientation from the decoded frame size', async () => {
    const v = fakeVideo()
    const p = probeVideoOrientation(new Blob(['x']))
    v.videoWidth = 1080
    v.videoHeight = 1920
    v.onloadedmetadata()
    expect(await p).toBe('vertical')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })

  it('resolves null when the file cannot be decoded', async () => {
    const v = fakeVideo()
    const p = probeVideoOrientation(new Blob(['x']))
    v.onerror()
    expect(await p).toBeNull()
  })

  it('resolves null after five seconds rather than hanging the upload', async () => {
    vi.useFakeTimers()
    fakeVideo()
    const p = probeVideoOrientation(new Blob(['x']))
    vi.advanceTimersByTime(5000)
    expect(await p).toBeNull()
  })

  it('resolves null without a file or outside a browser', async () => {
    expect(await probeVideoOrientation(null)).toBeNull()
    expect(await probeVideoOrientation(new Blob(['x']))).toBeNull()
  })
})
