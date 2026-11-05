// The legacy view-count fallback (src/hooks/useViewCounts.js): only videos the
// feed sent without a count are asked for, in batches of 50, each once; a failed
// batch is logged and the rest still load.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const axiosPost = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post: axiosPost } }))
vi.mock('../../../src/utils/config', () => ({ VIEWS_URL: 'https://views.test' }))
const { default: useViewCounts } = await import('../../../src/hooks/useViewCounts.js')

const counts = (videos) => Object.fromEntries(videos.map((v) => [`${v.author}/${v.permlink}`, 7]))

beforeEach(() => {
  axiosPost.mockReset().mockImplementation(async (_url, { videos }) => ({ data: { success: true, data: counts(videos) } }))
})

describe('useViewCounts', () => {
  it('asks only for videos without a count from the feed', async () => {
    const videos = [
      { author: { username: 'alice' }, permlink: 'a' },
      { owner: 'bob', permlink: 'b' },
      { author: 'carol', permlink: 'c', views: 3 },
      { author: 'dave', permlink: 'd', stats: { num_views: 0 } },
      { author: 'erin' },
    ]
    const { result } = renderHook(() => useViewCounts(videos))
    await waitFor(() => expect(result.current.getViewCount('alice', 'a')).toBe(7))
    expect(axiosPost).toHaveBeenCalledWith('https://views.test/views',
      { videos: [{ author: 'alice', permlink: 'a' }, { author: 'bob', permlink: 'b' }] }, { timeout: 15000 })
    expect(result.current.getViewCount('carol', 'c')).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('nothing missing sends no request at all', () => {
    renderHook(() => useViewCounts([{ author: 'a', permlink: 'p', views: 1 }]))
    renderHook(() => useViewCounts([]))
    renderHook(() => useViewCounts(undefined))
    expect(axiosPost).not.toHaveBeenCalled()
  })

  it('splits more than 50 into batches', async () => {
    const videos = Array.from({ length: 120 }, (_, i) => ({ author: 'a', permlink: `p${i}` }))
    const { result } = renderHook(() => useViewCounts(videos))
    await waitFor(() => expect(result.current.getViewCount('a', 'p119')).toBe(7))
    expect(axiosPost.mock.calls.map(([, body]) => body.videos.length)).toEqual([50, 50, 20])
  })

  it('a video is fetched once, even when the list is handed in again', async () => {
    const videos = [{ author: 'a', permlink: 'p' }]
    const { result, rerender } = renderHook(({ v }) => useViewCounts(v), { initialProps: { v: videos } })
    await waitFor(() => expect(result.current.getViewCount('a', 'p')).toBe(7))
    rerender({ v: [...videos, { author: 'a', permlink: 'q' }] })
    await waitFor(() => expect(axiosPost).toHaveBeenCalledTimes(2))
    expect(axiosPost.mock.calls[1][1].videos).toEqual([{ author: 'a', permlink: 'q' }])
  })

  it('a failed batch is logged, and the next batch still loads', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    axiosPost.mockRejectedValueOnce(Object.assign(new Error('timeout'), { response: { data: 'busy' } }))
    const videos = Array.from({ length: 60 }, (_, i) => ({ author: 'a', permlink: `p${i}` }))
    const { result } = renderHook(() => useViewCounts(videos))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(log).toHaveBeenCalledWith('Failed to fetch view counts:', 'busy')
    expect(result.current.getViewCount('a', 'p0')).toBeNull()
    expect(result.current.getViewCount('a', 'p55')).toBe(7)
  })

  it('an unsuccessful answer stores nothing', async () => {
    axiosPost.mockResolvedValue({ data: { success: false } })
    const { result } = renderHook(() => useViewCounts([{ author: 'a', permlink: 'p' }]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.getViewCount('a', 'p')).toBeNull()
  })
})
