// Channel Surfing (src/utils/surf.js): the numbered channel lineup, community
// channels, "seen this session", and picking the next video on a channel.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  state: { hideAi: false },
  params: '',
  flagged: new Set(),
  loadAiFlags: vi.fn(async () => {}),
}))

vi.mock('axios', () => ({ default: { get: h.get } }))
vi.mock('../../../src/utils/config', () => ({ TAG_FEED_URL: 'https://checker.example', FEED_URL: 'https://feed.example' }))
vi.mock('../../../src/utils/feedParams', () => ({ feedParams: () => h.params }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => h.state } }))
vi.mock('../../../src/utils/aiFlags', () => ({
  aiKey: (a, p) => (a && p ? `${a}/${p}` : null),
  isAiFlagged: (a, p) => h.flagged.has(`${a}/${p}`),
  loadAiFlags: h.loadAiFlags,
}))
vi.mock('../../../src/i18n', () => ({ t: (k, o) => (o ? `${k}:${o.label}` : `t(${k})`) }))

const load = async () => {
  vi.resetModules()
  return import('../../../src/utils/surf.js')
}

const v = (author, permlink) => ({ author: { username: author }, permlink })
const page = (videos, total = videos.length) => ({ data: { videos, total } })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  h.get.mockReset()
  h.loadAiFlags.mockClear()
  h.state = { hideAi: false }
  h.params = ''
  h.flagged.clear()
})

describe('channel lineup', () => {
  it('numbers every channel 1..n with unique slugs, each category before its topics', async () => {
    const { CHANNELS } = await load()
    expect(CHANNELS.map((c) => c.number)).toEqual(CHANNELS.map((_, i) => i + 1))
    expect(new Set(CHANNELS.map((c) => c.slug)).size).toBe(CHANNELS.length)
    expect(CHANNELS[0].isCategory).toBe(true)
    const cat = CHANNELS[0]
    expect(CHANNELS.slice(1, 1 + cat.topics.length).map((c) => c.slug)).toEqual(cat.topics)
    for (const c of CHANNELS.slice(1, 1 + cat.topics.length)) expect(c.category).toBe(cat.slug)
  })

  it('stepChannel wraps around both ends and starts at the top for an unknown slug', async () => {
    const { CHANNELS, stepChannel } = await load()
    const last = CHANNELS[CHANNELS.length - 1]
    expect(stepChannel(last.slug, 1)).toBe(CHANNELS[0])
    expect(stepChannel(CHANNELS[0].slug, -1)).toBe(last)
    expect(stepChannel(CHANNELS[0].slug, CHANNELS.length * 3 + 2)).toBe(CHANNELS[2])
    expect(stepChannel('hive-123', 1)).toBe(CHANNELS[1])
  })

  it('channel numbers are two digits, communities show CM', async () => {
    const { CHANNELS, channelNumber, getChannel } = await load()
    expect(channelNumber(CHANNELS[6])).toBe('07')
    expect(channelNumber(getChannel('hive-181335'))).toBe('CM')
    expect(channelNumber(null)).toBe('00')
  })

  it('a category title reads "all of", a topic just its label', async () => {
    const { CHANNELS, channelTitle, channelLabel } = await load()
    const cat = CHANNELS.find((c) => c.isCategory)
    const topic = CHANNELS.find((c) => !c.isCategory)
    expect(channelTitle(cat)).toBe(`misc.surf.allOf:t(${cat.labelKey})`)
    expect(channelTitle(topic)).toBe(`t(${topic.labelKey})`)
    expect(channelLabel(null)).toBe('')
  })
})

