// Someone's playlists on their profile (src/hooks/useUserPlaylists.js): only the
// public ones (private and Watch Later stay hidden), each with a thumbnail from
// its cover, its album metadata or its first video; and the thumbnail URL helper.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { queryWrapper } from './helpers/query.jsx'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: http }))
vi.mock('../../../src/utils/config', () => ({ PLAYLISTS_READ_URL: 'https://playlists.test', HIVE_API_URL: 'https://hive.test' }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))
vi.mock('../../../src/utils/fixThumbnails', () => ({
  fallbackImg: 'fallback.jpg',
  fixVideoThumbnail: ({ thumbnail }) => `https://img.test/resized/${thumbnail}`,
}))
const { useUserPlaylists, getPlaylistThumbnail } = await import('../../../src/hooks/useUserPlaylists.js')

const content = (json_metadata) => ({ data: { result: { json_metadata } } })

beforeEach(() => {
  http.get.mockReset()
  http.post.mockReset()
})

describe('useUserPlaylists', () => {
  it('shows only the public playlists, asking for the owner\'s first 50', async () => {
    http.get.mockResolvedValue({ data: { playlists: [
      { id: 'pub', access: 'public', thumbnail: 'a.jpg' },
      { id: 'priv', access: 'private', thumbnail: 'b.jpg' },
      { id: 'later', access: 'unlisted' },
    ] } })
    const { result } = renderHook(() => useUserPlaylists('badadib'), queryWrapper())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(http.get).toHaveBeenCalledWith('https://playlists.test/playlists', { params: { owner: 'badadib', limit: 50, offset: 0 } })
    expect(result.current.data.map((p) => p.id)).toEqual(['pub'])
  })

  it('finds thumbnails from the album metadata or the first video\'s post', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    http.get.mockResolvedValue({ data: { playlists: [
      { id: 'album', access: 'public', metadata: { album: { thumbnail: 'album.jpg' } } },
      { id: 'image', access: 'public', items: [{ author: 'badadib', permlink: 'v1' }] },
      { id: 'ipfs', access: 'public', items: [{ author: 'badadib', permlink: 'v2' }] },
      { id: 'broken', access: 'public', items: [{ author: 'badadib', permlink: 'v3' }] },
      { id: 'bare', access: 'public', items: [{ author: 'badadib', permlink: 'v4' }] },
      { id: 'empty', access: 'public' },
    ] } })
    http.post.mockImplementation(async (_url, body) => {
      const p = body.params[1]
      if (p === 'v1') return content(JSON.stringify({ image: ['first.jpg'] }))
      if (p === 'v2') return content({ video: { info: { ipfsThumbnail: 'QmT' } } })
      if (p === 'v4') return content(null)
      throw new Error('node down')
    })
    const { result } = renderHook(() => useUserPlaylists('badadib', { limit: 5 }), queryWrapper())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(result.current.data.map((p) => [p.id, p.thumbnail]))).toEqual({
      album: 'album.jpg', image: 'first.jpg', ipfs: 'https://ipfs.3speak.tv/ipfs/QmT', broken: null, bare: null, empty: undefined,
    })
    expect(http.get.mock.calls[0][1].params.limit).toBe(5)
  })

  it('without an owner asks nothing', () => {
    renderHook(() => useUserPlaylists(''), queryWrapper())
    expect(http.get).not.toHaveBeenCalled()
  })

  it('an answer without playlists is an empty list', async () => {
    http.get.mockResolvedValue({ data: null })
    const { result } = renderHook(() => useUserPlaylists('badadib'), queryWrapper())
    await waitFor(() => expect(result.current.data).toEqual([]))
  })
})

describe('getPlaylistThumbnail', () => {
  it('resizes a known thumbnail through the image cache', () => {
    expect(getPlaylistThumbnail({ thumbnail: 'cover.jpg' })).toBe('https://img.test/resized/cover.jpg')
  })

  it.each([[{}], [null]])('falls back to the default image for %o', (pl) => {
    expect(getPlaylistThumbnail(pl)).toBe('fallback.jpg')
  })
})
