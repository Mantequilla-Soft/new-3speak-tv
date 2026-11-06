// Batch-loading payout, votes and comment counts for feed cards
// (src/hooks/useContentBatch.js): one request for the cards the checker has no
// stats for, each post fetched once, and the loading and error states.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const store = vi.hoisted(() => ({ user: 'badadib' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: () => store }))
const hive = vi.hoisted(() => ({ batchGetContent: vi.fn() }))
vi.mock('../../../src/utils/hiveUtils', () => ({ batchGetContent: (...a) => hive.batchGetContent(...a) }))
const { useContentBatch } = await import('../../../src/hooks/useContentBatch.js')

const answer = (posts) => new Map(posts.map((p) => [`${p.author}/${p.permlink}`, { payout: 1, voters: [], isVoted: false, children: 2 }]))

beforeEach(() => {
  store.user = 'badadib'
  hive.batchGetContent.mockReset().mockImplementation(async (posts) => answer(posts))
})

describe('useContentBatch', () => {
  it('fetches the cards without checker stats, under every author shape', async () => {
    const videos = [
      { author: { username: 'alice' }, permlink: 'a' },
      { author: { id: 'bob' }, permlink: 'b' },
      { author: 'carol', permlink: 'c' },
      { owner: 'dave', permlink: 'd' },
      { author: 'erin', permlink: 'e', stats: { has_stats: true } },
      { author: 'nopermlink' },
    ]
    const { result } = renderHook(() => useContentBatch(videos))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(hive.batchGetContent).toHaveBeenCalledWith(
      [{ author: 'alice', permlink: 'a' }, { author: 'bob', permlink: 'b' }, { author: 'carol', permlink: 'c' }, { author: 'dave', permlink: 'd' }],
      'badadib',
    )
    await waitFor(() => expect(result.current.getContentForVideo('carol', 'c')).toMatchObject({ children: 2 }))
    expect(result.current.getContentForVideo('erin', 'e')).toBeNull()
  })

  it('is loading while the request runs', async () => {
    let resolve
    hive.batchGetContent.mockImplementation(() => new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useContentBatch([{ author: 'a', permlink: 'p' }]))
    await waitFor(() => expect(result.current.loading).toBe(true))
    resolve(new Map())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('more cards appended later fetch only the new ones', async () => {
    const first = [{ author: 'a', permlink: '1' }]
    const { result, rerender } = renderHook(({ v }) => useContentBatch(v), { initialProps: { v: first } })
    await waitFor(() => expect(result.current.getContentForVideo('a', '1')).not.toBeNull())
    rerender({ v: [...first, { author: 'a', permlink: '2' }] })
    await waitFor(() => expect(hive.batchGetContent).toHaveBeenCalledTimes(2))
    expect(hive.batchGetContent.mock.calls[1][0]).toEqual([{ author: 'a', permlink: '2' }])
    rerender({ v: [...first] })
    expect(hive.batchGetContent).toHaveBeenCalledTimes(2)
  })

  it('nothing to fetch asks nothing', () => {
    renderHook(() => useContentBatch([]))
    renderHook(() => useContentBatch(null))
    renderHook(() => useContentBatch([{ author: 'a', permlink: 'p', stats: { has_stats: true } }]))
    expect(hive.batchGetContent).not.toHaveBeenCalled()
  })

  it('a failed request surfaces the error and stops loading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('all nodes failed')
    hive.batchGetContent.mockRejectedValue(boom)
    const { result } = renderHook(() => useContentBatch([{ author: 'a', permlink: 'p' }]))
    await waitFor(() => expect(result.current.error).toBe(boom))
    expect(result.current.loading).toBe(false)
  })

  it('getContentForVideo keeps the same identity across renders', async () => {
    const { result, rerender } = renderHook(() => useContentBatch([{ author: 'a', permlink: 'p' }]))
    const fn = result.current.getContentForVideo
    rerender()
    expect(result.current.getContentForVideo).toBe(fn)
  })
})
