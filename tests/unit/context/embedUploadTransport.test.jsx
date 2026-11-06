// The background video upload (src/context/EmbedUploadContext.jsx, startEarlyUpload)
// and its three transports: resumable TUS on the least-busy host, the PATCH-free
// chunked protocol when a network eats PATCH, and one plain POST as the last
// resort. Covers what is sent (token, headers, metadata, form fields), retries
// and deadlines, resume, cancel and the errors the user sees. tus, XHR and axios
// are fakes; timers are faked wherever the code waits.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const h = await vi.hoisted(async () => await import('./helpers/embedUpload.jsx'))
vi.mock('../../../src/utils/config', () => h.mocks.config)
vi.mock('axios', () => h.mocks.axios)
vi.mock('tus-js-client', () => h.mocks.tus)
vi.mock('react-router-dom', () => h.mocks.router)
vi.mock('react-i18next', () => h.mocks.i18n)
vi.mock('../../../src/i18n', () => h.mocks.appI18n)
vi.mock('../../../src/utils/toast', () => h.mocks.toast)
vi.mock('../../../src/lib/store', () => h.mocks.store)
vi.mock('../../../src/hooks/usePremiumStatus', () => h.mocks.premium)
vi.mock('../../../src/utils/snapsContainer', () => h.mocks.snaps)
vi.mock('../../../src/utils/creatorSettings', () => h.mocks.creatorSettings)
vi.mock('../../../src/lib/supportBlockStore', () => h.mocks.supportBlock)
vi.mock('../../../src/utils/uploadThumbnail', () => h.mocks.thumbnail)
vi.mock('../../../src/utils/embedEndpoints', () => h.mocks.endpoints)
vi.mock('../../../src/utils/checkLatestVersion', () => h.mocks.stale)
vi.mock('../../../src/hive-api/aioha', () => h.mocks.aioha)
vi.mock('../../../src/utils/postingAuthority', () => h.mocks.postingAuth)
vi.mock('../../../src/utils/channelTrailer', () => h.mocks.trailer)
vi.mock('../../../src/lib/advertiseData', () => h.mocks.advertise)
vi.mock('../../../src/lib/youtubeImport', () => h.mocks.youtubeImport)
vi.mock('../../../src/lib/stories', () => h.mocks.stories)
vi.mock('../../../src/hive-api/hiveApi', () => h.mocks.hiveApi)

const { EmbedUploadProvider, useEmbedUpload } = await import('../../../src/context/EmbedUploadContext.jsx')

const KB = 1024
const MB = 1024 * KB
const FILE_BYTES = 600 * KB          // three 256KB chunks on the chunked path
const tokenCalls = () => h.fns.axiosPost.mock.calls.filter(([url]) => url.endsWith('/uploads/token'))
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

// A network that black-holes PATCH, as the 15s watchdog reports it. The real
// watchdog is exercised once below; elsewhere this skips straight to its verdict.
const patchBlocked = (up) => up.options.onError(Object.assign(new Error('blocked'), { code: 'PATCH_BLOCKED' }))

function setConnection(value) {
  Object.defineProperty(navigator, 'connection', { value, configurable: true })
}

async function startWith(file = h.videoFile(FILE_BYTES), { duration = 125.4, setup } = {}) {
  const hook = renderHook(() => useEmbedUpload(), { wrapper: EmbedUploadProvider })
  act(() => {
    hook.result.current.setVideoFile(file)
    hook.result.current.setVideoDuration(duration)
    setup?.(hook.result.current)
  })
  act(() => hook.result.current.startEarlyUpload())
  return hook
}
const settled = (result) => waitFor(() => expect(['done', 'error']).toContain(result.current.videoUploadStatus))

beforeEach(() => {
  h.reset()
  localStorage.clear()
  setConnection(undefined)
  vi.stubGlobal('XMLHttpRequest', h.FakeXHR)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers() })

