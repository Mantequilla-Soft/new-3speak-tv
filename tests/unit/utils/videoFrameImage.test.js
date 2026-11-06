// @vitest-environment jsdom
// videoFrameImage (src/utils/videoFrameImage.js): copying a WebCodecs VideoFrame
// out as pixels (RGBA, or I420 / NV12 converted here with the right colour
// matrix and range) and turning a picture by the track's rotation. jsdom has no
// canvas backend, so getContext returns a recording fake and ImageData is a
// plain holder; the colour maths is checked on real numbers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { colourOf, yuvToRgba, videoFrameToCanvas, drawTurned } from '../../../src/utils/videoFrameImage.js'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
    this.ctx ||= { putImageData: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() }
    return this.ctx
  })
  vi.stubGlobal('ImageData', class {
    constructor(data, width, height) { Object.assign(this, { data, width, height }) }
  })
})

const px = (rgba, i) => [...rgba.subarray(i * 4, i * 4 + 4)]

describe('colourOf', () => {
  it.each([
    [{ matrix: 'bt709' }, 480, 'bt709'],
    [{ matrix: 'smpte170m' }, 1080, 'bt601'],
    [{ matrix: 'bt470bg' }, 1080, 'bt601'],
    [null, 720, 'bt709'], // untagged HD
    [null, 1080, 'bt709'],
    [null, 576, 'bt601'], // untagged SD
    [{ matrix: 'rgb' }, 480, 'bt601'],
  ])('%o at height %i uses the %s matrix', (colorSpace, height, matrix) => {
    expect(colourOf(colorSpace, height).matrix).toBe(matrix)
  })

  it('is limited range unless the frame says full range', () => {
    expect(colourOf(null, 480).fullRange).toBe(false)
    expect(colourOf({ fullRange: false }, 480).fullRange).toBe(false)
    expect(colourOf({ fullRange: true }, 480).fullRange).toBe(true)
  })
})

describe('yuvToRgba', () => {
  // One flat 2x2 I420 picture: Y plane, then one U and one V sample.
  const i420 = (Y, U, V) => ({
    buf: new Uint8Array([Y, Y, Y, Y, U, V]),
    layout: [{ offset: 0, stride: 2 }, { offset: 4, stride: 1 }, { offset: 5, stride: 1 }],
  })

  it.each([
    ['limited-range black', 16, 128, 128, [0, 0, 0]],
    ['limited-range white', 235, 128, 128, [255, 255, 255]],
    ['limited-range mid grey', 126, 128, 128, [128, 128, 128]],
  ])('maps %s onto RGB', (_label, Y, U, V, rgb) => {
    const { buf, layout } = i420(Y, U, V)
    const out = yuvToRgba('I420', buf, layout, 2, 2, colourOf(null, 2))
    for (let i = 0; i < 4; i += 1) {
      px(out, i).forEach((v, k) => expect(v).toBeCloseTo([...rgb, 255][k], -0.5))
    }
  })

  it('keeps full-range values as they are', () => {
    const { buf, layout } = i420(200, 128, 128)
    const out = yuvToRgba('I420', buf, layout, 2, 2, { matrix: 'bt601', fullRange: true })
    expect(px(out, 0)).toEqual([200, 200, 200, 255])
  })

  it('turns BT.601 limited-range red back into red, clamping overshoot', () => {
    const { buf, layout } = i420(81, 90, 240)
    const [r, g, b, a] = px(yuvToRgba('I420', buf, layout, 2, 2, { matrix: 'bt601', fullRange: false }), 0)
    expect(r).toBeGreaterThanOrEqual(253)
    expect(g).toBeLessThanOrEqual(1)
    expect(b).toBeLessThanOrEqual(1)
    expect(a).toBe(255)
  })

  it('gives a different result for the same pixel under BT.709 than BT.601', () => {
    const { buf, layout } = i420(81, 90, 240)
    const r601 = px(yuvToRgba('I420', buf, layout, 2, 2, { matrix: 'bt601', fullRange: false }), 0)
    const r709 = px(yuvToRgba('I420', buf, layout, 2, 2, { matrix: 'bt709', fullRange: false }), 0)
    expect(r709).not.toEqual(r601)
    expect(r709[1]).toBeGreaterThan(r601[1]) // BT.709 takes less green away for red
  })

  it('falls back to BT.601 for an unknown matrix name', () => {
    const { buf, layout } = i420(81, 90, 240)
    expect(yuvToRgba('I420', buf, layout, 2, 2, { matrix: 'xyz', fullRange: false }))
      .toEqual(yuvToRgba('I420', buf, layout, 2, 2, { matrix: 'bt601', fullRange: false }))
  })

  it('reads NV12 (interleaved chroma) the same as I420 (separate planes)', () => {
    // 4x2 picture, two chroma columns, padded strides.
    const Y = [16, 60, 120, 235, 30, 90, 150, 200]
    const U = [90, 160]
    const V = [240, 60]
    const i420buf = new Uint8Array([...Y.slice(0, 4), 0, 0, ...Y.slice(4), 0, 0, ...U, 0, ...V, 0])
    const i420Layout = [{ offset: 0, stride: 6 }, { offset: 12, stride: 3 }, { offset: 15, stride: 3 }]
    const nv12buf = new Uint8Array([...Y, U[0], V[0], U[1], V[1]])
    const nv12Layout = [{ offset: 0, stride: 4 }, { offset: 8, stride: 4 }]

    const a = yuvToRgba('I420', i420buf, i420Layout, 4, 2)
    const b = yuvToRgba('NV12', nv12buf, nv12Layout, 4, 2)
    expect(b).toEqual(a)
    // The two chroma columns really are different colours.
    expect(px(a, 0)).not.toEqual(px(a, 2))
  })
})

