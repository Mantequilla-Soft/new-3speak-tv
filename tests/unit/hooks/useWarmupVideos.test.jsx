// Warm-up users' videos in the feeds (src/hooks/useWarmupVideos.js): shaped as
// Card3 items marked `_incubation`, the viewer's own posts left out, a failure
// quietly empty; and for the Follow feed, only the authors the viewer follows.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { queryWrapper } from './helpers/query.jsx'

const inc = vi.hoisted(() => ({ fetchIncubationFeed: vi.fn(), fetchIncubationProfile: vi.fn() }))
vi.mock('../../../src/lib/incubation', () => inc)
const { useWarmupVideos, useFollowedWarmupVideos } = await import('../../../src/hooks/useWarmupVideos.js')

beforeEach(() => {
  inc.fetchIncubationFeed.mockReset()
  inc.fetchIncubationProfile.mockReset()
})

describe('useWarmupVideos', () => {
  it('shapes the feed items for Card3', async () => {
    inc.fetchIncubationFeed.mockResolvedValue({ items: [
      { author: { handle: 'sunny-otter' }, permlink: 'p1', title: 'Hi', thumbnail: 't.jpg', duration: 30, created: 'c1' },
      { handle: 'quiet-fox', permlink: 'p2', created: 'c2' },
      { permlink: 'nobody' },
    ] })
    const { result } = renderHook(() => useWarmupVideos({ limit: 4 }), queryWrapper())
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(inc.fetchIncubationFeed).toHaveBeenCalledWith(4)
    expect(result.current).toEqual([
      { author: 'sunny-otter', permlink: 'p1', title: 'Hi', thumbnail: 't.jpg', duration: 30, created: 'c1', _incubation: true },
      { author: 'quiet-fox', permlink: 'p2', title: '', thumbnail: null, duration: 0, created: 'c2', _incubation: true },
    ])
  })

  it('leaves out the viewer\'s own posts, whatever the case', async () => {
    inc.fetchIncubationFeed.mockResolvedValue({ items: [{ handle: 'Sunny-Otter', permlink: 'mine' }, { handle: 'quiet-fox', permlink: 'theirs' }] })
    const { result } = renderHook(() => useWarmupVideos({ ownHandle: 'sunny-otter' }), queryWrapper())
    await waitFor(() => expect(result.current.map((v) => v.permlink)).toEqual(['theirs']))
  })

  it('fails quietly to an empty list', async () => {
    inc.fetchIncubationFeed.mockRejectedValue(new Error('down'))
    const { client, wrapper } = queryWrapper()
    const { result } = renderHook(() => useWarmupVideos(), { wrapper })
    await waitFor(() => expect(client.getQueryState(['warmup-feed-videos', 8])?.status).toBe('success'))
    expect(result.current).toEqual([])
  })

  it('disabled, asks nothing and is empty', () => {
    const { result } = renderHook(() => useWarmupVideos({ enabled: false }), queryWrapper())
    expect(result.current).toEqual([])
    expect(inc.fetchIncubationFeed).not.toHaveBeenCalled()
  })
})

describe('useFollowedWarmupVideos', () => {
  const videos = [{ author: 'Sunny-Otter', permlink: 'a' }, { author: 'quiet-fox', permlink: 'b' }, { author: 'sunny-otter', permlink: 'c' }]

  it('keeps the videos whose author the viewer follows, asking once per author', async () => {
    inc.fetchIncubationProfile.mockImplementation(async (h) => ({ viewerFollows: h === 'sunny-otter' }))
    const { result } = renderHook(() => useFollowedWarmupVideos(videos, 'badadib'), queryWrapper())
    await waitFor(() => expect(result.current.map((v) => v.permlink)).toEqual(['a', 'c']))
    expect(inc.fetchIncubationProfile.mock.calls).toEqual([['quiet-fox', 'badadib'], ['sunny-otter', 'badadib']])
  })

  it('a failed lookup counts as not followed', async () => {
    inc.fetchIncubationProfile.mockImplementation(async (h) => {
      if (h === 'quiet-fox') throw new Error('404')
      return { viewerFollows: true }
    })
    const { result } = renderHook(() => useFollowedWarmupVideos(videos, 'badadib'), queryWrapper())
    await waitFor(() => expect(result.current.map((v) => v.permlink)).toEqual(['a', 'c']))
  })

  it('without a viewer asks nothing and is empty', () => {
    const { result } = renderHook(() => useFollowedWarmupVideos(videos, null), queryWrapper())
    expect(result.current).toEqual([])
    expect(inc.fetchIncubationProfile).not.toHaveBeenCalled()
  })
})
