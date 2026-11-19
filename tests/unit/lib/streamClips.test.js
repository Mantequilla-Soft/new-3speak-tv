// @vitest-environment jsdom
// Highlight clips that become Shorts (H13), the data layer (src/lib/streamClips.js):
// who gets the locked share, how it lands in the beneficiaries, the hangouts calls.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  clipShareFor, applyClipShare, streamClipMetadata, momentRanges, clipClock,
  makeClip, fetchStreamHighlights, deleteClip, fetchClipFile, clipFileUrl, shortUrlFor,
  fetchMyClips, clipSummary, isReadyClip, readClipQueue, writeClipQueue,
  CLIPPER_SHARE_PERCENT, HOST_SHARE_PERCENT,
} from '../../../src/lib/streamClips.js'

const API = 'https://live.3speak.tv/'
afterEach(() => vi.unstubAllGlobals())

describe('clipShareFor', () => {
  it('the host posting a viewer\'s clip gives the clipper 30 %', () => {
    expect(clipShareFor({ poster: 'badadib', host: 'BadAdib', clipper: 'fan' })).toEqual({ account: 'fan', percent: CLIPPER_SHARE_PERCENT, role: 'clipper' })
    expect(CLIPPER_SHARE_PERCENT).toBe(30)
  })

  it('a viewer posting their clip gives the host 50 %; nobody pays themselves', () => {
    expect(clipShareFor({ poster: 'fan', host: 'badadib', clipper: 'fan' })).toEqual({ account: 'badadib', percent: HOST_SHARE_PERCENT, role: 'host' })
    expect(clipShareFor({ poster: 'badadib', host: 'badadib', clipper: 'badadib' })).toBeNull()
    expect(clipShareFor({ poster: 'badadib', host: 'badadib', clipper: null })).toBeNull()
    expect(clipShareFor({ poster: '', host: 'badadib', clipper: 'fan' })).toBeNull()
    expect(clipShareFor({ poster: 'fan', host: null, clipper: 'fan' })).toBeNull()
  })
})

describe('applyClipShare', () => {
  it('sets at least the share\'s weight, never for the poster, only while a slot is free', () => {
    const m = new Map([['threespeakfund', 1000]])
    applyClipShare(m, { share: { account: 'fan', percent: 10 } }, 'badadib')
    expect(m.get('fan')).toBe(1000)
    m.set('fan', 2500)
    applyClipShare(m, { share: { account: 'fan', percent: 10 } }, 'badadib')
    expect(m.get('fan')).toBe(2500)
    applyClipShare(m, { share: { account: 'badadib', percent: 10 } }, 'badadib')
    expect(m.has('badadib')).toBe(false)
    const full = new Map(Array.from({ length: 8 }, (_, i) => [`a${i}`, 100]))
    applyClipShare(full, { share: { account: 'fan', percent: 10 } }, 'badadib')
    expect(full.has('fan')).toBe(false)
    applyClipShare(m, { share: { account: 'x', percent: 0 } }, 'badadib')
    applyClipShare(m, null, 'badadib')
    expect(m.has('x')).toBe(false)
  })
})

describe('streamClipMetadata, momentRanges, clipClock', () => {
  it('records room, host, clipper and offset', () => {
    expect(streamClipMetadata({ room: 'badadib-r1', host: 'BadAdib', clipper: 'Fan', offsetSec: 12 })).toEqual({ room: 'badadib-r1', host: 'badadib', clipper: 'fan', offset: 12 })
    expect(streamClipMetadata({ room: 'r', host: null, clipper: null })).toEqual({ room: 'r', host: null, clipper: null })
    expect(streamClipMetadata(null)).toBeNull()
  })

  it('turns moments without an automatic clip into replay ranges reaching back from the bucket end', () => {
    const moments = [{ at: 1, offsetSec: 600, reasons: ['chat'] }, { at: 2, offsetSec: 900, reasons: ['boosts'] }, { at: 3, offsetSec: null }, { at: 4, offsetSec: 20 }]
    const clips = [{ source: 'auto', offsetSec: 900 }, { source: 'viewer', offsetSec: 600 }]
    expect(momentRanges(moments, clips).map((r) => [r.start, r.end, r.reasons])).toEqual([[555, 605, ['chat']], [0, 25, []]])
    expect(momentRanges(null, null)).toEqual([])
  })

  it('formats clock times', () => {
    expect(clipClock(754)).toBe('12:34')
    expect(clipClock(3725)).toBe('1:02:05')
    expect(clipClock('x')).toBe('0:00')
  })
})