describe('the resumable (TUS) upload', () => {
  it('mints a deferring upload token on the chosen host, then uploads with it', async () => {
    const { result } = await startWith()
    await settled(result)

    expect(tokenCalls()).toEqual([[
      `${h.POOL_BASE}/uploads/token`,
      { owner: 'badadib', frontend_app: '3speak-tv', short: false, gated: false, defer_encode: true },
      { headers: { 'X-API-Key': 'embed-key', 'Content-Type': 'application/json' } },
    ]])
    const [up] = h.tus.uploads
    expect(up.options).toMatchObject({
      endpoint: `${h.POOL_BASE}/uploads`,
      chunkSize: 4 * MB,
      parallelUploads: 1,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      // Never both: the key would win server-side and lose the deferral.
      headers: { Authorization: 'Bearer up-tok' },
      metadata: { filename: 'clip.mp4', filetype: 'video/mp4', frontend_app: '3speak-tv', owner: 'badadib', short: 'false', duration: '125' },
    })
  })

  it('finishes with the embed URL the server sent back and the host it went to', async () => {
    const { result } = await startWith()
    await settled(result)
    expect(result.current).toMatchObject({
      videoUploadStatus: 'done',
      embedUrl: h.EMBED_URL,
      uploadProgress: 100,
      statusText: '',
      selectedEndpoint: h.POOL_BASE,
    })
    expect(result.current.uploadDetail).toMatchObject({ method: 'resumable', acked: FILE_BYTES, sent: FILE_BYTES, total: FILE_BYTES, fileBytes: FILE_BYTES, workers: 1 })
  })

  it('a short is marked as one in the token and the metadata', async () => {
    const { result } = await startWith(undefined, { setup: (c) => c.setFromStories(true) })
    await settled(result)
    expect(tokenCalls()[0][1]).toMatchObject({ short: true })
    expect(h.tus.uploads[0].options.metadata.short).toBe('true')
  })

  it('an incubating creator owns the asset under their handle', async () => {
    h.state.store = { user: null, incubationHandle: 'newbie' }
    const { result } = await startWith()
    await settled(result)
    expect(tokenCalls()[0][1].owner).toBe('newbie')
    expect(h.tus.uploads[0].options.metadata.owner).toBe('newbie')
  })

  it('without a token it falls back to the app key (and no deferral)', async () => {
    h.fns.axiosPost.mockRejectedValueOnce(new Error('mint down'))
    const { result } = await startWith()
    await settled(result)
    expect(h.tus.uploads[0].options.headers).toEqual({ 'X-API-Key': 'embed-key' })
    expect(result.current.videoUploadStatus).toBe('done')
  })

  it('starts only once per video, however often the details step asks', async () => {
    const { result } = await startWith()
    await settled(result)
    act(() => result.current.startEarlyUpload())
    act(() => result.current.startEarlyUpload())
    expect(h.tus.uploads).toHaveLength(1)
  })

  it('a replaced video starts over from scratch', async () => {
    const { result } = await startWith()
    await settled(result)
    act(() => result.current.setVideoFile(h.videoFile(FILE_BYTES, 'other.mp4')))
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(h.tus.uploads).toHaveLength(2))
    expect(h.tus.uploads[1].options.metadata.filename).toBe('other.mp4')
  })

  it('does nothing without a video', () => {
    const { result } = renderHook(() => useEmbedUpload(), { wrapper: EmbedUploadProvider })
    act(() => result.current.startEarlyUpload())
    expect(result.current.videoUploadStatus).toBe('idle')
  })

  it('a stale build reloads instead of uploading', async () => {
    h.fns.reloadIfStale.mockResolvedValue(true)
    const { result } = await startWith()
    await waitFor(() => expect(h.fns.reloadIfStale).toHaveBeenCalled())
    await act(async () => {})
    expect(h.tus.uploads).toHaveLength(0)
    expect(h.fns.pickEmbedEndpoint).not.toHaveBeenCalled()
    expect(result.current.videoUploadStatus).toBe('uploading')
  })

  it('resumes an interrupted upload of the same file', async () => {
    h.tus.previous = [{ uploadUrl: `${h.POOL_BASE}/uploads/old` }]
    const { result } = await startWith()
    await settled(result)
    expect(h.tus.uploads[0].resumeFromPreviousUpload).toHaveBeenCalledWith(h.tus.previous[0])
  })

  it('never resumes on the legacy host, which cannot, and drops its stale fingerprints', async () => {
    localStorage.setItem('tus::https://embed.3speak.tv/uploads::clip', '{}')
    localStorage.setItem('tus::https://embed2.test/uploads::clip', '{}')
    h.fns.pickEmbedEndpoint.mockResolvedValue({ base: 'https://embed.3speak.tv', uploadUrl: 'https://embed.3speak.tv/uploads' })
    h.tus.previous = [{ uploadUrl: 'https://embed.3speak.tv/uploads/old' }]
    const { result } = await startWith()
    await settled(result)
    expect(h.tus.uploads[0].options.storeFingerprintForResuming).toBe(false)
    expect(h.tus.uploads[0].resumeFromPreviousUpload).not.toHaveBeenCalled()
    expect(localStorage.getItem('tus::https://embed.3speak.tv/uploads::clip')).toBeNull()
    expect(localStorage.getItem('tus::https://embed2.test/uploads::clip')).toBe('{}')
  })

  it('a gated upload asks for gating and sends its allowlist', async () => {
    h.state.tokenData = { ...h.state.tokenData, gated: true }
    const { result } = await startWith(undefined, { setup: (c) => { c.setGated(true); c.setGatedAllowlist(['alice']) } })
    await settled(result)
    expect(tokenCalls()[0][1]).toMatchObject({ gated: true, allowlist: ['alice'] })
  })

  it.each([
    ['no response', 0, true],
    ['409 conflict', 409, true],
    ['423 locked', 423, true],
    ['429 rate limit', 429, true],
    ['502 bad gateway', 502, true],
    ['401 unauthorised', 401, false],
    ['403 forbidden', 403, false],
    ['404 not found', 404, false],
  ])('a failure with %s is retried: %s', async (_label, status, retried) => {
    const { result } = await startWith()
    await settled(result)
    const err = { originalResponse: status ? { getStatus: () => status } : null }
    let answer
    act(() => { answer = h.tus.uploads[0].options.onShouldRetry(err) })
    expect(answer).toBe(retried)
    if (retried) expect(result.current.statusText).toBe('upload.progress.connectionUnstable')
  })

  it('a hard failure is shown in the bar, and the next attempt may start again', async () => {
    h.tus.behaviour = 'error'
    const { result } = await startWith()
    await settled(result)
    expect(result.current).toMatchObject({ videoUploadStatus: 'error', statusText: 'tus refused' })
    expect(h.fns.toastError).toHaveBeenCalledWith('tus refused')

    h.tus.behaviour = 'success'
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(result.current.videoUploadStatus).toBe('done'))
  })

  it('an upload that ends without an embed URL is a failure', async () => {
    h.tus.embedUrl = undefined
    const { result } = await startWith()
    await settled(result)
    expect(result.current).toMatchObject({ videoUploadStatus: 'error', statusText: 'upload.errors.noEmbedUrl' })
  })
})

