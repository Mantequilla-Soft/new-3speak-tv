// Videos saved for offline (src/lib/videoDownloads.js) in the downloads store
// (src/lib/podcastDownloads.js), on an in-memory store in place of IndexedDB.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  _useBackendForTests, downloadTrack, removeDownload, isDownloaded, pruneExpired, downloadCap, setDownloadCap,
  DEFAULT_CAP_BYTES, partBlob, downloadEntry,
} from '../../../src/lib/podcastDownloads.js'
import {
  downloadVideo, videoDownloadId, planDownload, estimateBytes, offlinePlaylist, offlineLoaderClass,
  OFFLINE_PLAYLIST_URL, OFFLINE_BASE, daysLeft, isVideoDownload, VIDEO_TTL_DAYS, cancelVideoDownload,
} from '../../../src/lib/videoDownloads.js'

function memoryBackend(seed = []) {
  const meta = new Map(seed.map((m) => [m.id, m]))
  const files = new Map()
  return {
    meta,
    files,
    list: async () => [...meta.values()],
    put: async (m, blob) => { meta.set(m.id, m); files.set(m.id, blob) },
    putFile: async (key, blob) => { files.set(key, blob) },
    putMeta: async (m) => { meta.set(m.id, m) },
    remove: async (id, keys = []) => { meta.delete(id); files.delete(id); keys.forEach((k) => files.delete(k)) },
    blob: async (id) => files.get(id) || null,
  }
}

const PLAY = 'https://play.example/hls?u=master'
const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080
https://play.example/hls?u=1080
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=854x480
https://play.example/hls?u=480
`
const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:9
#EXTINF:8,
https://play.example/seg/a.ts
#EXTINF:4,
https://play.example/seg/b.ts
#EXT-X-ENDLIST
`
const DAY = 86400000

// A fetch for the player API's playlists, segments and the cover.
function network({ segBytes = 100, fail = null, slow = null } = {}) {
  return vi.fn(async (url, opts) => {
    if (slow && url.includes(slow)) {
      await new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    }
    if (fail && url.includes(fail)) return new Response('no', { status: 500 })
    if (url === PLAY) return new Response(MASTER)
    if (url.endsWith('u=480')) return new Response(MEDIA)
    if (url.includes('/seg/')) return new Response(new Uint8Array(segBytes), { headers: { 'content-type': 'video/mp2t' } })
    if (url.includes('img.example')) return new Response(new Uint8Array(10), { headers: { 'content-type': 'image/webp' } })
    return new Response('?', { status: 404 })
  })
}
const fetchSource = async () => ({ play_url: PLAY, thumbnail_url: 'https://img.example/t.webp', duration: 12 })
const VIDEO = { author: 'badadib', permlink: 'test-stream', title: 'Test stream' }

let store
beforeEach(async () => {
  localStorage.clear()
  store = memoryBackend()
  await _useBackendForTests(store)
})

describe('what is saved', () => {
  it('the best rendition at or under 480p, its segment list, and a guess at the size', async () => {
    const plan = await planDownload(PLAY, { fetchImpl: network() })
    expect(plan.rendition.height).toBe(480)
    expect(plan.segments.map((s) => s.duration)).toEqual([8, 4])
    expect(estimateBytes(plan)).toBe(1800000 / 8 * 12)
  })

  it('saves every segment and the cover, one file each, and expires in 30 days', async () => {
    const fetchImpl = network()
    const now = Date.UTC(2026, 10, 15)
    await downloadVideo(VIDEO, { fetchSource, fetchImpl, now: () => now })
    const id = videoDownloadId('badadib', 'test-stream')
    expect(isDownloaded(id)).toBe(true)
    const entry = downloadEntry(id)
    expect(entry).toMatchObject({
      kind: 'video', bytes: 210, thumbKey: `${id}#thumb`,
      track: { author: 'badadib', permlink: 'test-stream', title: 'Test stream', height: 480, duration: 12 },
      expiresAt: now + VIDEO_TTL_DAYS * DAY,
    })
    expect(entry.parts).toEqual([{ key: `${id}#0`, duration: 8 }, { key: `${id}#1`, duration: 4 }])
    expect((await partBlob(`${id}#1`)).size).toBe(100)
    expect(isVideoDownload(entry)).toBe(true)
    expect(daysLeft(entry, now + DAY * 29.5)).toBe(0)
    expect(daysLeft(entry, now)).toBe(30)
  })

  it('removing it removes its segments too', async () => {
    await downloadVideo(VIDEO, { fetchSource, fetchImpl: network() })
    const id = videoDownloadId('badadib', 'test-stream')
    await removeDownload(id)
    expect(isDownloaded(id)).toBe(false)
    expect(store.files.size).toBe(0)
  })

  it('a failed segment leaves nothing behind', async () => {
    await expect(downloadVideo(VIDEO, { fetchSource, fetchImpl: network({ fail: 'b.ts' }) })).rejects.toMatchObject({ code: 'failed' })
    expect(store.files.size).toBe(0)
    expect(store.meta.size).toBe(0)
  })

  it('a cancel stops it and leaves nothing behind', async () => {
    const p = downloadVideo(VIDEO, { fetchSource, fetchImpl: network({ slow: 'b.ts' }) })
    await vi.waitFor(() => expect(store.files.size).toBe(1))
    cancelVideoDownload('badadib', 'test-stream')
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    expect(store.files.size).toBe(0)
  })

  it('nothing to play is no_source', async () => {
    await expect(downloadVideo(VIDEO, { fetchSource: async () => null, fetchImpl: network() })).rejects.toMatchObject({ code: 'no_source' })
    await expect(downloadVideo({}, {})).rejects.toMatchObject({ code: 'no_source' })
  })
})

