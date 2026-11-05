// The signed-in user's own playlists (src/hooks/useMyPlaylists.js): all of them,
// newest change first, with a thumbnail from the album cover, the album metadata
// or the first video's Hive post. A warm-up user's handle stands in for the Hive
// name. Also isVideoInPlaylist.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { queryWrapper } from './helpers/query.jsx'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: http }))
vi.mock('../../../src/utils/config', () => ({ PLAYLISTS_READ_URL: 'https://playlists.test', HIVE_API_URL: 'https://hive.test' }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))
const store = vi.hoisted(() => ({ user: 'badadib', incubationHandle: null }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(store) }))
const { useMyPlaylists, isVideoInPlaylist } = await import('../../../src/hooks/useMyPlaylists.js')

const content = (json_metadata) => ({ data: { result: { json_metadata } } })

beforeEach(() => {
  store.user = 'badadib'
  store.incubationHandle = null
  http.get.mockReset()
  http.post.mockReset()
})

describe('useMyPlaylists', () => {
  it('lists every playlist of the user, most recently changed first', async () => {
    http.get.mockResolvedValue({ data: { playlists: [
      { id: 'old', created_at: '2026-01-01', thumbnail: 'a.jpg' },
      { id: 'new', updated_at: '2026-10-01', thumbnail: 'b.jpg' },
      { id: 'mid', updated_at: '2026-05-01', thumbnail: 'c.jpg' },
    ] } })
    const { result } = renderHook(() => useMyPlaylists(), queryWrapper())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(http.get).toHaveBeenCalledWith('https://playlists.test/playlists', { params: { owner: 'badadib', limit: 100, offset: 0 } })
    expect(result.current.data.map((p) => p.id)).toEqual(['new', 'mid', 'old'])
  })

  it('passes its paging options through', async () => {
    http.get.mockResolvedValue({ data: {} })
    const { result } = renderHook(() => useMyPlaylists({ limit: 10, offset: 20 }), queryWrapper())
    await waitFor(() => expect(result.current.data).toEqual([]))
    expect(http.get.mock.calls[0][1].params).toEqual({ owner: 'badadib', limit: 10, offset: 20 })
  })

  it('finds a thumbnail: album cover, then album metadata, then the first video', async () => {
    http.get.mockResolvedValue({ data: { playlists: [
      { id: 'cover', updated_at: '2026-10-05', thumbnail: 'cover.jpg' },
      { id: 'album', updated_at: '2026-10-04', metadata: { album: { thumbnail: 'album.jpg' } } },
      { id: 'image', updated_at: '2026-10-03', items: [{ author: 'badadib', permlink: 'v1' }] },
      { id: 'ipfs', updated_at: '2026-10-02', items: [{ author: 'badadib', permlink: 'v2' }] },
      { id: 'none', updated_at: '2026-10-01', items: [{ author: 'badadib', permlink: 'v3' }] },
      { id: 'empty', updated_at: '2026-09-01', items: [] },
    ] } })
    http.post.mockImplementation(async (_url, body) => {
      const permlink = body.params[1]
      if (permlink === 'v1') return content(JSON.stringify({ image: ['first.jpg'] }))
      if (permlink === 'v2') return content({ video: { info: { ipfsThumbnail: 'QmThumb' } } })
      throw new Error('node down')
    })
    const { result } = renderHook(() => useMyPlaylists(), queryWrapper())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(result.current.data.map((p) => [p.id, p.thumbnail]))).toEqual({
      cover: 'cover.jpg', album: 'album.jpg', image: 'first.jpg',
      ipfs: 'https://ipfs.3speak.tv/ipfs/QmThumb', none: undefined, empty: undefined,
    })
    expect(http.post).toHaveBeenCalledWith('https://node.test',
      { jsonrpc: '2.0', method: 'condenser_api.get_content', params: ['badadib', 'v1'], id: 1 })
  })

  it('a first video without an image leaves the playlist without a thumbnail', async () => {
    http.get.mockResolvedValue({ data: { playlists: [{ id: 'x', items: [{ author: 'a', permlink: 'p' }] }] } })
    http.post.mockResolvedValue(content(JSON.stringify({ title: 't' })))
    const { result } = renderHook(() => useMyPlaylists(), queryWrapper())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data[0].thumbnail).toBeUndefined()
  })

  it('a warm-up user\'s playlists are read under the handle', async () => {
    store.user = null
    store.incubationHandle = 'sunny-otter'
    http.get.mockResolvedValue({ data: { playlists: [] } })
    const { result } = renderHook(() => useMyPlaylists(), queryWrapper())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(http.get.mock.calls[0][1].params.owner).toBe('sunny-otter')
  })

  it('a guest asks nothing', () => {
    store.user = null
    renderHook(() => useMyPlaylists(), queryWrapper())
    expect(http.get).not.toHaveBeenCalled()
  })

  it('a failed read is an error state', async () => {
    http.get.mockRejectedValue(new Error('503'))
    const { result } = renderHook(() => useMyPlaylists(), queryWrapper())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('isVideoInPlaylist', () => {
  const pl = { items: [{ author: 'badadib', permlink: 'v1' }] }
  it.each([
    [pl, 'badadib', 'v1', true],
    [pl, 'badadib', 'v2', false],
    [pl, 'other', 'v1', false],
    [{ items: 'nope' }, 'badadib', 'v1', false],
    [null, 'badadib', 'v1', false],
  ])('%o has %s/%s: %s', (playlist, author, permlink, expected) => {
    expect(isVideoInPlaylist(playlist, author, permlink)).toBe(expected)
  })
})