describe('community channels', () => {
  it('any hive-<digits> id is a channel; anything else unknown is not', async () => {
    const { getChannel } = await load()
    expect(getChannel('hive-181335')).toMatchObject({ slug: 'hive-181335', isCommunity: true, label: null, labelKey: 'misc.surf.community' })
    expect(getChannel('hive-abc')).toBeNull()
    expect(getChannel('nonsense')).toBeNull()
    expect(getChannel(null)).toBeNull()
  })

  it('a remembered community title is shown as-is', async () => {
    const { getChannel, rememberCommunityChannel, channelLabel } = await load()
    rememberCommunityChannel('hive-1', 'Cats & <Dogs>')
    rememberCommunityChannel('not-a-community', 'X')
    rememberCommunityChannel('hive-2', '')
    const ch = getChannel('hive-1')
    expect(ch.labelKey).toBeNull()
    expect(channelLabel(ch)).toBe('Cats & <Dogs>')
    expect(getChannel('hive-2').label).toBeNull()
    expect(Object.keys(JSON.parse(localStorage.getItem('3speak_surf_community_titles')))).toEqual(['hive-1'])
  })

  it('corrupt stored titles do not break the lookup', async () => {
    localStorage.setItem('3speak_surf_community_titles', '{oops')
    const { getChannel } = await load()
    expect(getChannel('hive-1').labelKey).toBe('misc.surf.community')
  })
})

describe('urls, keys and storage', () => {
  it('builds the watch URL with the channel in it', async () => {
    const { surfUrl, videoKey, videoAuthor } = await load()
    expect(surfUrl(v('alice', 'p1'), 'music & art')).toBe('/watch?v=alice/p1&surf=music%20%26%20art')
    expect(videoAuthor({ author: 'bob' })).toBe('bob')
    expect(videoAuthor({ owner: 'carol' })).toBe('carol')
    expect(videoKey({ permlink: 'p' })).toBeNull()
    expect(videoKey(v('a', ''))).toBeNull()
  })

  it('remembers the last channel', async () => {
    const { saveLastChannel, loadLastChannel, CHANNELS } = await load()
    expect(loadLastChannel()).toBeNull()
    saveLastChannel(CHANNELS[3].slug)
    expect(loadLastChannel()).toBe(CHANNELS[3])
  })

  it('markSeen keeps the newest 500 keys, moving a repeat to the end', async () => {
    const { markSeen } = await load()
    for (let i = 0; i < 510; i++) markSeen(`a/${i}`)
    markSeen('a/100')
    markSeen('')
    const list = JSON.parse(sessionStorage.getItem('3speak_surf_seen'))
    expect(list).toHaveLength(500)
    expect(list[0]).toBe('a/10')
    expect(list.at(-1)).toBe('a/100')
    expect(list.filter((k) => k === 'a/100')).toHaveLength(1)
  })
})

