// @vitest-environment jsdom
// uploadVideoAsset.js: the TUS upload to the embed service (chunking, which
// failures are retried, progress, reading the asset back from X-Embed-URL), the
// "replace the media of an existing video" calls that only need ONE embed host
// to answer, and the local duration probe. tus-js-client is replaced by a fake
// whose callbacks each test drives; fetch is stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ key: 'embed-key', fallback: [] }))
vi.mock('../../../src/utils/config', () => ({
  get EMBED_API_KEY() { return cfg.key },
  get EMBED_UPLOAD_FALLBACK_HOSTS() { return cfg.fallback },
}))
vi.mock('../../../src/utils/embedEndpoints', () => ({
  pickEmbedEndpoint: vi.fn(),
  getEmbedHosts: vi.fn(),
}))
const tusState = vi.hoisted(() => ({ uploads: [], onStart: null }))
vi.mock('tus-js-client', () => ({
  Upload: class {
    constructor(file, options) {
      this.file = file
      this.options = options
      this.start = vi.fn(() => tusState.onStart?.(this))
      tusState.uploads.push(this)
    }
  },
}))

const {
  uploadVideoAsset, registerMediaReplacement, fetchReplaceTarget, probeVideoDuration,
} = await import('../../../src/utils/uploadVideoAsset.js')
const { pickEmbedEndpoint, getEmbedHosts } = await import('../../../src/utils/embedEndpoints')

const EMBED_URL = 'https://play.3speak.tv/embed?v=alice/abc123'
const response = (headers) => ({ getHeader: (name) => headers[name] })

// A server that answers with the embed URL and finishes.
const succeedWith = (headers = { 'X-Embed-URL': EMBED_URL }) => (upload) => {
  upload.options.onAfterResponse({}, response(headers))
  upload.options.onSuccess()
}

beforeEach(() => {
  cfg.key = 'embed-key'
  cfg.fallback = []
  tusState.uploads = []
  tusState.onStart = succeedWith()
  pickEmbedEndpoint.mockResolvedValue({ base: 'https://embed2.3speak.tv', uploadUrl: 'https://embed2.3speak.tv/uploads' })
  getEmbedHosts.mockReturnValue(['https://embed2.3speak.tv'])
})

const video = () => new File([new Uint8Array(10)], 'clip.mov', { type: 'video/quicktime' })

