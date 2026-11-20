// ⏳ The free plan's daily upload limit in the video studio (src/context/EmbedUploadContext.jsx):
// a 429 `daily_upload_limit` from the upload-token mint is final on all three
// transports (TUS, chunked, single request). 🚨 TUS must NOT fall back to the
// API-key upload then. Same fakes as embedUploadTransport.test.jsx.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
const FILE_BYTES = 600 * KB
const NEXT_AT = '2026-11-21T14:32:00Z'
const tokenCalls = () => h.fns.axiosPost.mock.calls.filter(([url]) => url.endsWith('/uploads/token'))
const patchBlocked = (up) => up.options.onError(Object.assign(new Error('blocked'), { code: 'PATCH_BLOCKED' }))
// What the embed API answers a mint over the limit.
const limitRefusal = (kind = 'video') => Object.assign(new Error('Request failed with status code 429'), {
  response: { status: 429, data: { error: 'Daily upload limit reached', code: 'daily_upload_limit', kind, limit: kind === 'short' ? 3 : 1, used: kind === 'short' ? 3 : 1, next_at: NEXT_AT, upgrade_url: 'https://3speak.tv/wallet/badadib#pro' } },
})
// Answer the n-th token mint (0-based) with `err`, the others as usual.
function refuseMint(n, err) {
  let i = 0
  const normal = h.fns.axiosPost.getMockImplementation()
  h.fns.axiosPost.mockImplementation((url, ...rest) => {
    if (url.endsWith('/uploads/token') && i++ === n) return Promise.reject(err)
    return normal(url, ...rest)
  })
}

async function startWith(file = h.videoFile(FILE_BYTES), { setup } = {}) {
  const hook = renderHook(() => useEmbedUpload(), { wrapper: EmbedUploadProvider })
  act(() => {
    hook.result.current.setVideoFile(file)
    hook.result.current.setVideoDuration(42)
    setup?.(hook.result.current)
  })
  act(() => hook.result.current.startEarlyUpload())
  return hook
}
const settled = (result) => waitFor(() => expect(['done', 'error']).toContain(result.current.videoUploadStatus))

beforeEach(() => {
  h.reset()
  localStorage.clear()
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true })
  vi.stubGlobal('XMLHttpRequest', h.FakeXHR)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('a mint over the daily limit (429 daily_upload_limit)', () => {
  it('TUS: never falls back to the API-key upload, says why, with Go Pro', async () => {
    refuseMint(0, limitRefusal('video'))
    const { result } = await startWith()
    await settled(result)
    // 🚨 No upload at all: the API-key fallback would carry the video past the limit.
    expect(h.tus.uploads).toHaveLength(0)
    expect(h.xhr.requests).toHaveLength(0)
    expect(tokenCalls()).toHaveLength(1)
    expect(result.current.videoUploadStatus).toBe('error')
    expect(result.current.statusText).toMatch(/^uploadLimits\.reached\.video uploadLimits\.nextAt /)
    expect(result.current.uploadLimit).toMatchObject({ code: 'daily_upload_limit', kind: 'video', limit: 1, used: 1, nextAt: Date.parse(NEXT_AT) })
    const [[message, opts]] = h.fns.toastError.mock.calls
    expect(message).toMatch(/^uploadLimits\.reached\.video/)
    expect(opts.action.label).toBe('uploadLimits.goPro')
    opts.action.onClick()
    expect(h.fns.navigate).toHaveBeenCalledWith('/wallet/badadib#pro')
  })

  it('TUS: any other mint failure still falls back to the API key, as before', async () => {
    refuseMint(0, Object.assign(new Error('busy'), { response: { status: 429, data: { error: 'Too many requests' } } }))
    const { result } = await startWith()
    await settled(result)
    expect(h.tus.uploads).toHaveLength(1)
    expect(h.tus.uploads[0].options.headers).toEqual({ 'X-API-Key': 'embed-key' })
    expect(result.current.videoUploadStatus).toBe('done')
    expect(result.current.uploadLimit).toBeNull()
  })

  it('a Short is refused as a Short', async () => {
    refuseMint(0, limitRefusal('short'))
    const { result } = await startWith(undefined, { setup: (c) => c.setFromStories(true) })
    await settled(result)
    expect(result.current.uploadLimit).toMatchObject({ kind: 'short', limit: 3 })
    expect(result.current.statusText).toMatch(/^uploadLimits\.reached\.short/)
  })

  it('chunked: stops at the refusal, without trying the single request', async () => {
    h.tus.behaviour = patchBlocked
    refuseMint(1, limitRefusal('video'))      // TUS minted fine, then PATCH was blocked
    const { result } = await startWith()
    await settled(result)
    expect(tokenCalls()).toHaveLength(2)
    expect(h.posted('/upload/chunk/create')).toHaveLength(0)
    expect(h.posted('/upload/simple')).toHaveLength(0)
    expect(result.current.videoUploadStatus).toBe('error')
    expect(result.current.uploadLimit).toMatchObject({ kind: 'video' })
  })

  it('single request: refused the same way', async () => {
    h.tus.behaviour = patchBlocked
    // A chunk session the server forgot: chunked gives up, the single request takes over
    h.xhr.handler = (path, req) => (path === '/upload/chunk' ? { status: 404, body: { error: 'gone' } } : h.defaultChunkServer(path, req))
    refuseMint(2, limitRefusal('video'))
    const { result } = await startWith()
    await settled(result)
    expect(result.current.videoUploadStatus).toBe('error')
    expect(tokenCalls()).toHaveLength(3)
    expect(h.posted('/upload/simple')).toHaveLength(0)
    expect(result.current.uploadLimit).toMatchObject({ code: 'daily_upload_limit' })
  })

  it('the background upload does not start the refused file again by itself', async () => {
    refuseMint(0, limitRefusal('video'))
    const { result } = await startWith()
    await settled(result)
    act(() => result.current.startEarlyUpload())
    act(() => result.current.startEarlyUpload())
    expect(tokenCalls()).toHaveLength(1)
  })

  it('picking another video clears the refusal', async () => {
    refuseMint(0, limitRefusal('video'))
    const { result } = await startWith()
    await settled(result)
    act(() => result.current.clearVideoSelection())
    expect(result.current.uploadLimit).toBeNull()
  })
})
