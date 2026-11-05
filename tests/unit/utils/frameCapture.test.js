// @vitest-environment jsdom
// captureVideoFrame (src/utils/frameCapture.js): the cascade of ways to grab the
// frame a <video> shows, for browsers that read video frames back black or as
// one flat colour. Each way's result is checked for flatness before it is
// trusted, and `tried` records every attempt.
//
// jsdom has no canvas backend, so a small fake stands in: every drawable thing
// carries a `content` label ("flat" or "pic:<name>"), drawing copies the label,
// getImageData turns it into flat or varied pixels and toDataURL echoes it. The
// fake <video> decides per grab method, paused or playing, what it shows.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/videoThumbnails', () => ({
  captureFrameAt: vi.fn(),
  isMobileDevice: vi.fn(() => false),
}))
vi.mock('../../../src/utils/videoFrameImage', () => ({
  videoFrameToCanvas: vi.fn(async (frame) => canvasShowing(frame.source.look('videoframe'))),
}))
vi.mock('../../../src/utils/softwareFrame', () => ({ decodeFrameFromFile: vi.fn() }))
vi.mock('../../../src/utils/serverFrame', () => ({ serverFrameFromFile: vi.fn() }))

const { captureVideoFrame } = await import('../../../src/utils/frameCapture.js')
const { captureFrameAt, isMobileDevice } = await import('../../../src/utils/videoThumbnails')
const { decodeFrameFromFile } = await import('../../../src/utils/softwareFrame')
const { serverFrameFromFile } = await import('../../../src/utils/serverFrame')
const { videoFrameToCanvas } = await import('../../../src/utils/videoFrameImage')

// ---------------------------------------------------------------- canvas fake
const contentOf = (source) => (typeof source?.look === 'function' ? source.look('2d') : source?.content ?? 'flat')

function canvasShowing(content, w = 64, h = 36) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.content = content
  return c
}

let canvasState
function installCanvasFake() {
  canvasState = { webgl: true, maxTexture: 4096, tainted: false, loseContext: vi.fn(), toDataURL: [] }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(type) {
    const canvas = this
    if (type === '2d') {
      return {
        drawImage: (source) => { canvas.content = contentOf(source) },
        getImageData: (_x, _y, w, h) => {
          if (canvasState.tainted) throw new DOMException('tainted', 'SecurityError')
          const data = new Uint8ClampedArray(w * h * 4)
          if (String(canvas.content).startsWith('pic')) data.forEach((_v, i) => { data[i] = (i * 37) % 256 })
          else data.fill(40) // one flat dark colour, like Firefox's purple
          return { data }
        },
      }
    }
    if (!canvasState.webgl) return null
    return fakeGl(canvas)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function toDataURL(type, quality) {
    canvasState.toDataURL.push([type, quality])
    return `data:image/jpeg;${this.content}`
  })
}

function fakeGl(canvas) {
  const noop = () => {}
  return new Proxy({
    MAX_TEXTURE_SIZE: 0x0d33,
    getParameter: () => canvasState.maxTexture,
    texImage2D: (...args) => { canvas.content = args[5].look('webgl') },
    getExtension: () => ({ loseContext: canvasState.loseContext }),
    getAttribLocation: () => 0,
  }, { get: (target, key) => (key in target ? target[key] : noop) })
}

// Data-URL images: loads (or fails) on the next tick, carrying the URL's label.
class FakeImage {
  set src(url) {
    this.content = String(url).replace(/^data:image\/jpeg;/, '')
    this.naturalWidth = 16
    this.naturalHeight = 9
    setTimeout(() => (this.content === 'broken' ? this.onerror?.() : this.onload?.()), 0)
  }
}