describe('uploadVideoAsset', () => {
  it.each([
    ['no file', null, { owner: 'alice' }, 'No file given.'],
    ['no owner', video(), {}, 'No owner given.'],
  ])('refuses to start with %s', async (_label, file, opts, message) => {
    await expect(uploadVideoAsset(file, opts)).rejects.toThrow(message)
    expect(pickEmbedEndpoint).not.toHaveBeenCalled()
  })

  it('refuses to start when uploads are not configured', async () => {
    cfg.key = ''
    await expect(uploadVideoAsset(video(), { owner: 'alice' })).rejects.toThrow(/missing embed API key/)
  })

  it('uploads to the picked host in sequential 8 MB chunks with the API key', async () => {
    const file = video()
    await uploadVideoAsset(file, { owner: 'alice', duration: 61.6 })

    const [upload] = tusState.uploads
    expect(upload.file).toBe(file)
    expect(upload.options).toMatchObject({
      endpoint: 'https://embed2.3speak.tv/uploads',
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      removeFingerprintOnSuccess: true,
      headers: { 'X-API-Key': 'embed-key' },
    })
    expect(upload.options.metadata).toEqual({
      filename: 'clip.mov',
      filetype: 'video/quicktime',
      frontend_app: '3speak-tv',
      owner: 'alice',
      short: 'false',
      duration: '62',
    })
    expect(upload.start).toHaveBeenCalledTimes(1)
  })

  it('never sends a permlink, so a replacement becomes a new asset', async () => {
    await uploadVideoAsset(video(), { owner: 'alice' })
    expect(tusState.uploads[0].options.metadata).not.toHaveProperty('permlink')
  })

  it('names a nameless blob video.mp4 and reports duration 0 when unknown', async () => {
    await uploadVideoAsset(new Blob([new Uint8Array(3)]), { owner: 'alice' })
    expect(tusState.uploads[0].options.metadata).toMatchObject({ filename: 'video.mp4', filetype: 'video/mp4', duration: '0' })
  })

  it.each([
    [0, true], // network drop, no response
    [409, true],
    [423, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [413, false],
  ])('retries a %i: %s', async (status, retried) => {
    await uploadVideoAsset(video(), { owner: 'alice' })
    const { onShouldRetry } = tusState.uploads[0].options
    expect(onShouldRetry({ originalResponse: { getStatus: () => status } })).toBe(retried)
  })

  it('retries an error that carries no response at all', async () => {
    await uploadVideoAsset(video(), { owner: 'alice' })
    expect(tusState.uploads[0].options.onShouldRetry(new Error('offline'))).toBe(true)
  })

  it('reports progress as a whole percentage, ignoring an unknown total', async () => {
    const onProgress = vi.fn()
    tusState.onStart = (upload) => {
      upload.options.onProgress(1, 3)
      upload.options.onProgress(5, 0)
      upload.options.onProgress(3, 3)
      succeedWith()(upload)
    }
    await uploadVideoAsset(video(), { owner: 'alice', onProgress })
    expect(onProgress.mock.calls).toEqual([[33], [100]])
  })

  it('hands the upload to the caller before starting it, so it can be aborted', async () => {
    const onStart = vi.fn((upload) => expect(upload.start).not.toHaveBeenCalled())
    await uploadVideoAsset(video(), { owner: 'alice', onStart })
    expect(onStart).toHaveBeenCalledWith(tusState.uploads[0])
  })

  it.each([
    ['the picked base', { base: 'https://embed-okinoko.example/', uploadUrl: 'https://x/uploads' }, 'embed-okinoko.example'],
    ['the upload URL when there is no base', { base: '', uploadUrl: 'https://embed3.3speak.tv/uploads' }, 'embed3.3speak.tv'],
    ['a bare host name as it is', { base: 'embed4.local/uploads', uploadUrl: '' }, 'embed4.local'],
  ])('names the chosen host from %s', async (_label, endpoint, host) => {
    pickEmbedEndpoint.mockResolvedValueOnce(endpoint)
    const onEndpoint = vi.fn()
    await uploadVideoAsset(video(), { owner: 'alice', onEndpoint })
    expect(onEndpoint).toHaveBeenCalledWith(host)
  })

  it('keeps uploading when the endpoint display callback throws', async () => {
    const onEndpoint = () => { throw new Error('render failed') }
    await expect(uploadVideoAsset(video(), { owner: 'alice', onEndpoint })).resolves.toMatchObject({ permlink: 'abc123' })
  })

  it('reads the asset owner and permlink back out of X-Embed-URL', async () => {
    const out = await uploadVideoAsset(video(), { owner: 'alice' })
    expect(out).toEqual({ embedUrl: EMBED_URL, owner: 'alice', permlink: 'abc123' })
  })

  it('also accepts the header in lower case, and the owner the server says', async () => {
    tusState.onStart = succeedWith({ 'x-embed-url': 'https://play.3speak.tv/embed?v=bob/xyz' })
    const out = await uploadVideoAsset(video(), { owner: 'alice' })
    expect(out).toEqual({ embedUrl: 'https://play.3speak.tv/embed?v=bob/xyz', owner: 'bob', permlink: 'xyz' })
  })

  it.each([
    ['an unparseable URL', 'not a url'],
    ['a URL without a v parameter', 'https://play.3speak.tv/embed'],
  ])('keeps the caller\'s owner and an empty permlink for %s', async (_label, header) => {
    tusState.onStart = succeedWith({ 'X-Embed-URL': header })
    expect(await uploadVideoAsset(video(), { owner: 'alice' })).toEqual({ embedUrl: header, owner: 'alice', permlink: '' })
  })

  it('fails when the upload finishes without a video URL', async () => {
    tusState.onStart = succeedWith({})
    await expect(uploadVideoAsset(video(), { owner: 'alice' })).rejects.toThrow('did not return a video URL')
  })

  it('surfaces the upload error tus gives up with', async () => {
    const err = new Error('tus: failed to upload chunk at offset 0')
    tusState.onStart = (upload) => upload.options.onError(err)
    await expect(uploadVideoAsset(video(), { owner: 'alice' })).rejects.toBe(err)
  })
})

// ----------------------------------------------------- replacement endpoints
let fetchMock
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: body === undefined ? async () => { throw new SyntaxError('<html>') } : async () => body,
})
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('registerMediaReplacement', () => {
  it.each([
    ['no new permlink', '', 'old'],
    ['no original permlink', 'new', ''],
  ])('does nothing with %s', async (_label, a, b) => {
    expect(await registerMediaReplacement(a, b)).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when uploads are not configured', async () => {
    cfg.key = ''
    expect(await registerMediaReplacement('new', 'old')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the replacement to the first host, with the permlink encoded', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { queued: true }))
    expect(await registerMediaReplacement('new/one', 'old1')).toEqual({ queued: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://embed2.3speak.tv/video/new%2Fone/replaces')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'embed-key' },
      body: JSON.stringify({ replaces: 'old1' }),
    })
  })

  it('treats an OK answer without JSON as success', async () => {
    fetchMock.mockResolvedValueOnce(reply(204))
    expect(await registerMediaReplacement('new', 'old')).toEqual({})
  })

  it('asks primary hosts, then fallback hosts, once each and without trailing slashes', async () => {
    getEmbedHosts.mockReturnValue(['https://a.example/', 'https://b.example', ''])
    cfg.fallback = ['https://b.example//', 'https://legacy.example']
    fetchMock
      .mockResolvedValueOnce(reply(404))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply(200, { ok: 1 }))
    expect(await registerMediaReplacement('n', 'o')).toEqual({ ok: 1 })
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      'https://a.example/video/n/replaces',
      'https://b.example/video/n/replaces',
      'https://legacy.example/video/n/replaces',
    ])
  })

  it('reports the service verdict once when every host says the same thing', async () => {
    getEmbedHosts.mockReturnValue(['https://a.example', 'https://b.example'])
    fetchMock.mockResolvedValue(reply(409, { error: 'original is not replaceable' }))
    const err = await registerMediaReplacement('n', 'o').catch((e) => e)
    expect(err.message).toBe('original is not replaceable (409)')
    expect(err.status).toBe(409)
    expect(err.failures).toHaveLength(2)
  })

  it('names the path and status for a unanimous failure without a message', async () => {
    getEmbedHosts.mockReturnValue(['https://a.example', 'https://b.example'])
    fetchMock.mockResolvedValue(reply(500))
    await expect(registerMediaReplacement('n', 'o')).rejects.toThrow('/video/n/replaces failed (500)')
  })

  it('lists each host when the hosts disagree', async () => {
    getEmbedHosts.mockReturnValue(['https://a.example', 'https://b.example'])
    fetchMock
      .mockResolvedValueOnce(reply(404, { message: 'no route' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await registerMediaReplacement('n', 'o').catch((e) => e)
    expect(err.message).toBe('/video/n/replaces failed: a.example 404, b.example 0')
    expect(err.failures).toEqual([
      { host: 'a.example', status: 404, message: 'no route' },
      { host: 'b.example', status: 0, message: 'Failed to fetch' },
    ])
  })

  it('says no host was reachable when none is configured', async () => {
    getEmbedHosts.mockReturnValue([])
    const err = await registerMediaReplacement('n', 'o').catch((e) => e)
    expect(err.message).toBe('/video/n/replaces failed: no embed host reachable')
    expect(err.status).toBe(0)
  })
})

describe('fetchReplaceTarget', () => {
  it('is null without a permlink or an API key, and asks nobody', async () => {
    expect(await fetchReplaceTarget('')).toBeNull()
    cfg.key = ''
    expect(await fetchReplaceTarget('abc')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the first host\'s answer', async () => {
    const target = { found: true, kind: 'embed', owner: 'alice', status: 'published' }
    fetchMock.mockResolvedValueOnce(reply(200, target))
    expect(await fetchReplaceTarget('a b')).toEqual(target)
    expect(fetchMock).toHaveBeenCalledWith('https://embed2.3speak.tv/video/a%20b/replace-target', { headers: { 'X-API-Key': 'embed-key' } })
  })

  it('accepts a handler 404 ("not found") as the answer', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { found: false }))
    expect(await fetchReplaceTarget('gone')).toEqual({ found: false })
  })

  it('moves past a host that predates the route (HTML 404) or is unreachable', async () => {
    getEmbedHosts.mockReturnValue(['https://old.example', 'https://down.example', 'https://new.example'])
    fetchMock
      .mockResolvedValueOnce(reply(404))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply(200, { found: true, kind: 'legacy' }))
    expect(await fetchReplaceTarget('p')).toEqual({ found: true, kind: 'legacy' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('is null ("don\'t know") when no host can answer', async () => {
    getEmbedHosts.mockReturnValue(['https://a.example', 'https://b.example'])
    fetchMock.mockResolvedValueOnce(reply(500, { error: 'db down' })).mockResolvedValueOnce(reply(404, { found: true }))
    expect(await fetchReplaceTarget('p')).toBeNull()
  })
})

describe('probeVideoDuration', () => {
  let element
  beforeEach(() => {
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = create(tag)
      if (tag === 'video') element = el
      return el
    })
    URL.createObjectURL = vi.fn(() => 'blob:video-1')
    URL.revokeObjectURL = vi.fn()
  })

  const withDuration = (value) => Object.defineProperty(element, 'duration', { value, configurable: true })

  it('reads the duration from the metadata only, then frees the object URL', async () => {
    const pending = probeVideoDuration(video())
    expect(element.preload).toBe('metadata')
    expect(element.src).toBe('blob:video-1')
    withDuration(93.4)
    element.onloadedmetadata()
    expect(await pending).toBe(93.4)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-1')
  })

  it.each([Infinity, NaN])('resolves 0 for a %s duration (a live or broken stream)', async (value) => {
    const pending = probeVideoDuration(video())
    withDuration(value)
    element.onloadedmetadata()
    expect(await pending).toBe(0)
  })

  it('resolves 0 when the browser cannot read the file', async () => {
    const pending = probeVideoDuration(video())
    element.onerror()
    expect(await pending).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('resolves 0 instead of throwing when an object URL cannot be made', async () => {
    URL.createObjectURL = vi.fn(() => { throw new TypeError('not a Blob') })
    expect(await probeVideoDuration({})).toBe(0)
  })
})
