// Recently changed public playlists for the home feed (src/lib/playlistsFeed.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get } }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))

import fetchPlaylistsFeedDefault, { fetchPlaylistsFeed } from '../../../src/lib/playlistsFeed.js'

beforeEach(() => { h.get.mockReset().mockResolvedValue({ data: { success: true, playlists: [] } }) })

describe('fetchPlaylistsFeed', () => {
  it('asks for page 1 of 10 across everyone by default', async () => {
    expect(await fetchPlaylistsFeed()).toEqual({ success: true, playlists: [] })
    expect(h.get).toHaveBeenCalledWith('https://checker.example/playlists-feed?scope=all&page=1&limit=10')
  })

  it('adds the viewer and a narrower age window only when given', async () => {
    await fetchPlaylistsFeed({ scope: 'following', currentuser: 'a&b', page: 2, limit: 5, maxAgeHours: 48 })
    expect(h.get).toHaveBeenCalledWith('https://checker.example/playlists-feed?scope=following&page=2&limit=5&currentuser=a%26b&maxAgeHours=48')
  })

  it('lets a failed request reach the caller, and is also the default export', async () => {
    h.get.mockRejectedValue(new Error('down'))
    await expect(fetchPlaylistsFeedDefault()).rejects.toThrow('down')
  })
})
