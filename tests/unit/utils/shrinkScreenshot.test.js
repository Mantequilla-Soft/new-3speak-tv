// utils/shrinkScreenshot: a picked or pasted image becomes a JPEG data URL that
// fits the checker's 750 kB screenshot limit. jsdom has no canvas, so a
// stand-in records the size it was drawn at and hands back a blob of a chosen size.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shrinkScreenshot, SCREENSHOT_MAX_BYTES } from '../../../src/utils/shrinkScreenshot'

let drawn; let blobSizes; let bitmap
beforeEach(() => {
  drawn = []
  blobSizes = [100 * 1024]
  bitmap = { width: 3000, height: 1500, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return realCreate(tag)
    const c = { width: 0, height: 0 }
    c.getContext = () => ({ fillRect: vi.fn(), set fillStyle(_v) {}, drawImage: (_i, _x, _y, w, h) => drawn.push([w, h]) })
    c.toBlob = (cb, type) => {
      const size = blobSizes.length > 1 ? blobSizes.shift() : blobSizes[0]
      cb(new Blob([new Uint8Array(size)], { type }))
    }
    return c
  })
})

const png = (size = 10) => new File([new Uint8Array(size)], 's.png', { type: 'image/png' })

describe('shrinkScreenshot', () => {
  it('scales the long edge to 1920 px and returns a JPEG data URL', async () => {
    const url = await shrinkScreenshot(png())
    expect(url).toMatch(/^data:image\/jpeg;base64,/)
    expect(drawn).toEqual([[1920, 960]])
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('never scales a small image up', async () => {
    bitmap = { width: 800, height: 600, close: vi.fn() }
    await shrinkScreenshot(png())
    expect(drawn).toEqual([[800, 600]])
  })

  it('steps down when the first try is still too big', async () => {
    blobSizes = [SCREENSHOT_MAX_BYTES + 1, SCREENSHOT_MAX_BYTES + 1, SCREENSHOT_MAX_BYTES + 1, 300 * 1024]
    await shrinkScreenshot(png())
    expect(drawn).toEqual([[1920, 960], [1600, 800], [1280, 640], [1024, 512]])
  })

  it('gives up as tooBig when even the smallest step does not fit', async () => {
    blobSizes = [SCREENSHOT_MAX_BYTES + 1]
    await expect(shrinkScreenshot(png())).rejects.toMatchObject({ code: 'tooBig' })
  })

  it('refuses a file that is not an image, or cannot be decoded', async () => {
    await expect(shrinkScreenshot(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toMatchObject({ code: 'unreadable' })
    await expect(shrinkScreenshot(null)).rejects.toMatchObject({ code: 'unreadable' })
    createImageBitmap.mockRejectedValue(new Error('bad'))
    vi.stubGlobal('Image', class { set src(_v) { queueMicrotask(() => this.onerror(new Error('bad'))) } })
    await expect(shrinkScreenshot(png())).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('refuses a huge file before decoding it', async () => {
    const huge = { type: 'image/png', size: 41 * 1024 * 1024 }
    await expect(shrinkScreenshot(huge)).rejects.toMatchObject({ code: 'tooBig' })
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
})
