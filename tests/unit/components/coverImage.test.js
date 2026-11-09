// @vitest-environment jsdom
// Reading a cover into something the cover designer's canvas may export
// (components/AudioUploadModal/coverImage.js): straight from its host when CORS
// allows it, else through our same-origin /img/ cache, square already.
import { describe, it, expect, vi, afterEach } from 'vitest'
import bs58 from 'bs58'
import { BLANK_COVER_COLOR, blankCover, coverImageCandidates, toEditableImage } from '../../../src/components/AudioUploadModal/coverImage.js'

afterEach(() => vi.unstubAllGlobals())

const imageResponse = (type = 'image/jpeg') => ({ ok: true, status: 200, blob: async () => new Blob(['img'], { type }) })

describe('coverImageCandidates', () => {
  it('takes a data or blob URL as it is', () => {
    expect(coverImageCandidates('data:image/png;base64,AAAA')).toEqual(['data:image/png;base64,AAAA'])
    expect(coverImageCandidates('blob:https://3speak.tv/abc')).toEqual(['blob:https://3speak.tv/abc'])
  })

  it('tries a Hive image straight, then through our /img/h/ cache as a 1080 square', () => {
    const url = 'https://images.hive.blog/DQmCover/cover.jpg'
    const [direct, cached] = coverImageCandidates(url)
    expect(direct).toBe(url)
    expect(cached).toBe(`/img/h/p/${bs58.encode(Buffer.from(url))}?format=jpeg&mode=cover&width=1080&height=1080`)
  })

  it('reads our own images.3speak.tv through the square /img/a/ crop', () => {
    expect(coverImageCandidates('https://images.3speak.tv/u/alice/cover.png?x=1'))
      .toEqual(['https://images.3speak.tv/u/alice/cover.png?x=1', '/img/a/u/alice/cover.png?px=512'])
  })

  it('has nothing to try without a picture', () => {
    expect(coverImageCandidates('')).toEqual([])
    expect(coverImageCandidates(null)).toEqual([])
  })

  it('keeps a path on this site as the only try', () => {
    expect(coverImageCandidates('/img/i/QmX')).toEqual(['/img/i/QmX'])
  })
})

describe('toEditableImage', () => {
  it('returns a data URL untouched without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(toEditableImage('data:image/png;base64,AAAA')).resolves.toBe('data:image/png;base64,AAAA')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the picture from its host into a data URL', async () => {
    const fetchMock = vi.fn(async () => imageResponse())
    vi.stubGlobal('fetch', fetchMock)
    const out = await toEditableImage('https://images.hive.blog/DQm/c.jpg')
    expect(out).toMatch(/^data:image\/jpeg;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toEqual({ mode: 'cors', credentials: 'omit' })
  })

  it('falls back to our cache when the host refuses CORS', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.startsWith('https://')) throw new TypeError('Failed to fetch')
      return imageResponse('image/png')
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await toEditableImage('https://files.example/cover.png')
    expect(out).toMatch(/^data:image\/png;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toMatch(/^\/img\/h\/p\//)
  })

  it('rejects when no source gives a picture (an HTML error page is not one)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (url.startsWith('/img/')
      ? { ok: true, status: 200, blob: async () => new Blob(['<html>'], { type: 'text/html' }) }
      : { ok: false, status: 404, blob: async () => new Blob([]) })))
    await expect(toEditableImage('https://files.example/gone.png')).rejects.toThrow(/not a picture/)
  })

  it('rejects an empty source', async () => {
    await expect(toEditableImage('')).rejects.toThrow()
  })
})

describe('blankCover', () => {
  it('paints a plain square of the cover colour', () => {
    const fillRect = vi.fn()
    const ctx = { fillRect, set fillStyle(v) { ctx._fill = v }, get fillStyle() { return ctx._fill } }
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    const toUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,BLANK')
    expect(blankCover(1080)).toBe('data:image/png;base64,BLANK')
    expect(ctx._fill).toBe(BLANK_COVER_COLOR)
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1080, 1080)
    spy.mockRestore()
    toUrl.mockRestore()
  })

  it('gives null where there is no 2D canvas', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(blankCover()).toBeNull()
    spy.mockRestore()
  })
})
