// Watch history client (src/utils/watchHistory.js): request shapes and the
// "never throw, fall back to empty" contract when the playlists API is down.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ axios: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('axios', () => ({ default: h.axios }))
vi.mock('../../../src/utils/config', () => ({ PLAYLISTS_API_URL: 'https://pl.example/api' }))

import {
  recordWatch, batchCheckWatched, getWatchHistory, deleteWatchHistoryEntry, getWatchHistoryCount,
} from '../../../src/utils/watchHistory.js'

const down = () => Promise.reject(new Error('down'))

beforeEach(() => {
  Object.values(h.axios).forEach((f) => f.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('recordWatch', () => {
  it('records a watch, with the short flag only when given', async () => {
    h.axios.put.mockResolvedValue({ data: { ok: 1 } })
    expect(await recordWatch('me', 'a', 'p')).toEqual({ ok: 1 })
    await recordWatch('me', 'a', 'p', { short: false })
    expect(h.axios.put.mock.calls[0]).toEqual(['https://pl.example/api/watch-history', { username: 'me', author: 'a', permlink: 'p' }])
    expect(h.axios.put.mock.calls[1][1]).toEqual({ username: 'me', author: 'a', permlink: 'p', short: false })
  })

  it('does nothing without user, author or permlink, and swallows failures', async () => {
    expect(await recordWatch('', 'a', 'p')).toBeNull()
    expect(await recordWatch('me', 'a', '')).toBeNull()
    expect(h.axios.put).not.toHaveBeenCalled()
    h.axios.put.mockImplementation(down)
    expect(await recordWatch('me', 'a', 'p')).toBeNull()
  })
})

describe('batchCheckWatched', () => {
  it('returns a map keyed author/permlink, sending only author and permlink', async () => {
    h.axios.post.mockResolvedValue({ data: { watched: [{ author: 'a', permlink: 'p', watched_at: 1, last_watched_at: 2, watch_count: 3, extra: 'x' }] } })
    const map = await batchCheckWatched('me', [{ author: 'a', permlink: 'p', title: 'drop me' }, { author: 'b', permlink: 'q' }])
    expect(h.axios.post.mock.calls[0][1]).toEqual({ username: 'me', videos: [{ author: 'a', permlink: 'p' }, { author: 'b', permlink: 'q' }] })
    expect([...map.entries()]).toEqual([['a/p', { watched_at: 1, last_watched_at: 2, watch_count: 3 }]])
  })

  it('is an empty map for no user, no videos, a missing list or an error', async () => {
    expect((await batchCheckWatched('', [{}])).size).toBe(0)
    expect((await batchCheckWatched('me', [])).size).toBe(0)
    expect(h.axios.post).not.toHaveBeenCalled()
    h.axios.post.mockResolvedValueOnce({ data: {} })
    expect((await batchCheckWatched('me', [{ author: 'a', permlink: 'p' }])).size).toBe(0)
    h.axios.post.mockImplementationOnce(down)
    expect((await batchCheckWatched('me', [{ author: 'a', permlink: 'p' }])).size).toBe(0)
  })
})

describe('history reads', () => {
  it('getWatchHistory pages and filters through the query string', async () => {
    h.axios.get.mockResolvedValue({ data: { history: [1, 2] } })
    expect(await getWatchHistory('me')).toEqual([1, 2])
    await getWatchHistory('me', 10, 20, 'shorts', 1700000000)
    expect(h.axios.get.mock.calls[0][0]).toBe('https://pl.example/api/watch-history/me?limit=50&offset=0')
    expect(h.axios.get.mock.calls[1][0]).toBe('https://pl.example/api/watch-history/me?limit=10&offset=20&type=shorts&since=1700000000')
  })

  it('getWatchHistoryCount only adds a query string when filtering', async () => {
    h.axios.get.mockResolvedValue({ data: { count: 7 } })
    expect(await getWatchHistoryCount('me')).toBe(7)
    await getWatchHistoryCount('me', '', 5)
    await getWatchHistoryCount('me', 'videos', 5)
    expect(h.axios.get.mock.calls.map((c) => c[0])).toEqual([
      'https://pl.example/api/watch-history/me/count',
      'https://pl.example/api/watch-history/me/count?since=5',
      'https://pl.example/api/watch-history/me/count?type=videos&since=5',
    ])
  })

  it('reads fall back to empty or zero', async () => {
    expect(await getWatchHistory('')).toEqual([])
    expect(await getWatchHistoryCount('')).toBe(0)
    h.axios.get.mockImplementation(down)
    expect(await getWatchHistory('me')).toEqual([])
    expect(await getWatchHistoryCount('me')).toBe(0)
    h.axios.get.mockResolvedValue({ data: {} })
    expect(await getWatchHistory('me')).toEqual([])
    expect(await getWatchHistoryCount('me')).toBe(0)
  })
})

describe('deleteWatchHistoryEntry', () => {
  it('deletes one entry and reports success', async () => {
    h.axios.delete.mockResolvedValue({})
    expect(await deleteWatchHistoryEntry('me', 'a', 'p')).toBe(true)
    expect(h.axios.delete).toHaveBeenCalledWith('https://pl.example/api/watch-history/me/a/p')
  })

  it('reports false for missing input or a failed request', async () => {
    expect(await deleteWatchHistoryEntry('me', '', 'p')).toBe(false)
    h.axios.delete.mockImplementation(down)
    expect(await deleteWatchHistoryEntry('me', 'a', 'p')).toBe(false)
  })
})
