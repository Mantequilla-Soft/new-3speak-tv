// serverFrameFromFile (src/utils/serverFrame.js): the last-resort thumbnail grab
// that sends only the stretch of compressed video a frame needs to our API. The
// MP4s are tiny real files (helpers/mp4Fixture.js) read by the real mp4Index;
// the API is a stubbed fetch, and the final drawing (drawTurned) is mocked so
// the tests can check the bitmap and rotation it receives.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildMp4, lengthPrefixed, SPS, PPS } from './helpers/mp4Fixture.js'

vi.mock('../../../src/utils/config', () => ({ EMBED_API_KEY: 'embed-key' }))
vi.mock('../../../src/utils/videoFrameImage', () => ({
  drawTurned: vi.fn((source, w, h, rotation) => ({ turned: { source, w, h, rotation } })),
}))
// The real index reader, wrapped so one test can hand back an oversized stretch.
vi.mock('../../../src/utils/mp4Index', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, annexBStream: vi.fn(real.annexBStream) }
})

const { serverFrameFromFile } = await import('../../../src/utils/serverFrame.js')
const { drawTurned } = await import('../../../src/utils/videoFrameImage')
const { annexBStream } = await import('../../../src/utils/mp4Index')

const START = [0, 0, 0, 1]
const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

let fetchMock
let bitmap
beforeEach(() => {
  bitmap = { width: 320, height: 240, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => pngBlob }))
  vi.stubGlobal('fetch', fetchMock)
})

// Decode order I P B B, shown as I B B P (cts 100, 400, 200, 300).
const reordered = (extra = {}) => buildMp4({
  samples: [0, 1, 2, 3].map((i) => lengthPrefixed([[0x41, i]])),
  ctsOffsets: [100, 300, 0, 0],
  ...extra,
}).file

describe('serverFrameFromFile', () => {
  it('posts the keyframe-to-target stretch as raw H.264 with the API key', async () => {
    await serverFrameFromFile(reordered(), 0.25)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/thumbnail-frame?codec=h264&index=1')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/octet-stream', 'X-API-Key': 'embed-key' })
    // SPS, PPS, then samples 0..2 in decode order.
    expect([...init.body]).toEqual([
      ...START, ...SPS, ...START, ...PPS,
      ...START, 0x41, 0, ...START, 0x41, 1, ...START, 0x41, 2,
    ])
  })

  it.each([
    // [time, index among the decoded frames in display order]
    [0, 0], // cts 100: the keyframe itself
    [0.25, 1], // cts 200: decoded third, shown second
    [0.3, 2], // cts 300
    [0.45, 1], // cts 400: decoded second, the stretch ends there
  ])('at %ss asks for decoded frame number %i in display order', async (time, index) => {
    await serverFrameFromFile(reordered(), time)
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`index=${index}$`))
  })

  // An open GOP: sample 3 (cts 300) is a leading picture of keyframe 2 (cts 500),
  // shown before it. A decoder starting at the keyframe drops it.
  const openGop = () => buildMp4({
    samples: [0, 1, 2, 3, 4].map((i) => lengthPrefixed([[0x41, i]])),
    sync: [0, 2],
    ctsOffsets: [100, 300, 300, 0, 200], // cts 100, 400, 500, 300, 600
  }).file

  it('leaves the leading pictures of an open GOP out of the count', async () => {
    await serverFrameFromFile(openGop(), 0.6)
    expect(fetchMock.mock.calls[0][0]).toMatch(/index=1$/)
  })

  it('refuses a frame that is itself a dropped leading picture', async () => {
    await expect(serverFrameFromFile(openGop(), 0.35)).rejects.toThrow('frame not in range')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send a stretch larger than the server accepts (40 MB)', async () => {
    annexBStream.mockResolvedValueOnce({ codec: 'h264', bytes: { length: 41 * 1024 * 1024 } })
    await expect(serverFrameFromFile(reordered(), 0)).rejects.toThrow('stretch too big (41 MB)')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('draws the returned picture turned by the track rotation, then frees the bitmap', async () => {
    const out = await serverFrameFromFile(reordered({ rotation: 90 }), 0)

    expect(createImageBitmap).toHaveBeenCalledWith(pngBlob)
    expect(drawTurned).toHaveBeenCalledWith(bitmap, 320, 240, 90)
    expect(out).toEqual({ turned: { source: bitmap, w: 320, h: 240, rotation: 90 } })
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('frees the bitmap even when drawing it fails', async () => {
    drawTurned.mockImplementationOnce(() => { throw new Error('canvas gone') })
    await expect(serverFrameFromFile(reordered(), 0)).rejects.toThrow('canvas gone')
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the server reason when it gives one', { status: 422, json: async () => ({ error: 'decode failed' }) }, 'server 422 decode failed'],
    ['only the status when the body is not JSON', { status: 502, json: async () => { throw new SyntaxError('html') } }, 'server 502'],
    ['only the status when the JSON has no error', { status: 500, json: async () => ({}) }, 'server 500'],
  ])('reports a failed decode with %s', async (_label, res, message) => {
    fetchMock.mockResolvedValueOnce({ ok: false, ...res })
    await expect(serverFrameFromFile(reordered(), 0)).rejects.toThrow(message)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('lets a file without an index fail before anything is sent', async () => {
    await expect(serverFrameFromFile(new Blob([new Uint8Array(32)]), 0)).rejects.toThrow(/no moov/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses VITE_THREESPEAK_API as the API base when set', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_THREESPEAK_API', 'https://api.example/v1')
    const fresh = await import('../../../src/utils/serverFrame.js')
    await fresh.serverFrameFromFile(reordered(), 0)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example/v1/thumbnail-frame?codec=h264&index=0')
  })
})
