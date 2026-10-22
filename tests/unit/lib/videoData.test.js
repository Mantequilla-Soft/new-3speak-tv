// Video data from Hive, the player and the checker (src/lib/videoData.js):
// profiles, the play source, post details (with the off-chain fallback) and the
// suggestion feeds.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  call: vi.fn(),
  state: {},
  incubationPost: vi.fn(),
}))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ call: h.call }) }))
vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => 'https://play.example' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => h.state } }))
vi.mock('../../../src/lib/incubation', () => ({ fetchIncubationPost: h.incubationPost }))

import {
  fetchHiveProfile, fetchPlaySource, fetchVideoDetails, fetchTrendingFeed, fetchRelatedFeed, fetchAuthorVideos,
} from '../../../src/lib/videoData.js'

let fetchMock
const ok = (body) => ({ ok: true, json: async () => body })

beforeEach(() => {
  h.call.mockReset()
  h.incubationPost.mockReset().mockResolvedValue(null)
  h.state = {}
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('fetchHiveProfile', () => {
  it('reads name, about and images from the posting metadata', async () => {
    h.call.mockResolvedValue([{ posting_json_metadata: JSON.stringify({ profile: { name: 'Alice A', about: 'hi', profile_image: 'https://p', cover_image: 'https://c' } }) }])
    expect(await fetchHiveProfile('alice')).toEqual({
      id: 'alice', did: 'alice', username: 'alice', name: 'Alice A', about: 'hi', images: { avatar: 'https://p', cover: 'https://c' },
    })
    expect(h.call).toHaveBeenCalledWith('condenser_api', 'get_accounts', [['alice']])
  })

  it('falls back to legacy metadata, then to a minimal profile', async () => {
    h.call.mockResolvedValueOnce([{ posting_json_metadata: '', json_metadata: '{"profile":{"name":"Old"}}' }])
    expect((await fetchHiveProfile('bob')).name).toBe('Old')
    h.call.mockRejectedValueOnce(new Error('rpc'))
    expect(await fetchHiveProfile('bob')).toMatchObject({ name: 'bob', about: '', images: { avatar: '/img/u/bob/avatar/small', cover: '' } })
    expect(await fetchHiveProfile('')).toBeNull()
  })
})

describe('fetchPlaySource', () => {
  it('maps the player answer to a play source', async () => {
    fetchMock.mockResolvedValue(ok({ videoUrl: 'https://cdn/x.m3u8', thumbnailUrl: 'https://t', duration: 61, status: 'published' }))
    expect(await fetchPlaySource('alice', 'p')).toEqual({
      play_url: 'https://cdn/x.m3u8', thumbnail_url: 'https://t', duration: 61, status: 'published', published: true, placeholder: false,
    })
    expect(fetchMock).toHaveBeenCalledWith('https://play.example/api/embed?v=alice/p')
  })

  it('tries the legacy /api/watch route when the embed route has nothing', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ success: false }))
      .mockResolvedValueOnce(ok({ videoUrl: 'legacy.m3u8' }))
    expect((await fetchPlaySource('a', 'p')).play_url).toBe('legacy.m3u8')
    expect(fetchMock.mock.calls[1][0]).toBe('https://play.example/api/watch?v=a/p')
  })

  it('a processing notice clip is not the published video', async () => {
    fetchMock.mockResolvedValue(ok({ videoUrl: 'notice.m3u8', status: 'published', isPlaceholder: true }))
    expect(await fetchPlaySource('a', 'p')).toMatchObject({ published: false, placeholder: true })
  })

  it('is null for unknown authors and when both routes fail', async () => {
    expect(await fetchPlaySource('unknown', 'p')).toBeNull()
    expect(await fetchPlaySource('a', '')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error('net'))
    expect(await fetchPlaySource('a', 'p')).toBeNull()
  })
})