describe('findNextOnChannel', () => {
  it('plays the best-ranked video not seen yet and not playing now', async () => {
    const { findNextOnChannel, markSeen, CHANNELS } = await load()
    const topic = CHANNELS.find((c) => !c.isCategory).slug
    h.params = '&currentuser=me'
    h.get.mockResolvedValue(page([v('a', '1'), v('b', '2'), v('c', '3')]))
    markSeen('b/2')
    expect(await findNextOnChannel(topic, 'a/1')).toEqual(v('c', '3'))
    expect(h.get.mock.calls[0][0]).toBe(`https://checker.example/videos/tag/${topic}?page=1&limit=20&type=videos&currentuser=me`)
  })

  it('walks to the next page when the first is all seen', async () => {
    const { findNextOnChannel, markSeen, CHANNELS } = await load()
    const topic = CHANNELS.find((c) => !c.isCategory).slug
    const first = Array.from({ length: 20 }, (_, i) => v('a', `p${i}`))
    first.forEach((x) => markSeen(`a/${x.permlink}`))
    h.get.mockResolvedValueOnce(page(first, 30)).mockResolvedValueOnce(page([v('z', 'new')], 30))
    expect(await findNextOnChannel(topic)).toEqual(v('z', 'new'))
    expect(h.get.mock.calls[1][0]).toContain('page=2')
  })

  it('starts the channel over rather than going dark when everything was seen', async () => {
    const { findNextOnChannel, markSeen, CHANNELS } = await load()
    const topic = CHANNELS.find((c) => !c.isCategory).slug
    h.get.mockResolvedValue(page([v('a', '1'), v('b', '2')]))
    markSeen('a/1')
    markSeen('b/2')
    expect(await findNextOnChannel(topic, 'a/1')).toEqual(v('b', '2'))
    expect(h.get).toHaveBeenCalledTimes(1)
  })

  it('is null when the channel has nothing, and ignores rows without author or permlink', async () => {
    const { findNextOnChannel, CHANNELS } = await load()
    const topic = CHANNELS.find((c) => !c.isCategory).slug
    h.get.mockResolvedValue({ data: { videos: [{ permlink: 'x' }, { author: 'y' }], total: 2 } })
    expect(await findNextOnChannel(topic)).toBeNull()
  })

  it('caches a page for the session, but retries a page that failed', async () => {
    const { findNextOnChannel, CHANNELS } = await load()
    const topic = CHANNELS.find((c) => !c.isCategory).slug
    h.get.mockRejectedValueOnce(new Error('503'))
    await expect(findNextOnChannel(topic)).rejects.toThrow('503')
    h.get.mockResolvedValue(page([v('a', '1')]))
    await findNextOnChannel(topic)
    await findNextOnChannel(topic)
    expect(h.get).toHaveBeenCalledTimes(2)
  })

  it('a category deals its topics out round-robin without duplicates', async () => {
    const { findNextOnChannel, markSeen, CHANNELS } = await load()
    const cat = CHANNELS.find((c) => c.isCategory && c.topics.length >= 2)
    const [t1, t2] = cat.topics
    h.get.mockImplementation(async (url) => {
      if (url.includes(`/tag/${cat.slug}?`)) return page([v('cat', '1'), v('cat', '2')])
      if (url.includes(`/tag/${t1}?`)) return page([v('t1', '1'), v('cat', '1')])
      if (url.includes(`/tag/${t2}?`)) throw new Error('topic down')
      return page([])
    })
    // Order: cat/1, t1/1, (cat/1 dup skipped), cat/2.
    markSeen('cat/1')
    expect(await findNextOnChannel(cat.slug)).toEqual(v('t1', '1'))
    markSeen('t1/1')
    expect(await findNextOnChannel(cat.slug)).toEqual(v('cat', '2'))
    // Answered pages are cached; only the failed topic is asked again.
    const urls = h.get.mock.calls.map((c) => c[0])
    expect(urls.filter((u) => u.includes(`/tag/${t1}?`))).toHaveLength(1)
    expect(urls.filter((u) => u.includes(`/tag/${t2}?`))).toHaveLength(2)
  })

  it('a quiet community falls back from Trending to New', async () => {
    const { findNextOnChannel } = await load()
    h.params = '&interests=x'
    h.get.mockImplementation(async (url) => (url.includes('/trending?')
      ? page([])
      : page([v('m', '1')])))
    expect(await findNextOnChannel('hive-99')).toEqual(v('m', '1'))
    const urls = h.get.mock.calls.map((c) => c[0])
    expect(urls[0]).toBe('https://feed.example/feeds/community/hive-99/trending?page=1&limit=20&interests=x')
    expect(urls[1]).toBe('https://feed.example/feeds/community/hive-99/new?page=1&limit=20')
  })

  it('with "Hide AI-generated" on, never picks a flagged video, not even to start over', async () => {
    const { findNextOnChannel, CHANNELS } = await load()
    const topic = CHANNELS.find((c) => !c.isCategory).slug
    h.state = { hideAi: true }
    h.flagged.add('a/1')
    h.flagged.add('own/2')
    h.get.mockResolvedValue(page([v('a', '1'), { ...v('b', '2'), owner: 'own' }, v('c', '3')]))
    expect(await findNextOnChannel(topic)).toEqual(v('c', '3'))
    expect(h.loadAiFlags).toHaveBeenCalledWith(['a/1', 'b/2', 'own/2', 'c/3'])

    h.flagged.add('c/3')
    expect(await findNextOnChannel(topic)).toBeNull()
  })
})