describe('choosing the shape of the upload from the connection', () => {
  const big = { size: 60 * MB, name: 'big.mp4', type: 'video/mp4' }

  it('a big file on a good line goes up as two parallel parts', async () => {
    setConnection({ effectiveType: '4g', downlink: 20, rtt: 50, saveData: false })
    const { result } = await startWith(big)
    await settled(result)
    expect(h.tus.uploads[0].options.parallelUploads).toBe(2)
    expect(result.current.uploadDetail).toMatchObject({ link: '4g', linkDown: 20, linkRtt: 50, saveData: false })
  })

  it.each([
    ['a 3g line', { effectiveType: '3g', downlink: 20, rtt: 50 }],
    ['a thin downlink', { effectiveType: '4g', downlink: 1, rtt: 50 }],
    ['high latency', { effectiveType: '4g', downlink: 20, rtt: 800 }],
    ['Data Saver', { effectiveType: '4g', downlink: 20, rtt: 50, saveData: true }],
    ['no connection info at all', undefined],
  ])('%s keeps it to one stream', async (_label, conn) => {
    setConnection(conn)
    const { result } = await startWith(big)
    await settled(result)
    expect(h.tus.uploads[0].options.parallelUploads).toBe(1)
  })

  it('a small file never splits, even on a good line', async () => {
    setConnection({ effectiveType: '4g', downlink: 20, rtt: 50 })
    const { result } = await startWith()
    await settled(result)
    expect(h.tus.uploads[0].options.parallelUploads).toBe(1)
  })
})