describe('the storage cap', () => {
  it('is 2 GB unless the listener picks another', () => {
    expect(downloadCap()).toBe(DEFAULT_CAP_BYTES)
    setDownloadCap(1e9)
    expect(downloadCap()).toBe(1e9)
    setDownloadCap(-1)
    expect(downloadCap()).toBe(1e9)
  })

  it('a video that would not fit is refused before anything is fetched', async () => {
    setDownloadCap(1000)
    // The guess (bandwidth x duration) is already far over 1000 bytes
    await expect(downloadVideo(VIDEO, { fetchSource, fetchImpl: network() })).rejects.toMatchObject({ code: 'cap' })
    expect(store.files.size).toBe(0)
  })

  it('applies to podcast downloads too', async () => {
    setDownloadCap(50)
    const ep = { _id: 'feed1:ep1', external: true, src: 'https://host.example/ep1.mp3', title: 'Ep 1', duration: 60 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(80), { headers: { 'content-type': 'audio/mpeg', 'content-length': '80' } })))
    await expect(downloadTrack(ep)).rejects.toMatchObject({ code: 'cap' })
    expect(isDownloaded('feed1:ep1')).toBe(false)
  })
})

describe('expiry', () => {
  it('an expired video is removed when the store opens, the rest stays', async () => {
    const old = { id: 'dlvideo:badadib/old', kind: 'video', track: {}, bytes: 5, parts: [{ key: 'dlvideo:badadib/old#0' }], expiresAt: Date.now() - 1000 }
    const ep = { id: 'feed1:ep1', track: { _id: 'feed1:ep1' }, bytes: 5 }
    const s = memoryBackend([old, ep])
    s.files.set('dlvideo:badadib/old#0', new Blob(['x']))
    await _useBackendForTests(s)
    expect(isDownloaded(old.id)).toBe(false)
    expect(isDownloaded(ep.id)).toBe(true)
    expect(s.files.has('dlvideo:badadib/old#0')).toBe(false)
  })

  it('pruneExpired removes what ran out while the page was open', async () => {
    await downloadVideo(VIDEO, { fetchSource, fetchImpl: network(), now: () => Date.now() })
    expect(await pruneExpired(Date.now())).toBe(0)
    expect(await pruneExpired(Date.now() + 31 * DAY)).toBe(1)
    expect(store.files.size).toBe(0)
  })
})

describe('playing it offline', () => {
  const entry = { id: 'dlvideo:a/b', parts: [{ key: 'k0', duration: 8 }, { key: 'k1', duration: 4 }] }

  it('rebuilds a playlist on the made-up offline address', () => {
    const text = offlinePlaylist(entry)
    expect(text).toContain(`${OFFLINE_BASE}seg-0.ts`)
    expect(text).toContain('#EXTINF:4.000000,')
    expect(text).toContain('#EXT-X-ENDLIST')
    const fmp4 = offlinePlaylist({ parts: [{ key: 'i', init: true }, { key: 's', duration: 2 }] })
    expect(fmp4).toContain(`#EXT-X-MAP:URI="${OFFLINE_BASE}seg-0.mp4"`)
    expect(fmp4).toContain(`${OFFLINE_BASE}seg-1.ts`)
  })

  it('the hls.js loader answers from storage and never from the network', async () => {
    class LoadStats { constructor() { this.loading = {}; this.aborted = false } }
    const read = vi.fn(async (key) => (key === 'k1' ? new Blob([new Uint8Array(7)]) : null))
    const Loader = offlineLoaderClass(entry, LoadStats, read)
    const run = (url) => new Promise((resolve) => {
      new Loader().load({ url }, {}, {
        onSuccess: (res, stats) => resolve({ ok: true, data: res.data, stats }),
        onError: (err) => resolve({ ok: false, err }),
      })
    })
    const pl = await run(OFFLINE_PLAYLIST_URL)
    expect(pl.ok).toBe(true)
    expect(pl.data).toContain('#EXTM3U')
    const seg = await run(`${OFFLINE_BASE}seg-1.ts`)
    expect(seg.ok).toBe(true)
    expect(seg.data.byteLength).toBe(7)
    expect(seg.stats.loaded).toBe(7)
    expect((await run(`${OFFLINE_BASE}seg-0.ts`)).ok).toBe(false)
    expect((await run('https://elsewhere.example/seg-1.ts')).ok).toBe(false)
    expect(read).not.toHaveBeenCalledWith(undefined)
  })
})
