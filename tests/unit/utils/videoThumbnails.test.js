// Picking thumbnail frames from a chosen video file in the browser
// (src/utils/videoThumbnails.js). jsdom cannot decode video, so each <video> is
// given a scripted duration, size and event sequence.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateVideoThumbnails } from '../../../src/utils/videoThumbnails.js'

let scenario
let seeks
let videos

beforeEach(() => {
  scenario = { duration: 10, meta: 'ok', width: () => 640 }
  seeks = []
  videos = []
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/jpeg;base64,${seeks.length}`)

  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const el = realCreate(tag, ...rest)
    if (tag !== 'video') return el
    videos.push(el)
    let frameSize = 0
    let paused = true
    let time = 0
    Object.defineProperties(el, {
      duration: { get: () => scenario.duration },
      videoWidth: { get: () => frameSize },
      videoHeight: { get: () => frameSize },
      paused: { get: () => paused },
      currentTime: {
        get: () => time,
        set: (t) => { time = t; seeks.push(t); setTimeout(() => el.dispatchEvent(new Event('seeked')), 0) },
      },
      src: {
        get: () => el.getAttribute('src') || '',
        set: (v) => {
          el.setAttribute('src', v)
          setTimeout(() => {
            if (el.preload === 'metadata') el.dispatchEvent(new Event(scenario.meta === 'ok' ? 'loadedmetadata' : 'error'))
            else {
              frameSize = scenario.width(videos.length)
              el.dispatchEvent(new Event('canplay'))
            }
          }, 0)
        },
      },
    })
    el.load = vi.fn()
    el.pause = vi.fn()
    el.play = vi.fn(async () => { paused = false })
    return el
  })
})

describe('generateVideoThumbnails', () => {
  it('refuses a file that is not a video', async () => {
    await expect(generateVideoThumbnails({ type: 'image/png' })).rejects.toThrow('Not a video file')
    await expect(generateVideoThumbnails(null)).rejects.toThrow('Not a video file')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('captures evenly spread frames as JPEG data URLs and cleans up', async () => {
    const out = await generateVideoThumbnails({ type: 'video/mp4' }, 2)
    expect(out).toHaveLength(2)
    for (const d of out) expect(d).toMatch(/^data:image\/jpeg;base64,/)
    expect(seeks).toEqual([2.5, 7.5])
    expect(document.querySelectorAll('video')).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('the capture video is muted and inline so mobile browsers decode it', async () => {
    await generateVideoThumbnails({ type: 'video/webm' }, 1)
    const capture = videos[1]
    expect(capture.muted).toBe(true)
    expect(capture.hasAttribute('playsinline')).toBe(true)
    expect(capture.hasAttribute('muted')).toBe(true)
  })

  it('keeps clear of the very start and end of a very short clip', async () => {
    scenario.duration = 0.3
    await generateVideoThumbnails({ type: 'video/mp4' }, 1)
    expect(seeks[0]).toBeGreaterThanOrEqual(0.05)
    expect(seeks[0]).toBeLessThanOrEqual(0.25)
  })

  it('skips a frame that fails and returns the rest', async () => {
    scenario.width = (n) => (n === 2 ? 0 : 640) // the first capture video has no picture
    const out = await generateVideoThumbnails({ type: 'video/mp4' }, 3)
    expect(out).toHaveLength(2)
  })

  it('fails when no frame at all could be read', async () => {
    scenario.width = () => 0
    await expect(generateVideoThumbnails({ type: 'video/mp4' }, 2)).rejects.toThrow('Failed to extract any frames')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('fails on an unreadable or zero-length video and still frees the file', async () => {
    scenario.meta = 'error'
    await expect(generateVideoThumbnails({ type: 'video/mp4' })).rejects.toThrow('Failed to read video metadata')
    scenario.meta = 'ok'
    scenario.duration = NaN
    await expect(generateVideoThumbnails({ type: 'video/mp4' })).rejects.toThrow('Invalid video duration')
    scenario.duration = 0
    await expect(generateVideoThumbnails({ type: 'video/mp4' })).rejects.toThrow('Invalid video duration')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
  })
})