describe('when the network eats PATCH', () => {
  it('the watchdog gives TUS 15 seconds, then switches to the chunked upload', async () => {
    vi.useFakeTimers()
    h.tus.behaviour = 'hang'
    const { result } = await startWith()
    await advance(14000)
    expect(h.xhr.requests).toHaveLength(0)
    await advance(1500)
    expect(h.tus.uploads[0].abort).toHaveBeenCalled()
    expect(h.fns.toastMessage).toHaveBeenCalledWith('upload.progress.patchBlockedSwitching')
    await advance(100)
    expect(result.current).toMatchObject({ videoUploadStatus: 'done', embedUrl: h.EMBED_URL, selectedEndpoint: h.RELIABLE_BASE })
  })

  it('an acknowledged PATCH disarms the watchdog', async () => {
    vi.useFakeTimers()
    let up
    h.tus.behaviour = (u) => { up = u }
    const { result } = await startWith()
    await advance(10)
    act(() => up.options.onChunkComplete(4 * MB, 4 * MB))
    await advance(20000)
    expect(up.abort).not.toHaveBeenCalled()
    expect(h.xhr.requests).toHaveLength(0)
    act(() => up.options.onSuccess())
    await advance(10)
    expect(result.current.videoUploadStatus).toBe('error')   // no X-Embed-URL was ever sent
  })

  it('sticks to the chunked upload for the rest of the session', async () => {
    h.tus.behaviour = patchBlocked
    const { result } = await startWith()
    await settled(result)
    act(() => result.current.setVideoFile(h.videoFile(FILE_BYTES, 'second.mp4')))
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(h.xhr.requests.filter((r) => r.path === '/upload/chunk/finish')).toHaveLength(2))
    expect(h.tus.uploads).toHaveLength(1)
    expect(h.fns.pickEmbedEndpoint).toHaveBeenCalledTimes(1)
  })
})