describe('fetchVideoDetails', () => {
  const post = (meta, extra = {}) => ({
    author: 'alice', title: 'T', body: 'B', created: '2026-01-01T00:00:00', parent_permlink: 'hive-181335',
    category: 'hive-181335', children: 4, active_votes: [{}, {}],
    total_payout_value: '1.250 HBD', curator_payout_value: '0.750 HBD', pending_payout_value: '0.500 HBD',
    json_metadata: JSON.stringify(meta), ...extra,
  })

  it('builds the watch-page shape from a Hive post', async () => {
    const meta = { tags: ['a'], video: { info: { duration: 90, sourceMap: [{ type: 'thumbnail', url: 'thumb.jpg' }, { type: 'video', url: 'v.m3u8' }] } } }
    h.call.mockResolvedValue(post(meta))
    const d = await fetchVideoDetails('alice', 'p')
    expect(d).toMatchObject({
      live: false, roomName: null, title: 'T', body: 'B', tags: ['a'], created_at: '2026-01-01T00:00:00',
      author: { id: 'alice', username: 'alice', profile: { name: 'alice', images: { avatar: '/img/u/alice/avatar/small' } } },
      stats: { num_comments: 4, num_votes: 2, total_hive_reward: 2.5 },
      community: { _id: 'hive-181335', title: 'hive-181335' },
      spkvideo: { play_url: 'v.m3u8', thumbnail_url: 'thumb.jpg', duration: 90 },
    })
    expect(d.json_metadata).toBe(JSON.stringify(meta))
  })

  it('a post on a personal blog is not shown as a community', async () => {
    h.call.mockResolvedValue(post({}, { category: 'gaming' }))
    expect((await fetchVideoDetails('alice', 'p')).community).toBeNull()
  })

  it('prefers video_v2, and keeps a thumbnail-only post with no play URL', async () => {
    h.call.mockResolvedValueOnce(post({ video: { info: { video_v2: 'v2.m3u8', file: 'f.mp4' } }, image: ['img.jpg'] }))
    expect((await fetchVideoDetails('a', 'p')).spkvideo).toEqual({ play_url: 'v2.m3u8', thumbnail_url: 'img.jpg', duration: 0 })
    h.call.mockResolvedValueOnce(post({ image: ['img.jpg'] }))
    expect((await fetchVideoDetails('a', 'p')).spkvideo).toEqual({ play_url: null, thumbnail_url: 'img.jpg', duration: 0 })
    h.call.mockResolvedValueOnce(post({}))
    expect((await fetchVideoDetails('a', 'p')).spkvideo).toBeNull()
  })

  it('an announced live stream carries its room name', async () => {
    h.call.mockResolvedValueOnce(post({ video: { live: true }, openpodRoom: 'room-9' }))
    expect(await fetchVideoDetails('a', 'p')).toMatchObject({ live: true, roomName: 'room-9' })
    h.call.mockResolvedValueOnce(post({ video: { live: true } }))
    expect((await fetchVideoDetails('a', 'the-permlink')).roomName).toBe('the-permlink')
  })

  it('a post Hive does not have falls back to the off-chain store', async () => {
    h.incubationPost.mockResolvedValue({
      author: { handle: 'newbie' },
      post: { title: 'Hi', body: 'b', created: 'c', jsonMetadata: { tags: ['x'], video: { info: { file: 'f.mp4', duration: 5 } } } },
    })
    h.call.mockResolvedValueOnce({})
    const d = await fetchVideoDetails('newbie', 'p')
    expect(d).toMatchObject({
      _incubation: true, title: 'Hi', community: null, tags: ['x'],
      author: { username: 'newbie', profile: { images: { avatar: '/pwa-192x192.png' } } },
      stats: { num_comments: 0, num_votes: 0, total_hive_reward: 0 },
      spkvideo: { play_url: 'f.mp4', thumbnail_url: null, duration: 5 },
    })
    expect(h.incubationPost).toHaveBeenCalledWith('newbie', 'p')
  })

  it('"does not exist" errors from newer nodes count as not found, wherever dhive puts the text', async () => {
    const missing = [
      Object.assign(new Error(' category=hivemind'), { jse_info: { extension: { assertion_expression: 'Post alice/p does not exist' } } }),
      Object.assign(new Error(' category=hivemind'), { jse_info: { message: 'Assert Exception' } }),
      new Error('Post alice/p does not exist'),
      Object.assign(new Error('x'), { jse_shortmsg: 'code -32602' }),
      Object.assign(new Error('x'), { name: 'RPCError' }),
    ]
    for (const err of missing) {
      h.call.mockRejectedValueOnce(err)
      expect(await fetchVideoDetails('alice', 'p')).toBeNull()
    }
    expect(h.incubationPost).toHaveBeenCalledTimes(missing.length)
  })

  it('a real network failure is passed on so the page can say so', async () => {
    h.call.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchVideoDetails('alice', 'p')).rejects.toThrow('Failed to fetch')
  })

  it('is null without a usable author or permlink', async () => {
    expect(await fetchVideoDetails('unknown', 'p')).toBeNull()
    expect(await fetchVideoDetails('a', '')).toBeNull()
    expect(h.call).not.toHaveBeenCalled()
  })
})

describe('suggestion feeds', () => {
  it('trending carries interests, the viewer and the hide-watched choice', async () => {
    h.state = { interests: ['music', 'art & design'], user: 'me', hideWatched: true }
    fetchMock.mockResolvedValue(ok({ videos: [1] }))
    expect(await fetchTrendingFeed(5)).toEqual([1])
    expect(fetchMock.mock.calls[0][0]).toBe('https://checker.3speak.tv/feeds/trendingSorted?limit=5&interests=music%2Cart%20%26%20design&currentuser=me&hidewatched=1')
  })

  it('a signed-out viewer sends no personal parameters', async () => {
    fetchMock.mockResolvedValue(ok({}))
    expect(await fetchTrendingFeed()).toEqual([])
    expect(fetchMock.mock.calls[0][0]).toBe('https://checker.3speak.tv/feeds/trendingSorted?limit=20')
  })

  it('related videos come with the topic the checker resolved', async () => {
    h.state = { user: 'me', hideWatched: false }
    fetchMock.mockResolvedValue(ok({ videos: [1, 2], currentTopic: 'music' }))
    expect(await fetchRelatedFeed('a b', 'p/q', 3)).toEqual({ videos: [1, 2], currentTopic: 'music' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://checker.3speak.tv/feeds/related/a%20b/p%2Fq?limit=3&currentuser=me&hidewatched=0')
  })

  it('author videos read either answer shape', async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: { videos: ['x'] } })).mockResolvedValueOnce(ok({ videos: ['y'] }))
    expect(await fetchAuthorVideos('alice', 2)).toEqual(['x'])
    expect(await fetchAuthorVideos('alice')).toEqual(['y'])
    expect(fetchMock.mock.calls[0][0]).toBe('https://checker.3speak.tv/api/my-videos?username=alice&limit=2&offset=0&status=published&sort=newest')
  })

  it('feeds fall back to empty on failure or a missing author', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    expect(await fetchTrendingFeed()).toEqual([])
    expect(await fetchRelatedFeed('a', 'p')).toEqual({ videos: [], currentTopic: null })
    expect(await fetchAuthorVideos('a')).toEqual([])
    expect(await fetchRelatedFeed('unknown', 'p')).toEqual({ videos: [], currentTopic: null })
    expect(await fetchAuthorVideos('')).toEqual([])
  })
})