// ----------------------------------------------------------------- the video
function makeVideo({ paused = {}, playing = {}, width = 640, height = 360 } = {}) {
  const video = {
    videoWidth: width,
    videoHeight: height,
    currentTime: 12.5,
    isPlaying: false,
    look(kind) { return (this.isPlaying ? playing : paused)[kind] ?? 'flat' },
    play: vi.fn(async () => { video.isPlaying = true }),
    pause: vi.fn(() => { video.isPlaying = false }),
    requestVideoFrameCallback: vi.fn((cb) => cb()),
  }
  return video
}

class FakeVideoFrame {
  constructor(source) {
    this.source = source
    this.close = vi.fn()
    FakeVideoFrame.made.push(this)
  }
}

const file = new Blob(['mp4'], { type: 'video/mp4' })

beforeEach(() => {
  installCanvasFake()
  vi.stubGlobal('Image', FakeImage)
  FakeVideoFrame.made = []
  window.VideoFrame = FakeVideoFrame
  isMobileDevice.mockReturnValue(false)
  decodeFrameFromFile.mockRejectedValue(new Error('no VideoDecoder'))
  serverFrameFromFile.mockRejectedValue(new Error('offline'))
  captureFrameAt.mockRejectedValue(new Error('no hidden video'))
})

describe('captureVideoFrame: the paused round', () => {
  it('takes a plain 2D canvas grab when it shows a real picture', async () => {
    const video = makeVideo({ paused: { '2d': 'pic:2d' } })
    const out = await captureVideoFrame(video)
    expect(out).toEqual({ dataUrl: 'data:image/jpeg;pic:2d', method: '2d', tried: ['2d:ok'] })
    expect(canvasState.toDataURL[0]).toEqual(['image/jpeg', 0.9])
  })

  it('moves on to VideoFrame.copyTo when the 2D grab is one flat colour', async () => {
    const video = makeVideo({ paused: { videoframe: 'pic:vf' } })
    const out = await captureVideoFrame(video)
    expect(out.method).toBe('videoframe')
    expect(out.dataUrl).toBe('data:image/jpeg;pic:vf')
    expect(out.tried).toEqual(['2d:blank', 'videoframe:ok'])
    expect(FakeVideoFrame.made[0].close).toHaveBeenCalledTimes(1)
  })

  it('closes the VideoFrame even when copying it out fails', async () => {
    videoFrameToCanvas.mockRejectedValueOnce(new Error('format null'))
    const video = makeVideo({ paused: { webgl: 'pic:gl' } })
    const out = await captureVideoFrame(video)
    expect(out.tried).toEqual(['2d:blank', 'videoframe:error format null', 'webgl:ok'])
    expect(FakeVideoFrame.made[0].close).toHaveBeenCalledTimes(1)
  })

  it('falls through to WebGL on a browser without VideoFrame, and frees the context', async () => {
    delete window.VideoFrame
    const video = makeVideo({ paused: { webgl: 'pic:gl' } })
    const out = await captureVideoFrame(video)
    expect(out).toMatchObject({ method: 'webgl', dataUrl: 'data:image/jpeg;pic:gl' })
    expect(out.tried).toEqual(['2d:blank', 'videoframe:error no VideoFrame', 'webgl:ok'])
    expect(canvasState.loseContext).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no WebGL at all', () => { canvasState.webgl = false }, 'webgl:error no webgl'],
    ['a frame bigger than the largest texture', () => { canvasState.maxTexture = 512 }, 'webgl:error frame 640x360 > texture 512'],
  ])('records %s as a WebGL error', async (_label, arrange, entry) => {
    arrange()
    const out = await captureVideoFrame(makeVideo())
    expect(out.tried).toContain(entry)
  })

  it('trusts a grab it cannot check (a tainted canvas) rather than throwing it away', async () => {
    canvasState.tainted = true
    const out = await captureVideoFrame(makeVideo())
    expect(out.method).toBe('2d')
    expect(out.tried).toEqual(['2d:ok'])
  })

  it('cuts long error messages down so the log stays readable', async () => {
    videoFrameToCanvas.mockRejectedValueOnce(new Error('x'.repeat(200)))
    const out = await captureVideoFrame(makeVideo({ paused: { webgl: 'pic' } }))
    expect(out.tried[1]).toBe(`videoframe:error ${'x'.repeat(60)}`)
  })

  it('marks every attempt "no-size" for a video without dimensions yet', async () => {
    const out = await captureVideoFrame(makeVideo({ width: 0 }))
    expect(out.dataUrl).toBeNull()
    expect(out.method).toBeNull()
    expect(out.tried).toEqual([
      '2d:no-size', 'videoframe:no-size', 'webgl:no-size',
      '2d-playing:no-size', 'videoframe-playing:no-size', 'webgl-playing:no-size',
    ])
  })
})

