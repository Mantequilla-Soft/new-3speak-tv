// @vitest-environment jsdom
// medianLuminance / useImageLuminance (src/utils/imageLuminance.js): how bright
// a cover image is, as the MEDIAN Rec. 709 luma of a tiny sample, so a mostly
// dark banner with one bright spot still counts as dark. Image loading and the
// canvas read are faked (jsdom has neither), with the pixels set per test.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { medianLuminance, useImageLuminance } from '../../../src/utils/imageLuminance.js'

// What the next image "contains": a list of [r, g, b, a] pixels, or a failure.
let pixels
let loadFails
let readThrows
const created = []

class FakeImage {
  constructor() { created.push(this) }
  set src(url) {
    this.url = url
    queueMicrotask(() => (loadFails ? this.onerror?.() : this.onload?.()))
  }
}

beforeEach(() => {
  pixels = [[0, 0, 0, 255]]
  loadFails = false
  readThrows = false
  created.length = 0
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
    const canvas = this
    return {
      drawImage: vi.fn(),
      getImageData: (_x, _y, w, h) => {
        if (readThrows) throw new DOMException('The canvas has been tainted', 'SecurityError')
        expect([w, h, canvas.width, canvas.height]).toEqual([24, 14, 24, 14])
        return { data: new Uint8ClampedArray(pixels.flat()) }
      },
    }
  })
})

let n = 0
const freshUrl = () => `https://images.example/cover-${(n += 1)}.jpg`

describe('medianLuminance', () => {
  it.each([
    ['black', [0, 0, 0, 255], 0],
    ['white', [255, 255, 255, 255], 1],
    ['pure green, which the eye reads as bright', [0, 255, 0, 255], 0.7152],
    ['pure blue, which reads as dark', [0, 0, 255, 255], 0.0722],
    ['pure red', [255, 0, 0, 255], 0.2126],
  ])('scores %s', async (_label, px, expected) => {
    pixels = [px]
    expect(await medianLuminance(freshUrl())).toBeCloseTo(expected, 4)
  })

  it('takes the median, so a few blown-out pixels do not lighten a dark banner', async () => {
    const dark = [20, 20, 20, 255]
    const white = [255, 255, 255, 255]
    pixels = [dark, dark, dark, dark, dark, white, white]
    const value = await medianLuminance(freshUrl())
    expect(value).toBeCloseTo(20 / 255, 4)
    // The mean would have been far brighter.
    expect(value).toBeLessThan((5 * 20 + 2 * 255) / 7 / 255)
  })

  it('ignores transparent pixels', async () => {
    pixels = [[255, 255, 255, 0], [255, 255, 255, 100], [10, 10, 10, 255]]
    expect(await medianLuminance(freshUrl())).toBeCloseTo(10 / 255, 4)
  })

  it('is null for a fully transparent image', async () => {
    pixels = [[255, 255, 255, 0], [0, 0, 0, 127]]
    expect(await medianLuminance(freshUrl())).toBeNull()
  })

  it('is null without a URL, and loads nothing', async () => {
    expect(await medianLuminance('')).toBeNull()
    expect(await medianLuminance(undefined)).toBeNull()
    expect(created).toHaveLength(0)
  })

  it.each([
    ['the image fails to load', () => { loadFails = true }],
    ['the host does not allow canvas reads', () => { readThrows = true }],
  ])('is null when %s', async (_label, arrange) => {
    arrange()
    expect(await medianLuminance(freshUrl())).toBeNull()
  })

  it('asks for the image with CORS so the canvas stays readable', async () => {
    const url = freshUrl()
    await medianLuminance(url)
    expect(created[0].crossOrigin).toBe('anonymous')
    expect(created[0].url).toBe(url)
  })

  it('loads each URL once and shares the answer', async () => {
    const url = freshUrl()
    const first = medianLuminance(url)
    const second = medianLuminance(url)
    expect(second).toBe(first)
    await first
    await medianLuminance(url)
    expect(created).toHaveLength(1)
  })
})

describe('useImageLuminance', () => {
  it('is null while loading, then the luminance', async () => {
    pixels = [[255, 255, 255, 255]]
    const { result } = renderHook(() => useImageLuminance(freshUrl()))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBeCloseTo(1, 6))
  })

  it('resets to null and follows a new URL', async () => {
    pixels = [[255, 255, 255, 255]]
    const first = freshUrl()
    const { result, rerender } = renderHook(({ url }) => useImageLuminance(url), { initialProps: { url: first } })
    await waitFor(() => expect(result.current).toBeCloseTo(1, 6))

    pixels = [[0, 0, 0, 255]]
    rerender({ url: freshUrl() })
    await waitFor(() => expect(result.current).toBe(0))
  })

  it('does not set state after unmounting', async () => {
    const errors = vi.spyOn(console, 'error')
    const { unmount } = renderHook(() => useImageLuminance(freshUrl()))
    unmount()
    await new Promise((r) => setTimeout(r, 0))
    expect(errors).not.toHaveBeenCalled()
  })
})