describe('the chunked upload', () => {
  beforeEach(() => { h.tus.behaviour = patchBlocked })

  it('measures the link, opens a session with a token and sends every chunk once', async () => {
    const { result } = await startWith()
    await settled(result)

    expect(h.posted('/upload/probe')).toHaveLength(1)
    expect(h.posted('/upload/probe')[0].url).toBe(`${h.RELIABLE_BASE}/upload/probe`)
    expect(tokenCalls()[1][0]).toBe(`${h.RELIABLE_BASE}/uploads/token`)

    const [create] = h.posted('/upload/chunk/create')
    expect(Object.fromEntries(create.form.entries())).toEqual({
      token: 'up-tok', filename: 'clip.mp4', duration: '125', size: String(FILE_BYTES), chunkSize: String(MB), probed: '1',
    })
    const chunks = h.posted('/upload/chunk').map((r) => [r.form.get('sessionId'), r.form.get('index'), r.form.get('chunk').size])
    expect(chunks.sort()).toEqual([['s1', '0', 256 * KB], ['s1', '1', 256 * KB], ['s1', '2', 88 * KB]])
    expect(h.posted('/upload/chunk/finish')[0].form.get('sessionId')).toBe('s1')

    expect(result.current).toMatchObject({ videoUploadStatus: 'done', embedUrl: h.EMBED_URL })
    expect(result.current.uploadDetail).toMatchObject({ method: 'reliable', acked: FILE_BYTES, chunksTotal: 3 })
    // The session is finished: nothing left to resume.
    expect(Object.keys(localStorage).filter((k) => k.startsWith('chunked::'))).toEqual([])
  })

  it('opens the other streams only after the first chunk lands', async () => {
    h.xhr.server.chunkSize = 256 * KB
    let inFlightAtFirst = null
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk' && inFlightAtFirst === null) inFlightAtFirst = h.posted('/upload/chunk').length
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    await settled(result)
    expect(inFlightAtFirst).toBe(1)
    expect(result.current.uploadDetail.workers).toBe(5)
  })

  it('a probe that cannot get through settles on the smallest chunk', async () => {
    h.xhr.handler = (path, req) => (path === '/upload/probe' ? 'error' : h.defaultChunkServer(path, req))
    const { result } = await startWith()
    await settled(result)
    expect(h.posted('/upload/chunk/create')[0].form.get('chunkSize')).toBe(String(256 * KB))
    expect(result.current.uploadDetail).toMatchObject({ probeBps: 0 })
  })

  it('retries a chunk that failed, and counts the retry', async () => {
    vi.useFakeTimers()
    let failed = false
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk' && req.form.get('index') === '1' && !failed) { failed = true; return 'error' }
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    await advance(100)
    expect(result.current.videoUploadStatus).toBe('uploading')
    expect(h.posted('/upload/chunk').filter((r) => r.form.get('index') === '1')).toHaveLength(1)
    await advance(2500)
    expect(result.current.videoUploadStatus).toBe('done')
    expect(result.current.uploadDetail).toMatchObject({ retries: 1, lastError: 'NETWORK' })
    expect(h.posted('/upload/chunk').filter((r) => r.form.get('index') === '1')).toHaveLength(2)
  })

  it('a tab coming back to the foreground cuts the retry wait short', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    let failures = 0
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk' && failures < 2) { failures += 1; return 'error' }
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    await advance(2100)   // the first try, then the retry after 2s
    expect(failures).toBe(2)
    // The next retry would wait 5s; the user switches back to the tab instead.
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await advance(10)
    expect(result.current.videoUploadStatus).toBe('done')
    delete document.visibilityState
  })

  it('retries the session handshake within a deadline, then uploads', async () => {
    vi.useFakeTimers()
    let creates = 0
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk/create' && ++creates < 3) return 'hang'
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    await advance(16100)
    expect(result.current.statusText).toBe('upload.progress.connectionUnstableAttempt {"attempt":2,"attempts":3}')
    await advance(2000 + 16100 + 4000 + 100)
    expect(creates).toBe(3)
    expect(result.current.videoUploadStatus).toBe('done')
    expect(h.posted('/upload/chunk/create').filter((r) => r.aborted)).toHaveLength(2)
  })

  it('a session the server forgot (404) is given up and the single request takes over', async () => {
    h.xhr.handler = (path, req) => (path === '/upload/chunk' ? { status: 404, body: { error: 'gone' } } : h.defaultChunkServer(path, req))
    const { result } = await startWith()
    await settled(result)
    expect(h.fns.toastMessage).toHaveBeenCalledWith('upload.progress.stillStuck')
    const [simple] = h.posted('/upload/simple')
    expect(Object.fromEntries([...simple.form.entries()].filter(([k]) => k !== 'file'))).toEqual({
      token: 'up-tok', filename: 'clip.mp4', duration: '125', frontend_app: '3speak-tv',
    })
    expect(simple.form.get('file').size).toBe(FILE_BYTES)
    expect(result.current).toMatchObject({ videoUploadStatus: 'done', embedUrl: h.EMBED_URL })
    expect(result.current.uploadDetail.method).toBe('single-shot')
  })

  it('a chunk that only lost its acknowledgement counts as landed', async () => {
    vi.useFakeTimers()
    // Chunk 0 lands on the server, but every reply to it is lost.
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk' && req.form.get('index') === '0') { h.xhr.server.received.add(0); return 'error' }
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    // Burn through the 30-minute chunk budget quickly.
    for (let i = 0; i < 70; i++) await advance(30000)
    expect(h.posted('/upload/chunk/status').length).toBeGreaterThan(0)
    expect(result.current.videoUploadStatus).toBe('done')
  })

  it('resumes a session left by an earlier attempt, sending only the missing chunks', async () => {
    localStorage.setItem(`chunked::${h.RELIABLE_BASE}::clip.mp4::${FILE_BYTES}`, JSON.stringify({
      sessionId: 'old', deferral: { finalizeToken: 'fin-old', permlink: 'asset-1', gated: false },
    }))
    h.xhr.server.received = new Set([0, 1])
    h.xhr.server.totalChunks = 3
    const { result } = await startWith()
    await settled(result)
    expect(h.posted('/upload/chunk/status')[0].form.get('sessionId')).toBe('old')
    expect(h.posted('/upload/chunk/create')).toHaveLength(0)
    expect(h.posted('/upload/chunk').map((r) => r.form.get('index'))).toEqual(['2'])
    expect(result.current.videoUploadStatus).toBe('done')
  })

  it('an expired stored session is replaced by a fresh one', async () => {
    localStorage.setItem(`chunked::${h.RELIABLE_BASE}::clip.mp4::${FILE_BYTES}`, 'bare-old-id')
    h.xhr.handler = (path, req) => (path === '/upload/chunk/status' ? { status: 404, body: {} } : h.defaultChunkServer(path, req))
    const { result } = await startWith()
    await settled(result)
    expect(h.posted('/upload/chunk/status')[0].form.get('sessionId')).toBe('bare-old-id')
    expect(h.posted('/upload/chunk/create')).toHaveLength(1)
    expect(result.current.videoUploadStatus).toBe('done')
  })

  it('refuses a gated upload the server would not gate, before any byte is sent', async () => {
    h.state.tokenData = { ...h.state.tokenData, gated: false }
    const { result } = await startWith(undefined, { setup: (c) => c.setGated(true) })
    await settled(result)
    expect(result.current).toMatchObject({ videoUploadStatus: 'error', statusText: 'upload.errors.gatedUnsupported' })
    expect(h.posted('/upload/chunk/create')).toHaveLength(0)
    expect(h.posted('/upload/simple')).toHaveLength(0)
  })

  it('fails when no token comes back', async () => {
    h.state.tokenData = { embed_url: '' }
    const { result } = await startWith()
    await settled(result)
    expect(result.current).toMatchObject({ videoUploadStatus: 'error', statusText: 'upload.errors.noToken' })
  })

  it('never opens a session for an empty file', async () => {
    const { result } = await startWith(h.videoFile(0))
    await settled(result)
    expect(h.fns.toastMessage).toHaveBeenCalledWith('upload.progress.stillStuck')
    expect(h.posted('/upload/probe')).toHaveLength(0)
    expect(h.posted('/upload/chunk/create')).toHaveLength(0)
  })

  // BUG: the diagnostics line's chunk counter never moves during a fresh
  // session. runChunkedUpload paints `chunksDone: received.size`, but `received`
  // is only filled from create/status and never updated when a chunk lands
  // (src/context/EmbedUploadContext.jsx, paint() at line 1145 and the success
  // branch at line 1200), so a finished upload still reads "0 of 3 chunks".
  it('BUG: the chunk counter counts the chunks that landed', async () => {
    const { result } = await startWith()
    await settled(result)
    expect(result.current.uploadDetail).toMatchObject({ chunksDone: 3, chunksTotal: 3 })
  })

  it('the single request failing as well is the final error', async () => {
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk') return { status: 404, body: {} }
      if (path === '/upload/simple') return { status: 500, body: { error: 'disk full' } }
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    await settled(result)
    expect(result.current).toMatchObject({ videoUploadStatus: 'error', statusText: 'disk full' })
  })

  it('a single request answered without an embed URL is a failure', async () => {
    h.xhr.server.simpleEmbedUrl = ''
    h.xhr.handler = (path, req) => (path === '/upload/chunk' ? { status: 404, body: {} } : h.defaultChunkServer(path, req))
    const { result } = await startWith()
    await settled(result)
    expect(result.current.statusText).toBe('upload.errors.singleNoEmbedUrl')
  })

  it('a chunk upload that moves no bytes for 45 seconds is aborted and retried', async () => {
    vi.useFakeTimers()
    let stalls = 0
    h.xhr.handler = (path, req) => {
      if (path === '/upload/chunk' && req.form.get('index') === '0' && stalls === 0) { stalls += 1; return 'hang' }
      return h.defaultChunkServer(path, req)
    }
    const { result } = await startWith()
    await advance(48000)
    expect(result.current.uploadDetail).toMatchObject({ lastError: 'STALLED' })
    await advance(3000)
    expect(result.current.videoUploadStatus).toBe('done')
  })
})

