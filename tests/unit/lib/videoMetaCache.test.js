// Session cache for a video's player metadata (src/lib/videoMetaCache.js):
// one request per video, shared by concurrent callers, failures retried later.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let resolveVideoMeta
beforeEach(async () => {
  vi.resetModules()
  ;({ resolveVideoMeta } = await import('../../../src/lib/videoMetaCache.js'))
})

describe('resolveVideoMeta', () => {
  it('concurrent callers share one request', async () => {
    const api = { fetchVideoMetadata: vi.fn(async () => ({ owner: 'o', permlink: 'asset' })) }
    const [a, b] = await Promise.all([resolveVideoMeta(api, 'a', 'p'), resolveVideoMeta(api, 'a', 'p')])
    expect(a).toEqual({ owner: 'o', permlink: 'asset' })
    expect(b).toBe(a)
    expect(api.fetchVideoMetadata).toHaveBeenCalledTimes(1)
    expect(api.fetchVideoMetadata).toHaveBeenCalledWith('a', 'p')
  })

  it('a later call is served from the cache', async () => {
    const api = { fetchVideoMetadata: vi.fn(async () => ({ owner: 'o' })) }
    await resolveVideoMeta(api, 'a', 'p')
    await resolveVideoMeta(api, 'a', 'p')
    await resolveVideoMeta(api, 'a', 'other')
    expect(api.fetchVideoMetadata).toHaveBeenCalledTimes(2)
  })

  it('a failed lookup resolves to null and is tried again next time', async () => {
    const api = { fetchVideoMetadata: vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue({ owner: 'o' }) }
    expect(await resolveVideoMeta(api, 'a', 'p')).toBeNull()
    expect(await resolveVideoMeta(api, 'a', 'p')).toEqual({ owner: 'o' })
    expect(api.fetchVideoMetadata).toHaveBeenCalledTimes(2)
  })

  it('an empty answer or a missing api is null', async () => {
    expect(await resolveVideoMeta({ fetchVideoMetadata: async () => undefined }, 'a', 'p')).toBeNull()
    expect(await resolveVideoMeta(null, 'b', 'p')).toBeNull()
    expect(await resolveVideoMeta({}, 'c', 'p')).toBeNull()
  })

  it('keeps at most 200 videos, dropping the oldest first', async () => {
    const api = { fetchVideoMetadata: vi.fn(async (a, p) => ({ p })) }
    for (let i = 0; i < 201; i++) await resolveVideoMeta(api, 'a', `p${i}`)
    expect(api.fetchVideoMetadata).toHaveBeenCalledTimes(201)
    await resolveVideoMeta(api, 'a', 'p200')
    await resolveVideoMeta(api, 'a', 'p1')
    expect(api.fetchVideoMetadata).toHaveBeenCalledTimes(201)
    await resolveVideoMeta(api, 'a', 'p0')
    expect(api.fetchVideoMetadata).toHaveBeenCalledTimes(202)
  })
})
