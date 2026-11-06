// @vitest-environment jsdom
// The video import client (src/lib/youtubeImport.js): every /api/yt-import call
// with its auth, the single 401 session re-mint, error codes, the streamed file
// download with progress, the thumbnail as a data URL, Hive tag cleanup and the
// hand-off to the embed studio. fetch is stubbed; aioha is mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ provider: vi.fn(), establish: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({
  getCurrentProvider: h.provider,
  establishWalletSession: h.establish,
  Providers: { HiveSigner: 'hivesigner', Keychain: 'keychain' },
}))

import {
  IMPORT_MODE_PLATFORMS,
  getImportStatus,
  refreshImportLists,
  listChannelVideos,
  resolveImportUrl,
  listTikTokVideos,
  listInstagramVideos,
  listPlatformVideos,
  markImportPublished,
  startImportJob,
  getImportJob,
  getImportBatches,
  createImportBatch,
  cancelImportBatch,
  cancelImportJob,
  downloadImportFile,
  fetchThumbnailDataUrl,
  toHiveTags,
  handOffToStudio,
  fmtDuration,
  youtubeStudioUrl,
  youtubeWatchUrl,
} from '../../../src/lib/youtubeImport.js'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let f
const stub = (...responses) => {
  f = vi.fn()
  responses.forEach((r) => f.mockResolvedValueOnce(r))
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => {
  h.provider.mockReset().mockReturnValue('keychain')
  h.establish.mockReset()
  localStorage.clear()
})
afterEach(() => {
  delete window.__pwaSharedFile
  delete window.__ytImportMeta
})

describe('IMPORT_MODE_PLATFORMS', () => {
  it('keeps short-form-only and long-form-only platforms apart', () => {
    expect(IMPORT_MODE_PLATFORMS.shorts).toContain('tiktok')
    expect(IMPORT_MODE_PLATFORMS.shorts).not.toContain('bitchute')
    expect(IMPORT_MODE_PLATFORMS.videos).toContain('bitchute')
    expect(IMPORT_MODE_PLATFORMS.videos).not.toContain('instagram')
  })
})