describe('captureVideoFrame: decoding from the file', () => {
  it('uses the software decoder when every paused grab is blank', async () => {
    decodeFrameFromFile.mockResolvedValueOnce(canvasShowing('pic:decoded'))
    const video = makeVideo()
    const out = await captureVideoFrame(video, { file })
    expect(decodeFrameFromFile).toHaveBeenCalledWith(file, 12.5)
    expect(out).toMatchObject({ method: 'decode', dataUrl: 'data:image/jpeg;pic:decoded' })
    expect(out.tried.at(-1)).toBe('decode:ok')
    expect(video.play).not.toHaveBeenCalled()
  })

  it('records a blank decode and keeps going', async () => {
    decodeFrameFromFile.mockResolvedValueOnce(canvasShowing('flat'))
    const out = await captureVideoFrame(makeVideo({ playing: { '2d': 'pic:live' } }), { file })
    expect(out.tried).toContain('decode:blank')
    expect(out.method).toBe('2d-playing')
  })

  it('records a decoder error (up to 80 characters)', async () => {
    decodeFrameFromFile.mockRejectedValueOnce(new Error('y'.repeat(100)))
    const out = await captureVideoFrame(makeVideo({ playing: { '2d': 'pic' } }), { file })
    expect(out.tried).toContain(`decode:error ${'y'.repeat(80)}`)
  })

  it('does not try to decode without a file', async () => {
    await captureVideoFrame(makeVideo())
    expect(decodeFrameFromFile).not.toHaveBeenCalled()
    expect(serverFrameFromFile).not.toHaveBeenCalled()
    expect(captureFrameAt).not.toHaveBeenCalled()
  })
})

