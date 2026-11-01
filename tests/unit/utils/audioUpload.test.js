// uploadAudioTo3Speak (src/utils/audioUpload.js): the in-memory copy that works
// around iOS WebKit sending a disk-backed File as an empty multipart body, the
// file-type → format mapping, and the coded errors the upload modal translates.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({
  THREESPEAK_AUDIO_API_URL: 'https://audio.example',
  THREESPEAK_API_KEY: 'test-key',
}))
vi.mock('../../../src/utils/snapsContainer', () => ({ resolveSnapsContainer: vi.fn() }))

const { uploadAudioTo3Speak, audioFormatFor } = await import('../../../src/utils/audioUpload.js')

const okResponse = () => ({
  ok: true,
  status: 201,
  json: async () => ({ permlink: 'abc12345', cid: 'Qm1', playUrl: 'http://audio.example/play?a=u/abc12345' }),
})

describe('audioFormatFor', () => {
  it('maps the MIME type onto a format the audio service accepts', () => {
    expect(audioFormatFor(new Blob([], { type: 'audio/webm;codecs=opus' }))).toBe('webm')
    expect(audioFormatFor(new Blob([], { type: 'audio/mpeg' }))).toBe('mp3')
    expect(audioFormatFor(new Blob([], { type: 'audio/mp4' }))).toBe('m4a')
    expect(audioFormatFor(new Blob([], { type: 'audio/x-m4a' }))).toBe('m4a')
    expect(audioFormatFor(new Blob([], { type: 'audio/ogg' }))).toBe('ogg')
    expect(audioFormatFor(new Blob([], { type: 'audio/x-wav' }))).toBe('wav')
  })

  it('falls back to the file extension when the type is empty', () => {
    expect(audioFormatFor(new Blob([]), 'Episode 1.M4A')).toBe('m4a')
    expect(audioFormatFor(new Blob([]), 'take.wav')).toBe('wav')
  })

  it('keeps the old webm label for types the service does not list', () => {
    expect(audioFormatFor(new Blob([], { type: 'audio/flac' }), 'song.flac')).toBe('webm')
    expect(audioFormatFor(new Blob([]), 'noext')).toBe('webm')
  })
})

describe('uploadAudioTo3Speak', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends an in-memory copy with the same bytes, named after its real type', async () => {
    const original = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' })
    const out = await uploadAudioTo3Speak({ blob: original, filename: 'ep.m4a', durationSec: 61.4, username: 'u', title: 'T' })

    const fd = fetchMock.mock.calls[0][1].body
    const sent = fd.get('audio')
    expect(sent).not.toBe(original)
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(sent.name).toBe('recording.m4a')
    expect(fd.get('format')).toBe('m4a')
    expect(fd.get('duration')).toBe('61')
    expect(out.playUrl).toBe('https://audio.example/play?a=u/abc12345')
  })

  it('refuses a file it cannot read, without POSTing', async () => {
    const unreadable = new Blob([new Uint8Array(10)])
    unreadable.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'))
    await expect(uploadAudioTo3Speak({ blob: unreadable, username: 'u' })).rejects.toMatchObject({ code: 'unreadable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a file that reads back shorter than its size', async () => {
    const short = new Blob([new Uint8Array(10)])
    short.arrayBuffer = async () => new ArrayBuffer(0)
    await expect(uploadAudioTo3Speak({ blob: short, username: 'u' })).rejects.toMatchObject({ code: 'unreadable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('codes 429 and 5xx answers for the modal to translate', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'Too many uploads' }) })
    await expect(uploadAudioTo3Speak({ blob, username: 'u' })).rejects.toMatchObject({ code: 'rateLimited' })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Internal server error' }) })
    await expect(uploadAudioTo3Speak({ blob, username: 'u' })).rejects.toMatchObject({ code: 'server' })
  })

  it('passes other errors through with the service message', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Invalid file format' }) })
    const err = await uploadAudioTo3Speak({ blob, username: 'u' }).catch((e) => e)
    expect(err.message).toBe('Invalid file format')
    expect(err.code).toBeUndefined()
  })
})
