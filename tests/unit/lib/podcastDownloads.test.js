// Episodes saved for offline listening (src/lib/podcastDownloads.js), on an
// in-memory store in place of IndexedDB and a stubbed fetch.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  _useBackendForTests, downloadTrack, cancelDownload, removeDownload, isDownloaded, localAudioUrl, sourcesFor,
} from '../../../src/lib/podcastDownloads.js'

function memoryBackend(seed = []) {
  const meta = new Map(seed.map((m) => [m.id, m]))
  const files = new Map()
  return {
    meta,
    files,
    list: async () => [...meta.values()],
    put: async (m, blob) => { meta.set(m.id, m); files.set(m.id, blob) },
    remove: async (id) => { meta.delete(id); files.delete(id) },
    blob: async (id) => files.get(id) || null,
  }
}

const bytes = (n) => new Uint8Array(n).fill(7)

/** A Response streaming `chunks`, optionally without a length. */
function streamed(chunks, { type = 'audio/mpeg', length = true, status = 200 } = {}) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const body = new ReadableStream({
    start(ctrl) { chunks.forEach((c) => ctrl.enqueue(c)); ctrl.close() },
  })
  const headers = { 'content-type': type }
  if (length) headers['content-length'] = String(total)
  return new Response(body, { status, headers })
}

const outside = { _id: 'feed1:ep1', external: true, src: 'https://host.example/ep1.mp3', title: 'Ep 1', duration: 60 }
const threespeak = { _id: '64abc', owner: 'alice', permlink: 'p', audio_cid: 'bafyCID', title: 'Mine', duration: 30 }

let store
beforeEach(async () => {
  store = memoryBackend()
  await _useBackendForTests(store)
})

describe('where the audio comes from', () => {
  it('an outside episode: its host first, then the checker', () => {
    const s = sourcesFor(outside)
    expect(s[0]).toEqual({ url: 'https://host.example/ep1.mp3', checker: false })
    expect(s[1].checker).toBe(true)
    expect(s[1].url).toMatch(/\/podcasts\/episode\/feed1%3Aep1\/download$/)
  })

  it('a 3Speak audio: the audio gateway', () => {
    expect(sourcesFor(threespeak)).toEqual([{ url: 'https://ipfs-audio.3speak.tv/ipfs/bafyCID', checker: false }])
  })

  it('a live stream is never saved', () => {
    expect(sourcesFor({ _id: 'live:f:1', external: true, live: true, src: 'https://x' })).toEqual([])
  })
})

describe('downloadTrack', () => {
  it('saves the file straight from the host and remembers it', async () => {
    const fetchMock = vi.fn(async () => streamed([bytes(1000), bytes(500)]))
    vi.stubGlobal('fetch', fetchMock)
    expect(isDownloaded(outside._id)).toBe(false)
    await downloadTrack(outside)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ mode: 'cors' })
    expect(isDownloaded(outside._id)).toBe(true)
    const m = store.meta.get(outside._id)
    expect(m).toMatchObject({ id: outside._id, bytes: 1500, type: 'audio/mpeg' })
    expect(m.track.title).toBe('Ep 1')
    expect(store.files.get(outside._id).size).toBe(1500)
  })

  it('goes through the checker when the host refuses other sites', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.startsWith('https://host.example')) throw new TypeError('Failed to fetch')
      return streamed([bytes(10)], { length: false })
    })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTrack(outside)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/download$/)
    expect(isDownloaded(outside._id)).toBe(true)
  })

  it('does not keep a web page the host sent instead of audio', async () => {
    const fetchMock = vi.fn(async (url) => (url.startsWith('https://host.example')
      ? new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })
      : streamed([bytes(10)])))
    vi.stubGlobal('fetch', fetchMock)
    await downloadTrack(outside)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says when the checker finds the file too big, or is busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.startsWith('https://host.example')) throw new TypeError('cors')
      return new Response('{}', { status: 413 })
    }))
    await expect(downloadTrack(outside)).rejects.toMatchObject({ code: 'too_large' })
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.startsWith('https://host.example')) throw new TypeError('cors')
      return new Response('{}', { status: 429 })
    }))
    await expect(downloadTrack(outside)).rejects.toMatchObject({ code: 'rate_limited' })
    expect(isDownloaded(outside._id)).toBe(false)
  })

  it('saves a 3Speak audio from the gateway', async () => {
    const fetchMock = vi.fn(async () => streamed([bytes(42)]))
    vi.stubGlobal('fetch', fetchMock)
    await downloadTrack(threespeak)
    expect(fetchMock.mock.calls[0][0]).toBe('https://ipfs-audio.3speak.tv/ipfs/bafyCID')
    expect(isDownloaded('64abc')).toBe(true)
  })

  it('a second call for the same track joins the first', async () => {
    const fetchMock = vi.fn(async () => streamed([bytes(5)]))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([downloadTrack(outside), downloadTrack(outside)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('can be cancelled', async () => {
    let pull
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(ctrl) { ctrl.enqueue(bytes(10)); pull = ctrl },
    }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '1000' } })))
    const p = downloadTrack(outside)
    await new Promise((r) => setTimeout(r, 10))
    cancelDownload(outside._id)
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    expect(pull).toBeTruthy()
    expect(isDownloaded(outside._id)).toBe(false)
    expect(store.meta.size).toBe(0)
  })

  it('refuses a cut-off file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(ctrl) { ctrl.enqueue(bytes(10)); ctrl.close() },
    }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '1000' } })))
    await expect(downloadTrack({ ...threespeak })).rejects.toMatchObject({ code: 'failed' })
  })
})

describe('playing and forgetting', () => {
  it('makes one object URL per track and drops it on remove', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed([bytes(5)])))
    await downloadTrack(outside)
    const a = await localAudioUrl(outside._id)
    const b = await localAudioUrl(outside._id)
    expect(a).toMatch(/^blob:/)
    expect(b).toBe(a)
    expect(await localAudioUrl('nope')).toBeNull()
    await removeDownload(outside._id)
    expect(isDownloaded(outside._id)).toBe(false)
    expect(store.meta.size).toBe(0)
    expect(await localAudioUrl(outside._id)).toBeNull()
  })

  it('answers from the last known list until the store has loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed([bytes(5)])))
    await downloadTrack(outside)
    let release
    const slow = memoryBackend()
    slow.list = () => new Promise((r) => { release = () => r([]) })
    const loading = _useBackendForTests(slow)
    expect(isDownloaded(outside._id)).toBe(true)
    release()
    await loading
    expect(isDownloaded(outside._id)).toBe(false)
  })

  it('loads what was saved before', async () => {
    await _useBackendForTests(memoryBackend([{ id: 'x', track: { _id: 'x' }, bytes: 3, savedAt: 1 }]))
    expect(isDownloaded('x')).toBe(true)
  })
})