describe('captureVideoFrame: the playing round', () => {
  it('grabs again while playing, then pauses and puts the playhead back', async () => {
    const video = makeVideo({ playing: { videoframe: 'pic:live' } })
    const out = await captureVideoFrame(video)
    expect(out).toMatchObject({ method: 'videoframe-playing', dataUrl: 'data:image/jpeg;pic:live' })
    expect(out.tried).toEqual(['2d:blank', 'videoframe:blank', 'webgl:blank', '2d-playing:blank', 'videoframe-playing:ok'])
    expect(video.requestVideoFrameCallback).toHaveBeenCalled()
    expect(video.pause).toHaveBeenCalled()
    expect(video.currentTime).toBe(12.5)
  })

  it('waits two animation frames where requestVideoFrameCallback is missing', async () => {
    const raf = vi.fn((cb) => cb())
    vi.stubGlobal('requestAnimationFrame', raf)
    const video = makeVideo({ playing: { '2d': 'pic' } })
    delete video.requestVideoFrameCallback
    const out = await captureVideoFrame(video)
    expect(raf).toHaveBeenCalledTimes(2)
    expect(out.method).toBe('2d-playing')
  })

  it('gives up waiting for a new frame after 700 ms', async () => {
    vi.useFakeTimers()
    try {
      const video = makeVideo({ playing: { '2d': 'pic' } })
      video.requestVideoFrameCallback = vi.fn() // never calls back
      const pending = captureVideoFrame(video)
      await vi.advanceTimersByTimeAsync(699)
      expect(video.pause).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect((await pending).method).toBe('2d-playing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('records a refused play() and still pauses and restores the playhead', async () => {
    const video = makeVideo()
    video.play.mockRejectedValueOnce(new DOMException('play() can only be initiated by a user gesture', 'NotAllowedError'))
    video.currentTime = 3
    const out = await captureVideoFrame(video)
    expect(out.tried.at(-1)).toMatch(/^play:error play\(\) can only be initiated/)
    expect(out.dataUrl).toBeNull()
    expect(video.pause).toHaveBeenCalled()
    expect(video.currentTime).toBe(3)
  })
})

describe('captureVideoFrame: the hidden video and the API', () => {
  it('uses the hidden-video grab when the visible video never gives a picture', async () => {
    captureFrameAt.mockResolvedValueOnce('data:image/jpeg;pic:hidden')
    const out = await captureVideoFrame(makeVideo(), { file })
    expect(captureFrameAt).toHaveBeenCalledWith(file, 12.5)
    expect(out).toMatchObject({ method: 'hidden', dataUrl: 'data:image/jpeg;pic:hidden' })
    expect(serverFrameFromFile).not.toHaveBeenCalled()
  })

  it.each([
    ['blank', 'data:image/jpeg;flat'],
    ['unloadable', 'data:image/jpeg;broken'],
  ])('treats a %s hidden-video grab as blank and asks the API last', async (_label, dataUrl) => {
    captureFrameAt.mockResolvedValueOnce(dataUrl)
    serverFrameFromFile.mockResolvedValueOnce(canvasShowing('pic:server'))
    const out = await captureVideoFrame(makeVideo(), { file })
    expect(out.tried.slice(-2)).toEqual(['hidden:blank', 'server:ok'])
    expect(out).toMatchObject({ method: 'server', dataUrl: 'data:image/jpeg;pic:server' })
  })

  it('records a hidden-video error and an API error, and returns no picture', async () => {
    const out = await captureVideoFrame(makeVideo(), { file })
    expect(out.tried).toEqual([
      '2d:blank', 'videoframe:blank', 'webgl:blank',
      'decode:error no VideoDecoder',
      '2d-playing:blank', 'videoframe-playing:blank', 'webgl-playing:blank',
      'hidden:error no hidden video',
      'server:error offline',
    ])
    expect(out).toMatchObject({ dataUrl: null, method: null })
  })

  it('records a blank API frame', async () => {
    serverFrameFromFile.mockResolvedValueOnce(canvasShowing('flat'))
    const out = await captureVideoFrame(makeVideo(), { file })
    expect(out.tried.at(-1)).toBe('server:blank')
    expect(out.dataUrl).toBeNull()
  })

  it('on a phone asks the API first and stops there when it answers', async () => {
    isMobileDevice.mockReturnValue(true)
    serverFrameFromFile.mockResolvedValueOnce(canvasShowing('pic:server'))
    const video = makeVideo({ paused: { '2d': 'pic:2d' } })
    const out = await captureVideoFrame(video, { file })
    expect(out).toEqual({ dataUrl: 'data:image/jpeg;pic:server', method: 'server', tried: ['server:ok'] })
    expect(serverFrameFromFile).toHaveBeenCalledWith(file, 12.5)
  })

  it('on a phone falls back to the local ways, without asking the API twice', async () => {
    isMobileDevice.mockReturnValue(true)
    const out = await captureVideoFrame(makeVideo(), { file })
    expect(serverFrameFromFile).toHaveBeenCalledTimes(1)
    expect(out.tried[0]).toBe('server:error offline')
    expect(out.tried.filter((t) => t.startsWith('server'))).toHaveLength(1)
  })

  it('on a phone without a file skips the API and grabs locally', async () => {
    isMobileDevice.mockReturnValue(true)
    const out = await captureVideoFrame(makeVideo({ paused: { '2d': 'pic' } }))
    expect(serverFrameFromFile).not.toHaveBeenCalled()
    expect(out.method).toBe('2d')
  })
})
