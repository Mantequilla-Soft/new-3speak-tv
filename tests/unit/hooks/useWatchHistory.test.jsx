// Which feed videos the viewer already watched (src/hooks/useWatchHistory.js):
// asked in one batch of up to 50 recent videos, each once, under the Hive name or
// a warm-up handle; "unknown" (null) for a guest, and a version that bumps when
// answers land.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const store = vi.hoisted(() => ({ user: 'badadib', incubationHandle: null }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => (sel ? sel(store) : store) }))
const history = vi.hoisted(() => ({ batchCheckWatched: vi.fn() }))
vi.mock('../../../src/utils/watchHistory', () => ({ batchCheckWatched: (...a) => history.batchCheckWatched(...a) }))
vi.mock('../../../src/utils/config', () => ({ WATCH_HISTORY_THRESHOLD_DAYS: 14 }))
const { useWatchHistory } = await import('../../../src/hooks/useWatchHistory.js')

const NOW = new Date('2026-11-05T12:00:00Z')
const recent = '2026-11-01T00:00:00Z'
const old = '2026-10-01T00:00:00Z'

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  store.user = 'badadib'
  store.incubationHandle = null
  history.batchCheckWatched.mockReset().mockImplementation(async (_u, posts) =>
    new Map(posts.filter((p) => p.permlink !== 'unseen').map((p) => [`${p.author}/${p.permlink}`, { progress: 0.5 }])))
})
afterEach(() => vi.useRealTimers())

describe('useWatchHistory', () => {
  it('asks once for the recent videos, under every author shape', async () => {
    const videos = [
      { author: { username: 'alice' }, permlink: 'a', created_at: recent },
      { owner: 'bob', permlink: 'b', created: recent },
      { author: 'carol', permlink: 'old', created_at: old },
      { author: 'dave', permlink: 'unseen', created_at: recent },
      { author: 'erin', created_at: recent },
    ]
    const { result } = renderHook(() => useWatchHistory(videos))
    await waitFor(() => expect(result.current.version).toBe(1))
    expect(history.batchCheckWatched).toHaveBeenCalledWith('badadib',
      [{ author: 'alice', permlink: 'a' }, { author: 'bob', permlink: 'b' }, { author: 'dave', permlink: 'unseen' }])
    expect(result.current.isWatched('alice', 'a')).toBe(true)
    expect(result.current.isWatched('dave', 'unseen')).toBe(false)
    expect(result.current.getWatchData('bob', 'b')).toEqual({ progress: 0.5 })
    expect(result.current.getWatchData('dave', 'unseen')).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('asks for at most 50 per batch', async () => {
    const videos = Array.from({ length: 70 }, (_, i) => ({ author: 'a', permlink: `p${i}`, created_at: recent }))
    renderHook(() => useWatchHistory(videos))
    await waitFor(() => expect(history.batchCheckWatched).toHaveBeenCalled())
    expect(history.batchCheckWatched.mock.calls[0][1]).toHaveLength(50)
  })

  it('a warm-up viewer\'s history is read under the handle', async () => {
    store.user = null
    store.incubationHandle = 'sunny-otter'
    const { result } = renderHook(() => useWatchHistory([{ author: 'a', permlink: 'p', created_at: recent }]))
    await waitFor(() => expect(result.current.version).toBe(1))
    expect(history.batchCheckWatched.mock.calls[0][0]).toBe('sunny-otter')
    expect(result.current.isWatched('a', 'p')).toBe(true)
  })

  it('a guest asks nothing, and every video is unknown', () => {
    store.user = null
    const { result } = renderHook(() => useWatchHistory([{ author: 'a', permlink: 'p', created_at: recent }]))
    expect(history.batchCheckWatched).not.toHaveBeenCalled()
    expect(result.current.isWatched('a', 'p')).toBeNull()
  })

  it('a video already asked about is not asked again', async () => {
    const first = [{ author: 'a', permlink: '1', created_at: recent }]
    const { result, rerender } = renderHook(({ v }) => useWatchHistory(v), { initialProps: { v: first } })
    await waitFor(() => expect(result.current.version).toBe(1))
    rerender({ v: [...first, { author: 'a', permlink: '2', created_at: recent }] })
    await waitFor(() => expect(result.current.version).toBe(2))
    expect(history.batchCheckWatched.mock.calls[1][1]).toEqual([{ author: 'a', permlink: '2' }])
    rerender({ v: [...first] })
    expect(history.batchCheckWatched).toHaveBeenCalledTimes(2)
  })

  it('a failed lookup is logged and stops loading', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    history.batchCheckWatched.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useWatchHistory([{ author: 'a', permlink: 'p', created_at: recent }]))
    await waitFor(() => expect(log).toHaveBeenCalled())
    expect(result.current.loading).toBe(false)
    expect(result.current.isWatched('a', 'p')).toBe(false)
  })
})
