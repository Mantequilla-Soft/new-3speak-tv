// Playlist items to tiles (src/utils/playlistVideos.js): show notes made from a
// post body, and the per-item Hive lookup that also spots audio episodes. Hive
// and the checker are mocked; nothing goes over the network.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ axios: { get: vi.fn(), post: vi.fn() } }))
vi.mock('axios', () => ({ default: h.axios }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.example' }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))

import { postSummary, fetchVideosForPlaylist } from '../../../src/utils/playlistVideos.js'

describe('postSummary', () => {
  it.each([
    ['drops images, player links, footnotes and markup',
      '# Episode 4\n![cover](https://img/x.png)\nhttps://audio.3speak.tv/play?a=ep4\n\nWe talk **bees** with [Ann](https://x.example) <sup>1</sup> and `code`.\n> quoted<br>line',
      'Episode 4 We talk bees with Ann and code. quoted line'],
    ['keeps a player link that sits inside a sentence', 'Listen at https://audio.3speak.tv/play?a=x now', 'Listen at https://audio.3speak.tv/play?a=x now'],
    ['handles an empty body', null, ''],
    ['strips html images', 'a <img src="x"> b', 'a b'],
  ])('%s', (_name, body, out) => {
    expect(postSummary(body)).toBe(out)
  })

  it('cuts at a word boundary and marks the cut', () => {
    expect(postSummary('one two three four', 9)).toBe('one two…')
    expect(postSummary('short', 9)).toBe('short')
  })
})

describe('fetchVideosForPlaylist', () => {
  const posts = {
    'alice/v1': { author: 'alice', permlink: 'v1', title: 'Video', created: '2026-01-01', body: 'Hi', json_metadata: JSON.stringify({ image: ['https://img/1.png'], video: { info: { duration: 61 } } }) },
    'bob/ep1': { author: 'bob', permlink: 'ep1', title: 'Pod', created: '2026-01-02', body: 'Notes here\nhttps://audio.3speak.tv/play?a=aud1', json_metadata: { image: [] }, parent_author: '', parent_permlink: 'hive-1' },
  }

  beforeEach(() => {
    h.axios.post.mockReset().mockImplementation(async (_url, { params: [a, p] }) => ({ data: { result: posts[`${a}/${p}`] ?? { author: '' } } }))
    h.axios.get.mockReset().mockResolvedValue({ data: { audio: [{ permlink: 'aud1', duration: 300 }] } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns nothing for an empty playlist without calling Hive', async () => {
    expect(await fetchVideosForPlaylist([])).toEqual([])
    expect(await fetchVideosForPlaylist(undefined)).toEqual([])
    expect(h.axios.post).not.toHaveBeenCalled()
  })

  it('looks each item up with get_content and returns tiles sorted by position', async () => {
    const items = [
      { author: 'bob', permlink: 'ep1', position: 2, added_at: 't2' },
      { author: 'alice', permlink: 'v1', position: 1, added_at: 't1' },
    ]
    const out = await fetchVideosForPlaylist(items)
    expect(h.axios.post).toHaveBeenCalledWith('https://hive.example', {
      jsonrpc: '2.0', method: 'condenser_api.get_content', params: ['alice', 'v1'], id: 1,
    })
    expect(out.map((v) => v.permlink)).toEqual(['v1', 'ep1'])
    expect(out[0]).toEqual({
      author: 'alice', permlink: 'v1', title: 'Video', summary: '', created_at: '2026-01-01',
      images: { thumbnail: 'https://img/1.png' }, duration: 61, position: 1, added_at: 't1',
      parentAuthor: '', parentPermlink: '', isAudio: false, audioPermlink: null, audioDoc: null,
    })
  })

  it('recognises an audio episode, loads its audio record and writes show notes', async () => {
    const [ep] = await fetchVideosForPlaylist([{ author: 'bob', permlink: 'ep1', position: 0 }])
    expect(h.axios.get).toHaveBeenCalledWith('https://checker.example/audio?owner=bob&permlink=aud1&limit=1')
    expect(ep).toMatchObject({ isAudio: true, audioPermlink: 'aud1', audioDoc: { permlink: 'aud1', duration: 300 }, summary: 'Notes here', parentPermlink: 'hive-1', duration: 0, images: { thumbnail: null } })
  })

  it('lists an audio-looking post as a plain post when the checker has no record or is down', async () => {
    h.axios.get.mockResolvedValueOnce({ data: { audio: [] } }).mockRejectedValueOnce(new Error('down'))
    const a = await fetchVideosForPlaylist([{ author: 'bob', permlink: 'ep1', position: 0 }])
    const b = await fetchVideosForPlaylist([{ author: 'bob', permlink: 'ep1', position: 0 }])
    for (const [ep] of [a, b]) expect(ep).toMatchObject({ isAudio: false, audioPermlink: 'aud1', audioDoc: null, summary: '' })
  })

  it('drops items that were deleted or failed to load, and survives broken metadata', async () => {
    posts['carol/bad'] = { author: 'carol', permlink: 'bad', body: 7, json_metadata: '{not json' }
    h.axios.post.mockImplementationOnce(async () => { throw new Error('timeout') })
    const out = await fetchVideosForPlaylist([
      { author: 'alice', permlink: 'v1', position: 0 },
      { author: 'gone', permlink: 'x', position: 1 },
      { author: 'carol', permlink: 'bad', position: 2 },
    ])
    expect(out.map((v) => v.permlink)).toEqual(['bad'])
    expect(out[0]).toMatchObject({ images: { thumbnail: null }, duration: 0, isAudio: false })
    delete posts['carol/bad']
  })
})