describe('cancelling', () => {
  it('stops the upload, clears the bar and does not restart for the same file', async () => {
    h.tus.behaviour = 'hang'
    const { result } = await startWith()
    await waitFor(() => expect(h.tus.uploads).toHaveLength(1))
    act(() => result.current.cancelEarlyUpload())
    expect(h.tus.uploads[0].abort).toHaveBeenCalledWith(true)
    expect(result.current).toMatchObject({ videoUploadStatus: 'idle', uploadProgress: 0, statusText: '', uploadDetail: null })
    expect(h.fns.toastMessage).toHaveBeenCalledWith('upload.progress.cancelled')

    act(() => result.current.startEarlyUpload())
    expect(result.current.videoUploadStatus).toBe('idle')
    expect(h.tus.uploads).toHaveLength(1)
  })

  it('a newly picked file uploads again after a cancel', async () => {
    h.tus.behaviour = 'hang'
    const { result } = await startWith()
    await waitFor(() => expect(h.tus.uploads).toHaveLength(1))
    act(() => result.current.cancelEarlyUpload())
    h.tus.behaviour = 'success'
    act(() => result.current.setVideoFile(h.videoFile(FILE_BYTES, 'new.mp4')))
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(result.current.videoUploadStatus).toBe('done'))
  })

  it('aborts chunk requests in flight, and a user reset never escalates to another method', async () => {
    h.tus.behaviour = patchBlocked
    h.xhr.handler = (path, req) => (path === '/upload/chunk' ? 'hang' : h.defaultChunkServer(path, req))
    const { result } = await startWith()
    await waitFor(() => expect(h.posted('/upload/chunk')).toHaveLength(1))
    act(() => result.current.cancelEarlyUpload())
    expect(h.posted('/upload/chunk')[0].aborted).toBe(true)
    await act(async () => {})
    expect(h.posted('/upload/simple')).toHaveLength(0)
  })

  // BUG: a background attempt that is abandoned (the user picks another video
  // while a chunked upload runs) still reports its own failure when its aborted
  // request settles. Its catch in startEarlyUpload (src/context/EmbedUploadContext.jsx,
  // lines 1453-1467) writes the SHARED refs and state, so it marks the NEW
  // upload as failed, nulls the new attempt's promise (publish then uploads the
  // file a second time) and lets the details step start yet another upload.
  it('BUG: replacing the video mid-upload does not mark the new upload as failed', async () => {
    h.tus.behaviour = patchBlocked
    // Chunks never answer, so both uploads are still running when we look.
    h.xhr.handler = (path, req) => (path === '/upload/chunk' ? 'hang' : h.defaultChunkServer(path, req))
    const { result } = await startWith()
    await waitFor(() => expect(h.posted('/upload/chunk')).toHaveLength(1))
    act(() => result.current.setVideoFile(h.videoFile(FILE_BYTES, 'replacement.mp4')))
    act(() => result.current.startEarlyUpload())
    await waitFor(() => expect(h.posted('/upload/chunk')).toHaveLength(2))
    expect(h.posted('/upload/chunk')[0].aborted).toBe(true)
    expect(result.current.videoUploadStatus).toBe('uploading')
    expect(h.fns.toastError).not.toHaveBeenCalled()
  })
})
