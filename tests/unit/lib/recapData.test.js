// Video lists for the yearly recap galleries (src/lib/recapData.js): uploads
// and watch history over the window, as one card shape, with dead thumbnail
// hosts dropped and the recap's excluded accounts left out of the creator list.
// fetch is stubbed with a router keyed on the URL path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test', MY_VIDEOS_URL: 'https://videos.test' }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.test' }))

import { GALLERY_MAX, usableThumb, fetchUploadsYear, fetchWatchedYear } from '../../../src/lib/recapData.js'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString()

// routes: [regex, (url) => body | { status }]
function stubFetch(routes) {
  const f = vi.fn(async (url) => {
    const hit = routes.find(([re]) => re.test(url))
    if (!hit) throw new Error(`unexpected ${url}`)
    const body = hit[1](url)
    if (body && body.__status) return { ok: false, status: body.__status, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const param = (url, name) => new URL(url).searchParams.get(name)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('usableThumb', () => {
  it.each([
    ['https://img.3speak.tv/abc/thumbnail.png', null],
    ['HTTP://IMG.3SPEAK.TV/x', null],
    ['https://ipfs.example/thumb.jpg', 'https://ipfs.example/thumb.jpg'],
    ['', null],
    [undefined, null],
  ])('%s -> %s', (url, expected) => {
    expect(usableThumb(url)).toBe(expected)
  })
})

describe('fetchUploadsYear', () => {
  it('builds video and short cards for the window, newest first', async () => {
    const f = stubFetch([
      [/\/api\/my-videos/, () => ({
        data: {
          videos: [
            { title: 'Fresh', owner: 'alice', permlink: 'v1', created_at: iso(1), images: { thumbnail: 'https://t/1.jpg' }, duration: 61 },
            { author: 'alice', permlink: 'v2', created_at: iso(2), images: { thumbnail: 'https://img.3speak.tv/v2/thumbnail.png' }, spkvideo: { duration: 9 } },
            { permlink: 'v3', created_at: iso(3) },
            { title: 'Old', permlink: 'v4', created_at: iso(400) },
          ],
        },
      })],
      [/\/shorts\//, () => ({
        totalPages: 1,
        shorts: [
          { hive_title: 'Titled', embed_url: '@alice/hive-s1', owner: 'alice', permlink: 's1', createdAt: iso(1), thumbnail_url: 'https://t/s1.jpg', duration: 15 },
          { hive_body: '## From the heading\n\ncaption', permlink: 's2', createdAt: iso(2) },
          { permlink: 's3', createdAt: iso(500) },
        ],
      })],
    ])

    const out = await fetchUploadsYear('al ice')

    expect(f.mock.calls[0][0]).toBe('https://videos.test/api/my-videos?username=al%20ice&limit=50&offset=0&status=published&sort=newest')
    expect(out.videos).toEqual([
      { title: 'Fresh', author: 'alice', permlink: 'v1', thumbnail: 'https://t/1.jpg', duration: 61, created: Date.parse(iso(1)), short: false, href: '/watch?v=alice/v1' },
      { title: '', author: 'alice', permlink: 'v2', thumbnail: null, duration: 9, created: Date.parse(iso(2)), short: false, href: '/watch?v=alice/v2' },
      { title: '', author: 'al ice', permlink: 'v3', thumbnail: null, duration: 0, created: Date.parse(iso(3)), short: false, href: '/watch?v=al ice/v3' },
    ])
    expect(out.shorts).toEqual([
      { title: 'Titled', author: 'alice', permlink: 'hive-s1', thumbnail: 'https://t/s1.jpg', duration: 15, created: Date.parse(iso(1)), short: true, href: '/shorts?v=alice/s1' },
      { title: 'From the heading', author: 'al ice', permlink: 's2', thumbnail: null, duration: 0, created: Date.parse(iso(2)), short: true, href: '/shorts?v=al ice/s2' },
    ])
  })

  it('pages through full video pages and stops at the gallery limit', async () => {
    const offsets = []
    stubFetch([
      [/\/api\/my-videos/, (url) => {
        offsets.push(Number(param(url, 'offset')))
        return { data: { videos: Array.from({ length: 50 }, (_, i) => ({ permlink: `p${offsets.length}-${i}`, created_at: iso(1) })) } }
      }],
      [/\/shorts\//, () => ({ shorts: [] })],
    ])
    const out = await fetchUploadsYear('alice')
    expect(out.videos).toHaveLength(GALLERY_MAX)
    expect(offsets).toEqual([0, 50, 100, 150, 200])
  })

  it('follows short pages up to the reported total', async () => {
    const pages = []
    stubFetch([
      [/\/api\/my-videos/, () => ({ data: { videos: [] } })],
      [/\/shorts\//, (url) => {
        pages.push(Number(param(url, 'page')))
        return { totalPages: 2, shorts: [{ permlink: `s${pages.length}`, createdAt: iso(1) }] }
      }],
    ])
    const out = await fetchUploadsYear('alice')
    expect(pages).toEqual([1, 2])
    expect(out.shorts.map((s) => s.permlink)).toEqual(['s1', 's2'])
  })

  it('throws with the URL and status when a list cannot be read', async () => {
    stubFetch([[/\/api\/my-videos/, () => ({ __status: 503 })]])
    await expect(fetchUploadsYear('alice')).rejects.toThrow(/my-videos.* -> 503/)
  })

  it('copes with empty answers', async () => {
    stubFetch([[/\/api\/my-videos/, () => null], [/\/shorts\//, () => null]])
    expect(await fetchUploadsYear('alice')).toEqual({ videos: [], shorts: [] })
  })
})

describe('fetchWatchedYear', () => {
  it('ranks creators by videos watched and splits videos from shorts', async () => {
    const f = stubFetch([[/\/feeds\/watched\//, () => ({
      totalPages: 1,
      videos: [
        { _historyKey: 'bob/v1', permlink: 'v1', title: 'B1', images: { thumbnail: 'https://t/b1.jpg' }, created: iso(5), duration: 30 },
        { author: 'bob', permlink: 'v2', thumbnail: 'ipfs://legacy', watched_at: 1700000000 },
        { author: 'carol', permlink: 's1', _short: true, thumbnail_url: 'https://img.3speak.tv/s1/thumbnail.png', spkvideo: { duration: 12 } },
        { author: 'alice', permlink: 'own' },
        { author: 'kgakakillerg', permlink: 'k1' },
        { permlink: 'nobody' },
        { author: 'amy', permlink: 'a1' },
      ],
    })]])

    const out = await fetchWatchedYear('alice')

    const since = Math.floor((NOW - 365 * 86400000) / 1000)
    expect(f.mock.calls[0][0]).toBe(`https://checker.test/feeds/watched/alice?since=${since}&limit=50&page=1`)
    expect(out.creators).toEqual([
      { account: 'bob', videos: 2 },
      { account: 'amy', videos: 1 },
      { account: 'carol', videos: 1 },
    ])
    expect(out.creatorCount).toBe(3)
    // Excluded accounts are not ranked, but their videos still show as watched.
    expect(out.videos.map((v) => v.permlink)).toEqual(['v1', 'v2', 'k1', 'a1'])
    expect(out.videos[0]).toEqual({
      title: 'B1', author: 'bob', permlink: 'v1', thumbnail: 'https://t/b1.jpg', duration: 30, created: Date.parse(iso(5)), short: false, href: '/watch?v=bob/v1',
    })
    expect(out.videos[1]).toMatchObject({ thumbnail: 'ipfs://legacy', created: 1700000000 * 1000 })
    expect(out.shorts).toEqual([{
      title: '', author: 'carol', permlink: 's1', thumbnail: null, duration: 12, created: null, short: true, href: '/shorts?v=carol/s1',
    }])
  })

  it('keeps the top five creators but counts them all', async () => {
    stubFetch([[/\/feeds\/watched\//, () => ({
      videos: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((author) => ({ author, permlink: 'x' })),
    })]])
    const out = await fetchWatchedYear('me')
    expect(out.creators.map((c) => c.account)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(out.creatorCount).toBe(7)
  })

  it('reads at most twenty pages and caps each gallery', async () => {
    const f = stubFetch([[/\/feeds\/watched\//, () => ({
      totalPages: 99,
      videos: Array.from({ length: 50 }, (_, i) => ({ author: 'bob', permlink: `p${i}`, _short: i % 2 === 0 })),
    })]])
    const out = await fetchWatchedYear('alice', { days: 30 })
    expect(f).toHaveBeenCalledTimes(20)
    expect(out.videos).toHaveLength(GALLERY_MAX)
    expect(out.shorts).toHaveLength(GALLERY_MAX)
    expect(out.creators).toEqual([{ account: 'bob', videos: 1000 }])
  })
})
