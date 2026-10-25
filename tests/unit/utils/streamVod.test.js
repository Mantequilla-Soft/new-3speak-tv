// Publishing a finished OpenPods stream as a video (src/utils/streamVod.js): the
// TUS upload under the room's permlink and the follow-up calls. (The server-side
// publish tracker and its toasts were removed in 57aac2c2.)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  cfg: { EMBED_API_KEY: 'embed-key', CHECKER_URL: 'https://checker.example', CHECKER_API_KEY: 'checker-key' },
  toast: { loading: vi.fn(() => 'tid'), success: vi.fn(), error: vi.fn() },
  uploads: [],
  outcome: 'success',
}))

vi.mock('tus-js-client', () => ({
  Upload: class {
    constructor(file, opts) { this.file = file; this.opts = opts; h.uploads.push(this) }
    start() {
      if (h.outcome === 'success') this.opts.onSuccess()
      else this.opts.onError(new Error('tus failed'))
    }
  },
}))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => h.toast }))
vi.mock('../../../src/i18n', () => ({ t: (k, o) => (o ? `${k} ${JSON.stringify(o)}` : k) }))
vi.mock('../../../src/utils/config', () => ({
  get EMBED_API_KEY() { return h.cfg.EMBED_API_KEY },
  get CHECKER_URL() { return h.cfg.CHECKER_URL },
  get CHECKER_API_KEY() { return h.cfg.CHECKER_API_KEY },
}))
vi.mock('../../../src/utils/embedEndpoints', () => ({
  pickEmbedEndpoint: vi.fn(async () => ({ base: 'https://embed.example/', uploadUrl: 'https://embed.example/uploads' })),
}))

import { publishStreamVod } from '../../../src/utils/streamVod.js'

const blob = { type: '', size: 10 }
let fetchMock

beforeEach(() => {
  h.uploads.length = 0
  h.outcome = 'success'
  h.cfg.EMBED_API_KEY = 'embed-key'
  h.cfg.CHECKER_API_KEY = 'checker-key'
  Object.values(h.toast).forEach((f) => f.mockClear())
  fetchMock = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('publishStreamVod', () => {
  it('does nothing without a recording, room or owner', async () => {
    await publishStreamVod({ blob: null, roomName: 'r', owner: 'o' })
    await publishStreamVod({ blob, roomName: '', owner: 'o' })
    await publishStreamVod({ blob, roomName: 'r', owner: '' })
    expect(h.uploads).toHaveLength(0)
    expect(h.toast.loading).not.toHaveBeenCalled()
  })

  it('tells the streamer when no upload key is configured', async () => {
    h.cfg.EMBED_API_KEY = ''
    await publishStreamVod({ blob, roomName: 'r', owner: 'o' })
    expect(h.toast.error).toHaveBeenCalledWith('misc.streamVod.uploadKeyMissing')
    expect(h.uploads).toHaveLength(0)
  })

  it('uploads under the room name as permlink so live links turn into the video', async () => {
    await publishStreamVod({ blob, roomName: 'room-1', owner: 'alice', duration: 61.6 })
    const [up] = h.uploads
    expect(up.opts.endpoint).toBe('https://embed.example/uploads')
    expect(up.opts.headers).toEqual({ 'X-API-Key': 'embed-key' })
    expect(up.opts.metadata).toEqual({
      filename: 'room-1.webm', filetype: 'video/webm', frontend_app: '3speak-tv',
      owner: 'alice', short: 'false', duration: '62', permlink: 'room-1',
    })
  })

  it('links the Hive post, flags it as a recording and sets the thumbnail', async () => {
    await publishStreamVod({ blob, roomName: 'room 1', owner: 'alice', tags: 'x', thumbnailUrl: 'https://t/x.jpg' })
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toEqual([
      'https://embed.example/video/room%201/hive',
      'https://checker.example/video/openpod',
      'https://embed.example/video/room%201/thumbnail',
    ])
    const hive = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(hive).toEqual({ hive_author: 'alice', hive_permlink: 'room 1', hive_title: 'Live stream — room 1', hive_body: '', hive_tags: [] })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer checker-key')
    expect(h.toast.success).toHaveBeenCalledWith('misc.streamVod.uploaded', { id: 'tid', duration: 8000 })
  })

  it('skips the checker flag without a checker key and the thumbnail without one', async () => {
    h.cfg.CHECKER_API_KEY = ''
    await publishStreamVod({ blob, roomName: 'r', owner: 'o', title: 'T' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).hive_title).toBe('T')
  })

  it('a failed follow-up call does not turn a finished upload into a failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    await publishStreamVod({ blob, roomName: 'r', owner: 'o', thumbnailUrl: 'x' })
    expect(h.toast.success).toHaveBeenCalled()
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('a failed upload shows the error and skips the follow-up calls', async () => {
    h.outcome = 'error'
    await publishStreamVod({ blob, roomName: 'r', owner: 'o' })
    expect(h.toast.error).toHaveBeenCalledWith('misc.streamVod.uploadFailed', { id: 'tid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