describe('API calls', () => {
  it.each([
    ['getImportStatus', () => getImportStatus(), '/api/yt-import/status', 'GET', undefined],
    ['refreshImportLists', () => refreshImportLists(), '/api/yt-import/refresh', 'POST', {}],
    ['listChannelVideos with filters', () => listChannelVideos({ channel: 'UC1', type: 'shorts', pageToken: 'n2' }), '/api/yt-import/videos?channel=UC1&type=shorts&pageToken=n2', 'GET', undefined],
    ['listChannelVideos bare', () => listChannelVideos(), '/api/yt-import/videos', 'GET', undefined],
    ['resolveImportUrl', () => resolveImportUrl('https://tiktok.com/@x/1'), '/api/yt-import/resolve', 'POST', { url: 'https://tiktok.com/@x/1' }],
    ['listTikTokVideos', () => listTikTokVideos(), '/api/yt-import/tiktok/videos', 'GET', undefined],
    ['listInstagramVideos', () => listInstagramVideos(), '/api/yt-import/instagram/videos', 'GET', undefined],
    ['listPlatformVideos', () => listPlatformVideos('rumble', 2), '/api/yt-import/rumble/videos?page=2', 'GET', undefined],
    ['listPlatformVideos first page', () => listPlatformVideos('bitchute'), '/api/yt-import/bitchute/videos?page=0', 'GET', undefined],
    ['markImportPublished', () => markImportPublished('tiktok:1', 'perm'), '/api/yt-import/published', 'POST', { source: 'tiktok:1', permlink: 'perm' }],
    ['startImportJob by id', () => startImportJob({ id: 'yt1' }), '/api/yt-import/jobs', 'POST', { videoId: 'yt1' }],
    ['startImportJob by token', () => startImportJob({ id: 'x', token: 'tok' }), '/api/yt-import/jobs', 'POST', { token: 'tok' }],
    ['getImportJob', () => getImportJob('a/b'), '/api/yt-import/jobs/a%2Fb', 'GET', undefined],
    ['getImportBatches', () => getImportBatches(), '/api/yt-import/batch', 'GET', undefined],
    ['createImportBatch', () => createImportBatch([{ videoId: 'v' }], { schedule: true }), '/api/yt-import/batch', 'POST', { items: [{ videoId: 'v' }], options: { schedule: true } }],
    ['cancelImportBatch', () => cancelImportBatch('b1'), '/api/yt-import/batch/b1/cancel', 'POST', undefined],
    ['cancelImportJob', () => cancelImportJob('j1'), '/api/yt-import/jobs/j1', 'DELETE', undefined],
  ])('%s', async (_, run, url, method, body) => {
    stub(json(200, { ok: true }))
    expect(await run()).toEqual({ ok: true })
    const [calledUrl, init] = f.mock.calls[0]
    expect(calledUrl).toBe(url)
    expect(init.method).toBe(method)
    expect(init.credentials).toBe('include')
    if (body === undefined) {
      expect(init.body).toBeUndefined()
      expect(init.headers).toEqual({})
    } else {
      expect(JSON.parse(init.body)).toEqual(body)
      expect(init.headers['Content-Type']).toBe('application/json')
    }
  })

  it('sends the HiveSigner token as a bearer header', async () => {
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'tok')
    stub(json(200, {}))
    await getImportStatus()
    expect(f.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('sends no bearer header for HiveSigner without a token', async () => {
    h.provider.mockReturnValue('hivesigner')
    stub(json(200, {}))
    await getImportStatus()
    expect(f.mock.calls[0][1].headers).toEqual({})
  })

  it('re-mints the wallet session once on a 401 and retries', async () => {
    h.establish.mockResolvedValue(true)
    stub(json(401, {}), json(200, { linked: true }))
    expect(await getImportStatus()).toEqual({ linked: true })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('keeps the 401 when no session can be made', async () => {
    h.establish.mockResolvedValue(false)
    stub(json(401, { error: 'not signed in', errorCode: 'no_session' }))
    await expect(getImportStatus()).rejects.toMatchObject({ message: 'not signed in', status: 401, code: 'no_session' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('keeps the 401 when re-minting throws', async () => {
    h.establish.mockRejectedValue(new Error('popup closed'))
    stub(json(401, {}))
    await expect(getImportStatus()).rejects.toMatchObject({ message: 'HTTP 401', status: 401, code: null })
  })

  it('reports a status-only error when the body is not JSON', async () => {
    stub({ ok: false, status: 429, json: async () => { throw new Error('html') } })
    await expect(refreshImportLists()).rejects.toMatchObject({ message: 'HTTP 429', status: 429 })
  })

  it('answers an empty object for an OK answer without JSON', async () => {
    stub({ ok: true, status: 204, json: async () => { throw new Error('empty') } })
    expect(await getImportStatus()).toEqual({})
  })

  it('swallows a failed job cancel', async () => {
    stub(json(404, { error: 'gone' }))
    expect(await cancelImportJob('j')).toBeNull()
  })
})

describe('downloadImportFile', () => {
  const streamOf = (chunks) => {
    let i = 0
    return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) }
  }

  it('streams the file and reports progress from the content length', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4])]
    stub({ ok: true, status: 200, headers: new Headers({ 'content-length': '4' }), body: streamOf(chunks) })
    const progress = []
    const file = await downloadImportFile('job 1', 'vid', (p) => progress.push(p))
    expect(f.mock.calls[0][0]).toBe('/api/yt-import/jobs/job%201/file')
    expect(progress).toEqual([0.75, 1])
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('import-vid.mp4')
    expect(file.type).toBe('video/mp4')
    expect(file.size).toBe(4)
  })

  it('reads the whole blob when the size is unknown', async () => {
    const blob = new Blob([new Uint8Array(7)])
    stub({ ok: true, status: 200, headers: new Headers(), body: streamOf([]), blob: async () => blob })
    const onProgress = vi.fn()
    const file = await downloadImportFile('j', 'v', onProgress)
    expect(file.size).toBe(7)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('throws the server error when the file is not ready', async () => {
    stub(json(409, { error: 'still downloading' }))
    await expect(downloadImportFile('j', 'v')).rejects.toMatchObject({ message: 'still downloading', status: 409 })
  })
})

describe('fetchThumbnailDataUrl', () => {
  it('reads a YouTube thumbnail through our proxy as a data URL', async () => {
    stub({ ok: true, blob: async () => new Blob(['hi'], { type: 'text/plain' }) })
    const url = await fetchThumbnailDataUrl({ platform: 'youtube', id: 'a b' })
    expect(f).toHaveBeenCalledWith('/api/yt-import/thumb/a%20b', { credentials: 'include' })
    expect(url).toBe('data:text/plain;base64,aGk=')
  })

  it('reads other platforms from their own thumbnail address', async () => {
    stub({ ok: true, blob: async () => new Blob(['x']) })
    await fetchThumbnailDataUrl({ platform: 'tiktok', thumbnail: 'https://cdn/t.jpg' })
    expect(f.mock.calls[0][0]).toBe('https://cdn/t.jpg')
  })

  it.each([
    ['no thumbnail address', { platform: 'tiktok' }, () => stub()],
    ['an error status', { platform: 'youtube', id: 'x' }, () => stub({ ok: false })],
    ['a network failure', { platform: 'youtube', id: 'x' }, () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))],
  ])('answers null for %s', async (_, video, arrange) => {
    arrange()
    expect(await fetchThumbnailDataUrl(video)).toBeNull()
  })

  it('answers null when the image cannot be read', async () => {
    stub({ ok: true, blob: async () => new Blob(['x']) })
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function fail() { this.onerror() })
    expect(await fetchThumbnailDataUrl({ platform: 'youtube', id: 'x' })).toBeNull()
  })
})

describe('toHiveTags', () => {
  it('squashes free-text tags into Hive tags and adds description hashtags', () => {
    expect(toHiveTags({
      tags: ['My Vlog', 'Café Life', 'a', '2024recap', 'snake_case', '--dashes--', 'my vlog', 'x'.repeat(30)],
      description: 'Watch #Travel and #über #9lives #a',
    })).toEqual(['my-vlog', 'cafe-life', 'snake-case', 'dashes', 'x'.repeat(24), 'travel', 'uber'])
  })

  it('stops at the maximum and copes with no tags at all', () => {
    expect(toHiveTags({ tags: ['aa', 'bb', 'cc'] }, 2)).toEqual(['aa', 'bb'])
    expect(toHiveTags({})).toEqual([])
  })
})

describe('handOffToStudio', () => {
  it('leaves the file and metadata where the embed studio picks them up', () => {
    const file = new File(['x'], 'a.mp4')
    handOffToStudio(file, { id: 'yt1', title: 't'.repeat(300), description: 'd #tag', tags: ['One'] }, 'data:img', 'short')
    expect(window.__pwaSharedFile).toBe(file)
    expect(window.__ytImportMeta).toEqual({
      mode: 'short',
      videoId: 'yt1',
      platform: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=yt1',
      title: 't'.repeat(255),
      description: 'd #tag',
      tags: ['one', 'tag'],
      thumbnail: 'data:img',
    })
  })

  it('keeps the source platform and link and defaults to a long-form upload', () => {
    handOffToStudio(null, { id: 'r1', platform: 'rumble', sourceUrl: 'https://rumble.com/r1' })
    expect(window.__ytImportMeta).toMatchObject({
      mode: 'longform', platform: 'rumble', sourceUrl: 'https://rumble.com/r1', title: '', description: '', thumbnail: null,
    })
  })
})

describe('fmtDuration and links', () => {
  it.each([
    [0, ''],
    [undefined, ''],
    [5, '0:05'],
    [754, '12:34'],
    [3754, '1:02:34'],
  ])('%s seconds -> %s', (s, expected) => {
    expect(fmtDuration(s)).toBe(expected)
  })

  it('builds the YouTube studio and watch links', () => {
    expect(youtubeStudioUrl('abc')).toBe('https://studio.youtube.com/video/abc/edit')
    expect(youtubeWatchUrl('abc')).toBe('https://www.youtube.com/watch?v=abc')
  })
})