describe('videoFrameToCanvas', () => {
  const rgbaFrame = (extra = {}) => ({
    codedWidth: 4,
    codedHeight: 2,
    allocationSize: vi.fn(() => 4 * 2 * 4),
    copyTo: vi.fn(async (buf) => { buf.fill(7) }),
    ...extra,
  })

  it('copies RGBA pixels out and paints them at the coded size', async () => {
    const frame = rgbaFrame()
    const canvas = await videoFrameToCanvas(frame)

    expect(frame.copyTo).toHaveBeenCalledWith(expect.any(Uint8Array), { format: 'RGBA', rect: undefined })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect([canvas.width, canvas.height]).toEqual([4, 2])
    const [image] = canvas.ctx.putImageData.mock.calls[0]
    expect([image.width, image.height]).toEqual([4, 2])
    expect(image.data.every((v) => v === 7)).toBe(true)
  })

  it('reads only the visible rectangle when the frame has one', async () => {
    const frame = rgbaFrame({
      codedWidth: 8,
      codedHeight: 8,
      visibleRect: { x: 2, y: 1, width: 4, height: 2 },
    })
    const canvas = await videoFrameToCanvas(frame)
    expect(frame.allocationSize).toHaveBeenCalledWith({ format: 'RGBA', rect: { x: 2, y: 1, width: 4, height: 2 } })
    expect([canvas.width, canvas.height]).toEqual([4, 2])
  })

  it('converts the native I420 layout itself when the browser cannot hand out RGBA', async () => {
    const yuv = new Uint8Array([235, 235, 235, 235, 128, 128])
    const frame = {
      codedWidth: 2,
      codedHeight: 2,
      format: 'I420',
      colorSpace: { matrix: 'bt709', fullRange: false },
      allocationSize: vi.fn(({ format } = {}) => (format === 'RGBA' ? 16 : 6)),
      copyTo: vi.fn(async (buf, { format } = {}) => {
        if (format === 'RGBA') throw new DOMException('not supported', 'NotSupportedError')
        buf.set(yuv)
        return [{ offset: 0, stride: 2 }, { offset: 4, stride: 1 }, { offset: 5, stride: 1 }]
      }),
    }
    const canvas = await videoFrameToCanvas(frame)
    const [image] = canvas.ctx.putImageData.mock.calls[0]
    expect([...image.data.subarray(0, 4)]).toEqual([255, 255, 255, 255])
  })

  it.each([null, 'I420P10', 'RGBX'])('refuses a frame whose native format is %s', async (format) => {
    const frame = {
      codedWidth: 2,
      codedHeight: 2,
      format,
      allocationSize: () => 16,
      copyTo: async () => { throw new Error('nope') },
    }
    await expect(videoFrameToCanvas(frame)).rejects.toThrow(`format ${format}`)
  })

  it('scales to the display size (non-square pixels) and turns by the rotation', async () => {
    const frame = rgbaFrame({ displayWidth: 6, displayHeight: 2 })
    const out = await videoFrameToCanvas(frame, 90)
    expect([out.width, out.height]).toEqual([2, 6])
    expect(out.ctx.rotate).toHaveBeenCalledWith((90 * Math.PI) / 180)
  })
})

describe('drawTurned', () => {
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })

  it('hands back a canvas untouched when there is nothing to do', () => {
    const source = canvasOf(16, 9)
    expect(drawTurned(source, 16, 9, 0)).toBe(source)
    expect(drawTurned(source, 16, 9, 360)).toBe(source)
  })

  it('always copies a source that is not a canvas (an ImageBitmap)', () => {
    const bitmap = { width: 16, height: 9 }
    const out = drawTurned(bitmap, 16, 9, 0)
    expect(out).not.toBe(bitmap)
    expect(out.ctx.drawImage).toHaveBeenCalledWith(bitmap, -8, -4.5, 16, 9)
  })

  it.each([
    [90, [9, 16], 90],
    [180, [16, 9], 180],
    [270, [9, 16], 270],
    [-90, [9, 16], 270], // counter-clockwise is the same as 270
    [85, [9, 16], 90], // snapped to the nearest quarter turn
  ])('a %i degree turn gives a %o canvas turned %i degrees about its centre', (rotation, size, turn) => {
    const radians = (turn * Math.PI) / 180
    const out = drawTurned(canvasOf(16, 9), 16, 9, rotation)
    expect([out.width, out.height]).toEqual(size)
    expect(out.ctx.translate).toHaveBeenCalledWith(size[0] / 2, size[1] / 2)
    expect(out.ctx.rotate).toHaveBeenCalledWith(radians)
  })

  it('resizes without turning when only the size differs', () => {
    const out = drawTurned(canvasOf(16, 9), 32, 18)
    expect([out.width, out.height]).toEqual([32, 18])
    expect(out.ctx.rotate).toHaveBeenCalledWith(0)
  })
})