describe('hangouts calls', () => {
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['MP4'], { type: 'video/mp4' }) })

  it('makeClip posts with the session and throws the status', async () => {
    const f = vi.fn().mockResolvedValue(json({ path: '/dvr/clips/a.mp4', clip: { id: 'x' } }))
    vi.stubGlobal('fetch', f)
    expect(await makeClip(API, 'badadib-r1', 'tok')).toEqual({ path: '/dvr/clips/a.mp4', clip: { id: 'x' } })
    expect(f).toHaveBeenCalledWith('https://live.3speak.tv/rooms/badadib-r1/dvr/clip', { method: 'POST', headers: { Authorization: 'Bearer tok' } })
    f.mockResolvedValue(json({}, 429))
    await expect(makeClip(API, 'r', null)).rejects.toMatchObject({ status: 429 })
    expect(f.mock.calls[1][1].headers).toEqual({})
  })

  it('fetchStreamHighlights: null without a session or on 401, defaults the lists, throws other errors', async () => {
    expect(await fetchStreamHighlights(API, 'r', null)).toBeNull()
    const f = vi.fn().mockResolvedValue(json({ host: 'badadib', isHost: true, moments: [{ at: 1 }] }))
    vi.stubGlobal('fetch', f)
    expect(await fetchStreamHighlights(API, 'r', 'tok')).toEqual({ host: 'badadib', isHost: true, liveAt: null, moments: [{ at: 1 }], clips: [] })
    expect(f.mock.calls[0][0]).toBe('https://live.3speak.tv/rooms/r/highlights')
    f.mockResolvedValue(json({}, 401))
    expect(await fetchStreamHighlights(API, 'r', 'tok')).toBeNull()
    f.mockResolvedValue(json({}, 500))
    await expect(fetchStreamHighlights(API, 'r', 'tok')).rejects.toThrow('highlights: 500')
  })

  it('deleteClip, fetchClipFile and clipFileUrl', async () => {
    const f = vi.fn().mockResolvedValue(json({ deleted: true }))
    vi.stubGlobal('fetch', f)
    expect(await deleteClip(API, 'abc', 'tok')).toBe(true)
    expect(f).toHaveBeenCalledWith('https://live.3speak.tv/clips/abc', { method: 'DELETE', headers: { Authorization: 'Bearer tok' } })
    const file = await fetchClipFile('https://live.3speak.tv/dvr/clips/a.mp4')
    expect(file.name).toBe('stream-clip.mp4')
    expect(file.type).toBe('video/mp4')
    f.mockResolvedValue(json({}, 404))
    await expect(deleteClip(API, 'abc', 'tok')).rejects.toThrow()
    await expect(fetchClipFile('u')).rejects.toThrow('clip file: 404')
    expect(clipFileUrl(API, '/dvr/clips/a.mp4')).toBe('https://live.3speak.tv/dvr/clips/a.mp4')
  })

  it('shortUrlFor: the vertical copy when the stream had a phone crop, else (or on failure) the clip', async () => {
    const plain = { id: 'c1', path: '/dvr/clips/a.mp4', vertical: { available: false, path: null } }
    expect(await shortUrlFor(API, plain, 'tok')).toBe('https://live.3speak.tv/dvr/clips/a.mp4')
    expect(await shortUrlFor(API, { ...plain, vertical: { available: true, path: '/dvr/clips/a-v.mp4' } }, 'tok')).toBe('https://live.3speak.tv/dvr/clips/a-v.mp4')
    const f = vi.fn().mockResolvedValue(json({ clip: { vertical: { available: true, path: '/dvr/clips/a-v2.mp4' } } }))
    vi.stubGlobal('fetch', f)
    const crop = { ...plain, vertical: { available: true, path: null } }
    expect(await shortUrlFor(API, crop, 'tok')).toBe('https://live.3speak.tv/dvr/clips/a-v2.mp4')
    expect(f).toHaveBeenCalledWith('https://live.3speak.tv/clips/c1/vertical', { method: 'POST', headers: { Authorization: 'Bearer tok' } })
    f.mockResolvedValue(json({}, 500))
    expect(await shortUrlFor(API, crop, 'tok')).toBe('https://live.3speak.tv/dvr/clips/a.mp4')
    f.mockRejectedValue(new Error('down'))
    expect(await shortUrlFor(API, crop, 'tok')).toBe('https://live.3speak.tv/dvr/clips/a.mp4')
    expect(await shortUrlFor(API, crop, null)).toBe('https://live.3speak.tv/dvr/clips/a.mp4')
  })

  it('fetchMyClips tags each clip with its server and knows the keep time', async () => {
    expect(await fetchMyClips(API, null)).toBeNull()
    const f = vi.fn().mockResolvedValue(json({ clips: [{ id: 'a' }], keepHours: 24 }))
    vi.stubGlobal('fetch', f)
    expect(await fetchMyClips(API, 'tok')).toEqual({ clips: [{ id: 'a', api: 'https://live.3speak.tv' }], keepHours: 24 })
    expect(f).toHaveBeenCalledWith('https://live.3speak.tv/clips/mine', { headers: { Authorization: 'Bearer tok' } })
    f.mockResolvedValue(json({}, 401))
    expect(await fetchMyClips(API, 'tok')).toBeNull()
    f.mockResolvedValue(json({}, 500))
    await expect(fetchMyClips(API, 'tok')).rejects.toThrow()
  })
})

describe('clipSummary, isReadyClip and the post queue', () => {
  it('counts clips per viewer, automatic and guest ones, and how many are still being cut', () => {
    const clips = [
      { clipper: 'fan', source: 'viewer', status: 'pending' }, { clipper: 'fan', source: 'viewer', status: 'ready', path: '/x' },
      { clipper: 'badadib', source: 'host', status: 'ready', path: '/y' }, { clipper: null, source: 'auto', status: 'pending' },
      { clipper: null, source: 'viewer', path: '/z' }, { clipper: 'late', source: 'viewer', status: 'unavailable' },
    ]
    expect(clipSummary(clips)).toEqual({ total: 5, byUser: [{ user: 'fan', count: 2 }, { user: 'badadib', count: 1 }], auto: 1, guests: 1, pending: 2, ready: 3 })
    expect(clipSummary(null).total).toBe(0)
    expect(isReadyClip({ path: '/a' })).toBe(true)
    expect(isReadyClip({ status: 'pending', path: null })).toBe(false)
  })

  it('keeps the queue of clips still to post in this browser', () => {
    writeClipQueue([{ id: 'a', api: API, path: '/p' }, { id: 'bad' }])
    expect(readClipQueue()).toEqual([{ id: 'a', api: API, path: '/p' }])
    writeClipQueue([])
    expect(readClipQueue()).toEqual([])
  })
})
