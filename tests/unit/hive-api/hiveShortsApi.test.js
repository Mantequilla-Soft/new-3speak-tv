// The shorts service in src/hive-api/hiveApi.js: building the feed request from the
// viewer's settings (interests, hide-watched, NSFW, the session seed), turning the
// checker's list into short cards, enriching one short from Hive (stats, the
// viewer's own vote, its `## Title`, the reaction chain it answers, minus a
// @peak.snaps container, and the shorts that answer it), loading nested comments,
// finding a short by its Hive post or player permlink, the one-shot preload cache,
// and the small URL and text helpers. Hive and the checker are faked behind axios.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const CHECKER = 'https://checker.test'
const SHORTS = `${CHECKER}/shortssorted`
const USER_SHORTS = `${CHECKER}/shorts`

// A fake Hive (by RPC method) and a fake checker (by URL), both editable per test.
const hive = vi.hoisted(() => ({ posts: {}, replies: {}, votes: {}, other: {}, error: null, rejectPosts: new Set() }))
const checker = vi.hoisted(() => ({ feed: {}, user: {}, video: {}, failUser: false, failVideo: false }))
const settings = vi.hoisted(() => ({ state: {} }))
const seen = vi.hoisted(() => ({ get: [], post: [] }))
const player = vi.hoisted(() => ({ url: 'https://player.test' }))
const seed = vi.hoisted(() => ({ regenerate: null }))

vi.mock('axios', () => ({
  default: {
    post: async (url, body) => {
      seen.post.push({ url, ...body })
      if (hive.error) return { data: { error: { message: hive.error } } }
      const { method, params } = body
      const key = Array.isArray(params) ? params.join('/') : `${params.author}/${params.permlink}`
      if (method === 'bridge.get_post') {
        if (hive.rejectPosts.has(key)) throw new Error('node timeout')
        return { data: { result: hive.posts[key] ?? null } }
      }
      if (method === 'condenser_api.get_active_votes') return { data: { result: hive.votes[key] ?? [] } }
      if (method === 'condenser_api.get_content_replies') {
        const r = hive.replies[key]
        if (r instanceof Error) throw r
        return { data: { result: r ?? [] } }
      }
      return { data: { result: hive.other[method] } }
    },
    get: async (url) => {
      seen.get.push(url)
      if (url.startsWith(`${CHECKER}/api/video/`)) {
        if (checker.failVideo) throw new Error('checker down')
        return { data: checker.video[url.slice(`${CHECKER}/api/video/`.length)] ?? { success: false } }
      }
      if (url.startsWith(`${USER_SHORTS}/`)) {
        if (checker.failUser) throw new Error('checker down')
        const user = decodeURIComponent(url.slice(USER_SHORTS.length + 1).split('?')[0])
        return { data: checker.user[user] ?? { shorts: [] } }
      }
      if (url.startsWith(SHORTS)) {
        const page = Number(new URL(url).searchParams.get('page'))
        return { data: checker.feed[page] ?? { shorts: [], totalPages: 1 } }
      }
      throw new Error(`unexpected GET ${url}`)
    },
  },
}))
vi.mock('../../../src/i18n', () => ({
  t: (key) => key,
  formatTimeAgo: (date, opts) => `ago(${date},${opts.style})`,
  formatNumber: (n, opts) => `num(${n},${opts.compact})`,
}))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))
vi.mock('../../../src/utils/config', () => ({
  HIVE_API_URL: 'https://node.test',
  HIVE_API_NODES: ['https://node.test'],
  CHECKER_URL: 'https://checker.test',
  SHORTS_API_URL: 'https://checker.test/shortssorted',
  USER_SHORTS_API_URL: 'https://checker.test/shorts',
  appendNsfw: (url, on) => (on ? `${url}${url.includes('?') ? '&' : '?'}nsfw=true` : url),
}))
vi.mock('../../../src/utils/playerUrl', () => ({ getPlayerUrl: () => player.url }))
vi.mock('../../../src/utils/feedSeed', () => ({ getFeedSeed: () => 'seed42', regenerateFeedSeed: () => seed.regenerate() }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => settings.state } }))

let api

// One short as the checker lists it.
const listed = (over = {}) => ({
  owner: 'bob', permlink: 'abcd1234', embed_url: '@bob/my-short', thumbnail_url: 'https://img.test/t.jpg',
  views: 12, createdAt: '2026-11-01T10:00:00.000Z', embed_title: 'Embed title', ...over,
})
const meta = (o) => JSON.stringify(o)
const shortMeta = (o = {}) => meta({ video: { platform: '3speak', ...o } })

beforeEach(async () => {
  Object.assign(hive, { posts: {}, replies: {}, votes: {}, other: {}, error: null, rejectPosts: new Set() })
  Object.assign(checker, { feed: {}, user: {}, video: {}, failUser: false, failVideo: false })
  settings.state = { showNsfw: false, interests: [], shortsFeedMode: 'discover', user: null, hideWatched: true }
  seen.get = []
  seen.post = []
  player.url = 'https://player.test'
  seed.regenerate = vi.fn(() => 'new-seed')
  for (const m of ['log', 'warn', 'error']) vi.spyOn(console, m).mockImplementation(() => {})
  // The module caches shorts it has seen; every test starts with an empty cache.
  vi.resetModules()
  api = await import('../../../src/hive-api/hiveApi.js')
})

describe('the shorts feed request', () => {
  const lastFeedUrl = () => new URL(seen.get.at(-1))

  it('asks for a page with the session seed, and nothing about the viewer when logged out', async () => {
    await api.fetchShortsList(2, 10)
    const url = lastFeedUrl()
    expect(`${url.origin}${url.pathname}`).toBe(SHORTS)
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', limit: '10', seed: 'seed42' })
  })

  it('names the viewer and their hide-watched choice', async () => {
    settings.state.user = 'alice'
    settings.state.hideWatched = false
    await api.fetchShortsList()
    expect(lastFeedUrl().searchParams.get('currentuser')).toBe('alice')
    expect(lastFeedUrl().searchParams.get('hidewatched')).toBe('0')
  })

  it('an explicit viewer wins over the stored one', async () => {
    settings.state.user = 'alice'
    await api.fetchShortsList(1, 10, 'carol')
    expect(lastFeedUrl().searchParams.get('currentuser')).toBe('carol')
    expect(lastFeedUrl().searchParams.get('hidewatched')).toBe('1')
  })

  it('boosts by the viewer\'s interests, and only filters by them in "My interests" mode', async () => {
    settings.state.interests = ['music', 'travel']
    await api.fetchShortsList()
    expect(lastFeedUrl().searchParams.get('interests')).toBe('music,travel')
    expect(lastFeedUrl().searchParams.has('onlyinterests')).toBe(false)
    settings.state.shortsFeedMode = 'interests'
    await api.fetchShortsList()
    expect(lastFeedUrl().searchParams.get('onlyinterests')).toBe('1')
  })

  it('"My interests" without any interests set is not a filter', async () => {
    settings.state.shortsFeedMode = 'interests'
    await api.fetchShortsList()
    expect(lastFeedUrl().searchParams.has('onlyinterests')).toBe(false)
  })

  it('asks for NSFW shorts only when the viewer opted in', async () => {
    settings.state.showNsfw = true
    await api.fetchShortsList()
    expect(lastFeedUrl().searchParams.get('nsfw')).toBe('true')
  })

  it('a new seed comes from the app-wide feed seed', () => {
    expect(api.regenerateShortsSeed()).toBe('new-seed')
    expect(seed.regenerate).toHaveBeenCalled()
  })

  it('pages are always the same size, so no page skips over shorts', () => {
    expect(api.SHORTS_PAGE_SIZE).toBe(10)
  })
})

describe('short cards from the feed', () => {
  it('maps a listed short to a card without asking Hive anything', async () => {
    checker.feed[1] = {
      page: 1, total: 1, totalPages: 1,
      shorts: [listed({
        hive_body: '## Sunset run\nEvening jog by the **sea**', hive_title: 'RE: container', hive_tags: ['running'],
        hive_votes: 4, hive_comments: 2, hive_reward: 1.234, hive_followers: 50, hive_author_reputation: 61,
        hive_sound: { title: 'Song' }, story: true, story_expires_at: '2026-11-02T10:00:00Z',
      })],
    }
    const res = await api.fetchShortsWithDetails(1, 10)
    expect(res).toMatchObject({ success: true, page: 1, total: 1, totalPages: 1 })
    expect(res.shorts[0]).toEqual({
      id: 'bob-abcd1234', author: 'bob', permlink: 'abcd1234', hivePermlink: 'my-short', embedUrl: '@bob/my-short',
      thumbnailUrl: 'https://img.test/t.jpg', views: 12, createdAt: '2026-11-01T10:00:00.000Z',
      timeAgo: 'ago(2026-11-01T10:00:00.000Z,narrow)', heading: 'Sunset run', title: 'Sunset run',
      caption: 'Evening jog by the sea', storyExpiresAt: '2026-11-02T10:00:00Z', tags: ['running'], sound: { title: 'Song' },
      user: { username: '@bob', avatar: '/img/u/bob/avatar/small', isSubscribed: false, followersCount: 50, reputation: 61 },
      stats: { likes: 4, dislikes: 0, comments: 2, shares: 0, remixes: 0, payout: '1.234' },
      comments: [], commentsLoaded: false, isLiked: false, isDisliked: false, _enriched: false,
    })
    expect(seen.post).toEqual([])
  })

  it('without a heading or Hive data, the card falls back to the embed title and zeros', async () => {
    checker.feed[1] = { shorts: [listed({ embed_url: undefined })] }
    const [card] = (await api.fetchShortsWithDetails()).shorts
    expect(card).toMatchObject({
      author: 'bob', hivePermlink: null, heading: '', title: 'Embed title', caption: 'Embed title',
      storyExpiresAt: null, tags: [], sound: null, stats: { likes: 0, comments: 0, payout: '0.00' },
      user: { followersCount: null, reputation: null },
    })
  })

  it('a feed reply without a shorts list is an error', async () => {
    checker.feed[1] = { error: 'down' }
    await expect(api.fetchShortsWithDetails()).rejects.toThrow('Failed to fetch shorts list')
  })
})

describe('a creator\'s shorts', () => {
  it('asks for their page, and for unlisted ones and stories only when told to', async () => {
    checker.user.bob = { shorts: [] }
    await api.fetchUserShortsList('bob', 3, 5)
    expect(seen.get.at(-1)).toBe(`${USER_SHORTS}/bob?page=3&limit=5`)
    await api.fetchUserShortsList('bob', 1, 20, true, { story: true })
    expect(seen.get.at(-1)).toBe(`${USER_SHORTS}/bob?page=1&limit=20&include_unlisted=1&story=1`)
  })

  it('marks the owner\'s unlisted shorts on the cards', async () => {
    checker.user.bob = { page: 1, total: 2, totalPages: 1, shorts: [listed({ unlisted: true }), listed({ permlink: 'p2' })] }
    const res = await api.fetchUserShortsWithDetails('bob', 1, 20, true)
    expect(res.shorts.map((s) => s.unlisted)).toEqual([true, false])
    expect(res).toMatchObject({ success: true, total: 2 })
  })

  it('a reply without a shorts list is an error', async () => {
    checker.user.bob = {}
    await expect(api.fetchUserShortsWithDetails('bob')).rejects.toThrow('Failed to fetch user shorts list')
  })

  it('what it lists can be found by permlink afterwards without another request', async () => {
    checker.user.bob = { shorts: [listed()] }
    await api.fetchUserShortsList('bob')
    const before = seen.get.length
    await expect(api.findShortByPermlink('abcd1234')).resolves.toMatchObject({ embed_url: '@bob/my-short' })
    expect(seen.get.length).toBe(before)
  })
})

describe('finding a short', () => {
  it('by Hive post: from the shorts already loaded, without a request', async () => {
    checker.feed[1] = { shorts: [listed()] }
    await api.fetchShortsList()
    const before = seen.get.length
    await expect(api.findShortByEmbedUrl('bob', 'my-short')).resolves.toMatchObject({ permlink: 'abcd1234' })
    expect(seen.get.length).toBe(before)
  })

  it('by Hive post: from the creator\'s own list next', async () => {
    checker.user.bob = { shorts: [listed()] }
    await expect(api.findShortByEmbedUrl('bob', 'my-short')).resolves.toMatchObject({ permlink: 'abcd1234' })
    expect(seen.get).toEqual([`${USER_SHORTS}/bob?page=1&limit=100`])
  })

  it('by Hive post: then by paging the whole feed until its last page', async () => {
    checker.failUser = true
    checker.feed[1] = { shorts: [listed({ embed_url: '@x/1', permlink: 'x1' })], totalPages: 2 }
    checker.feed[2] = { shorts: [listed()], totalPages: 2 }
    await expect(api.findShortByEmbedUrl('bob', 'my-short')).resolves.toMatchObject({ permlink: 'abcd1234' })
    expect(seen.get.filter((u) => u.startsWith(SHORTS))).toHaveLength(2)
  })

  it('by Hive post: null when nobody has it', async () => {
    checker.feed[1] = { shorts: [listed({ embed_url: '@x/1' })], totalPages: 1 }
    await expect(api.findShortByEmbedUrl('bob', 'nope')).resolves.toBeNull()
  })

  it('by Hive post: stops at a broken feed page', async () => {
    checker.feed[1] = {}
    await expect(api.findShortByEmbedUrl('bob', 'nope')).resolves.toBeNull()
  })

  it('by player permlink: pages the feed, gives up after its last page', async () => {
    checker.feed[1] = { shorts: [listed({ permlink: 'aaa' })], totalPages: 2 }
    checker.feed[2] = { shorts: [listed({ permlink: 'bbb', embed_url: '@bob/b' })], totalPages: 2 }
    await expect(api.findShortByPermlink('bbb')).resolves.toMatchObject({ embed_url: '@bob/b' })
    await expect(api.findShortByPermlink('zzz')).resolves.toBeNull()
  })

  it('by player permlink: stops at a broken feed page', async () => {
    checker.feed[1] = {}
    await expect(api.findShortByPermlink('zzz')).resolves.toBeNull()
  })

  it('never pages the feed more than ten times', async () => {
    for (let p = 1; p <= 12; p++) checker.feed[p] = { shorts: [listed({ permlink: `p${p}`, embed_url: `@x/${p}` })], totalPages: 99 }
    await expect(api.findShortByPermlink('missing')).resolves.toBeNull()
    expect(seen.get.filter((u) => u.startsWith(SHORTS))).toHaveLength(10)
  })
})

describe('enriching one short from Hive', () => {
  const post = (over = {}) => ({
    author: 'bob', permlink: 'my-short', title: '', body: '## Beach day\nWaves and **sun** https://x.test/link',
    children: 3, payout: 0, pending_payout_value: '2.5 HBD', stats: { total_votes: 9 }, json_metadata: shortMeta(),
    parent_author: 'peak.snaps', parent_permlink: 'container-1', ...over,
  })

  it('a short with no Hive post has interactions turned off and asks Hive nothing', async () => {
    const card = await api.fetchCompleteShortData(listed({ embed_url: null }))
    expect(card).toMatchObject({ author: 'bob', hivePermlink: null, hivePostMissing: true, title: 'Embed title' })
    expect(seen.post).toEqual([])
  })

  it('a Hive post that is gone turns interactions off', async () => {
    const card = await api.fetchCompleteShortData(listed())
    expect(card.hivePostMissing).toBe(true)
  })

  it('a node that fails on the post is treated like a missing post', async () => {
    hive.rejectPosts.add('bob/my-short')
    expect((await api.fetchCompleteShortData(listed())).hivePostMissing).toBe(true)
  })

  it('fills in stats, the `## Title` and the caption from the post', async () => {
    hive.posts['bob/my-short'] = post({ json_metadata: shortMeta({ sound: { title: 'Track' } }) })
    checker.video['bob/abcd1234'] = { success: true, reusable: 1 }
    const card = await api.fetchCompleteShortData(listed({ story: true, story_expires_at: '2026-11-02T00:00:00Z' }))
    expect(card).toMatchObject({
      hivePostMissing: false, heading: 'Beach day', title: 'Beach day', caption: 'Waves and sun',
      stats: { likes: 9, comments: 3, payout: '2.50' }, sound: { title: 'Track' }, reusable: true,
      storyExpiresAt: '2026-11-02T00:00:00Z',
    })
  })

  it('counts upvotes when Hive gives no vote total, and keeps the post title without a heading', async () => {
    hive.posts['bob/my-short'] = post({
      stats: undefined, body: 'plain caption', title: 'Post title', payout: '0.75',
      active_votes: [{ percent: 100 }, { percent: -100 }, { percent: 50 }],
    })
    const card = await api.fetchCompleteShortData(listed())
    expect(card).toMatchObject({ title: 'Post title', caption: 'plain caption', stats: { likes: 2, payout: '0.75' } })
  })

  it('without the checker, the reusable flag comes from the post metadata', async () => {
    hive.posts['bob/my-short'] = post({ json_metadata: { video: { reusable: false } } })
    checker.failVideo = true
    expect((await api.fetchCompleteShortData(listed())).reusable).toBe(false)
  })

  it.each([
    [100, { isLiked: true, isDisliked: false }],
    [-100, { isLiked: false, isDisliked: true }],
  ])('shows the viewer\'s own vote (%s)', async (percent, state) => {
    hive.posts['bob/my-short'] = post()
    hive.votes['bob/my-short'] = [{ voter: 'carol', percent: 100 }, { voter: 'alice', percent }]
    expect(await api.fetchCompleteShortData(listed(), 'alice')).toMatchObject(state)
  })

  it('a logged-out viewer\'s votes are never looked up', async () => {
    hive.posts['bob/my-short'] = post()
    await api.fetchCompleteShortData(listed())
    expect(seen.post.map((p) => p.method)).not.toContain('condenser_api.get_active_votes')
  })

  it('a reaction to a video names the video it answers, at the moment it answers', async () => {
    hive.posts['bob/my-short'] = post({ parent_author: 'dana', parent_permlink: 'root-video', json_metadata: meta({ parentTimestamp: 42, video: {} }) })
    hive.posts['dana/root-video'] = {
      author: 'dana', permlink: 'root-video', title: 'The original', created: '2026-10-01T00:00:00', parent_author: '',
      body: 'Intro line\n<sup>footer</sup>\nhttps://link\nSecond line', children: 7, payout: '5.000 HBD', stats: { total_votes: 30 },
      json_metadata: meta({ video: { info: { duration: 120 } }, image: ['https://img.test/root.jpg'] }),
    }
    const card = await api.fetchCompleteShortData(listed())
    expect(card.parentTimestamp).toBe(42)
    expect(card.parentVideo).toEqual({
      author: 'dana', permlink: 'root-video', title: 'The original', created: '2026-10-01T00:00:00', duration: 120,
      thumbnail: 'https://img.test/root.jpg', stats: { total_hive_reward: '5.000 HBD', num_votes: 30 },
    })
    expect(card.reactionChain).toEqual([{
      author: 'dana', permlink: 'root-video', title: 'The original', body: 'Intro line\nSecond line', duration: 120,
      type: 'video', thumbnail: 'https://img.test/root.jpg', isRoot: true, children: 7,
    }])
  })

  it('a remix (original author set, no timestamp) also gets its chain', async () => {
    hive.posts['bob/my-short'] = post({
      parent_author: 'dana', parent_permlink: 'root-video',
      json_metadata: meta({ video: { originalAuthor: 'dana', originalPermlink: 'root-video' } }),
    })
    hive.posts['dana/root-video'] = { author: 'dana', permlink: 'root-video', title: 'Orig', parent_author: '', body: '', json_metadata: '{}', active_votes: [{}, {}] }
    const card = await api.fetchCompleteShortData(listed())
    expect(card.parentTimestamp).toBeUndefined()
    expect(card.parentVideo).toMatchObject({ author: 'dana', duration: 0, thumbnail: null, stats: { total_hive_reward: 0, num_votes: 2 } })
  })

  it('a reaction to a reaction walks up to the root and links each short step to its player page', async () => {
    hive.posts['bob/my-short'] = post({ parent_author: 'erin', parent_permlink: 'erin-short', json_metadata: meta({ parentTimestamp: 3 }) })
    hive.posts['erin/erin-short'] = {
      author: 'erin', permlink: 'erin-short', title: 'RE: The original', body: 'Erin reacts\nmore', parent_author: 'dana',
      parent_permlink: 'root-video', children: 1, json_metadata: shortMeta({ duration: 15 }),
    }
    hive.posts['dana/root-video'] = { author: 'dana', permlink: 'root-video', title: 'The original', parent_author: '', body: 'Root', json_metadata: shortMeta() }
    checker.user.erin = { shorts: [listed({ owner: 'erin', permlink: 'erin-player', embed_url: '@erin/erin-short' })] }
    const card = await api.fetchCompleteShortData(listed())
    expect(card.parentComment).toEqual({ author: 'erin', body: 'Erin reacts\nmore' })
    expect(card.parentShort).toEqual({ author: 'erin', permlink: 'erin-player' })
    expect(card.reactionChain.map((s) => [s.author, s.isRoot ?? false])).toEqual([['dana', true], ['erin', false]])
    // Hivemind's made-up "RE:" title is dropped; the step links to the player permlink.
    expect(card.reactionChain[1]).toMatchObject({ title: '', type: 'video', duration: 15, shortAuthor: 'erin', shortPermlink: 'erin-player' })
  })

  it('walks through plain comments in between, oldest first', async () => {
    hive.posts['bob/my-short'] = post({ parent_author: 'c2', parent_permlink: 'p2', json_metadata: meta({ parentTimestamp: 0 }) })
    hive.posts['c2/p2'] = { author: 'c2', permlink: 'p2', title: '', body: 'second', parent_author: 'c1', parent_permlink: 'p1', json_metadata: {} }
    hive.posts['c1/p1'] = { author: 'c1', permlink: 'p1', title: '', body: 'first', parent_author: 'dana', parent_permlink: 'root', json_metadata: meta({ video: { info: { duration: 9 } }, image: ['i.jpg'] }) }
    hive.posts['dana/root'] = { author: 'dana', permlink: 'root', title: 'Root', parent_author: '', body: '', json_metadata: {} }
    checker.user.c1 = { shorts: [] }
    const card = await api.fetchCompleteShortData(listed())
    expect(card.reactionChain.map((s) => s.author)).toEqual(['dana', 'c1', 'c2'])
    expect(card.reactionChain[1]).toMatchObject({ type: 'video', duration: 9, thumbnail: 'i.jpg' })
    expect(card.reactionChain[2]).toMatchObject({ type: 'comment', body: 'second' })
    expect(card.parentShort).toBeUndefined()
  })

  it('a @peak.snaps container is not a step: the snap it holds becomes the origin, and there is no root video', async () => {
    hive.posts['bob/my-short'] = post({ parent_author: 'erin', parent_permlink: 'erin-snap', json_metadata: meta({ parentTimestamp: 1 }) })
    hive.posts['erin/erin-snap'] = {
      author: 'erin', permlink: 'erin-snap', title: 'RE: Snaps Container // 6/8/2026', body: 'My snap',
      parent_author: 'peak.snaps', parent_permlink: 'container-1', json_metadata: shortMeta(),
    }
    hive.posts['peak.snaps/container-1'] = { author: 'peak.snaps', permlink: 'container-1', title: 'Snaps Container // 6/8/2026', parent_author: '', body: '' }
    checker.user.erin = { shorts: [listed({ owner: 'erin', permlink: 'erin-player', embed_url: '@erin/erin-snap' })] }
    const card = await api.fetchCompleteShortData(listed())
    expect(card.parentVideo).toBeUndefined()
    expect(card.reactionChain).toHaveLength(1)
    expect(card.reactionChain[0]).toMatchObject({ author: 'erin', title: '', isRoot: true, shortPermlink: 'erin-player' })
    expect(JSON.stringify(card.reactionChain)).not.toContain('Snaps Container')
  })

  it('a parent that cannot be loaded leaves the short without a chain', async () => {
    hive.posts['bob/my-short'] = post({ parent_author: 'gone', parent_permlink: 'x', json_metadata: meta({ parentTimestamp: 5 }) })
    const card = await api.fetchCompleteShortData(listed())
    expect(card.parentTimestamp).toBe(5)
    expect(card.reactionChain).toBeUndefined()
    expect(card.parentVideo).toBeUndefined()
  })

  it('lists the shorts that answer it (replies that are themselves 3Speak shorts)', async () => {
    hive.posts['bob/my-short'] = post()
    hive.replies['bob/my-short'] = [
      { author: 'fay', permlink: 'fay-reply', title: '', children: 2, json_metadata: meta({ video: { url: 'ipfs://x', info: { duration: 8 } }, image: ['f.jpg'] }) },
      { author: 'gil', permlink: 'text-reply', json_metadata: '{}' },
      { author: 'hal', permlink: 'unknown-short', json_metadata: shortMeta() },
    ]
    checker.user.fay = { shorts: [listed({ owner: 'fay', permlink: 'fay-player', embed_url: '@fay/fay-reply' })] }
    const card = await api.fetchCompleteShortData(listed())
    expect(card.childReactions).toEqual([{
      author: 'fay', permlink: 'fay-reply', shortAuthor: 'fay', shortPermlink: 'fay-player', title: '',
      type: 'video', thumbnail: 'f.jpg', duration: 8, children: 2,
    }])
  })

  it('a failed replies lookup leaves the rest of the card intact', async () => {
    hive.posts['bob/my-short'] = post()
    hive.replies['bob/my-short'] = new Error('timeout')
    const card = await api.fetchCompleteShortData(listed())
    expect(card.childReactions).toBeUndefined()
    expect(card.title).toBe('Beach day')
  })
})

describe('comments on a short', () => {
  it('loads replies with their nested replies, the viewer\'s vote and the counts', async () => {
    hive.replies['bob/my-short'] = [{
      author: 'ann', permlink: 'c1', body: 'Nice', created: '2026-11-01T00:00:00', net_votes: 2, pending_payout_value: '0.10 HBD',
      active_votes: [{ voter: 'alice', percent: 100 }, { voter: 'x', percent: -50 }],
    }]
    hive.replies['ann/c1'] = [{ author: 'ben', permlink: 'c2', body: 'Agreed', created: '2026-11-01T01:00:00' }]
    const [c] = await api.fetchPostComments('bob', 'my-short', 'alice')
    expect(c).toMatchObject({
      id: 'ann-c1', author: 'ann', body: 'Nice', timeAgo: 'ago(2026-11-01T00:00:00Z,narrow)', netVotes: 2,
      childrenCount: 1, has_voted: true, stats: { num_likes: 1, num_dislikes: 1, total_hive_reward: 0.1 },
      user: { username: '@ann', avatar: '/img/u/ann/avatar/small' },
    })
    expect(c.children[0]).toMatchObject({ id: 'ben-c2', has_voted: false, netVotes: 0, activeVotes: [], children: [] })
  })

  it('a logged-out viewer has voted on nothing', async () => {
    hive.replies['bob/my-short'] = [{ author: 'ann', permlink: 'c1', active_votes: [{ voter: 'alice', percent: 100 }] }]
    expect((await api.fetchPostComments('bob', 'my-short'))[0].has_voted).toBe(false)
  })

  it('a reply whose own replies fail to load still shows', async () => {
    hive.replies['bob/my-short'] = [{ author: 'ann', permlink: 'c1' }]
    hive.replies['ann/c1'] = new Error('timeout')
    expect(await api.fetchPostComments('bob', 'my-short')).toEqual([expect.objectContaining({ id: 'ann-c1', children: [] })])
  })

  it('no replies, or a failed lookup, is an empty list', async () => {
    await expect(api.fetchPostComments('bob', 'quiet')).resolves.toEqual([])
    hive.replies['bob/broken'] = new Error('timeout')
    await expect(api.fetchPostComments('bob', 'broken')).resolves.toEqual([])
  })
})

describe('the Hive lookups', () => {
  it.each([
    ['getPostDetails', ['bob', 'p'], 'bridge.get_post', { author: 'bob', permlink: 'p' }],
    ['getActiveVotes', ['bob', 'p'], 'condenser_api.get_active_votes', ['bob', 'p']],
    ['getComments', ['bob', 'p'], 'bridge.get_discussion', { author: 'bob', permlink: 'p' }],
    ['getAccounts', [['bob', 'ann']], 'condenser_api.get_accounts', [['bob', 'ann']]],
    ['getRecurrentTransfers', ['bob'], 'condenser_api.find_recurrent_transfers', ['bob']],
    ['getSubscriptions', ['bob'], 'bridge.list_all_subscriptions', { account: 'bob' }],
  ])('%s is a JSON-RPC call to the session node', async (fn, args, method, params) => {
    await api[fn](...args)
    expect(seen.post.at(-1)).toEqual({ url: 'https://node.test', jsonrpc: '2.0', method, params, id: 1 })
  })

  it('no recurring transfers is an empty list', async () => {
    await expect(api.getRecurrentTransfers('bob')).resolves.toEqual([])
    hive.other['condenser_api.find_recurrent_transfers'] = [{ to: 'x' }]
    await expect(api.getRecurrentTransfers('bob')).resolves.toEqual([{ to: 'x' }])
  })

  it('a node error in the reply is thrown with its message', async () => {
    hive.error = 'Invalid parameters'
    await expect(api.getAccounts(['bob'])).rejects.toThrow('Invalid parameters')
  })
})

describe('preloading the first shorts', () => {
  it('loads once in the background and hands the result over exactly once', async () => {
    checker.feed[1] = { page: 1, shorts: [listed()] }
    api.preloadShorts(5, 'alice')
    api.preloadShorts(5, 'alice') // a second call while in flight does nothing
    expect(api.hasShortsPreloaded()).toBe(false)
    const data = await api.consumePreloadedShorts()
    expect(data.shorts).toHaveLength(1)
    expect(new URL(seen.get[0]).searchParams.get('limit')).toBe('5')
    expect(seen.get.filter((u) => u.startsWith(SHORTS))).toHaveLength(1)
    await expect(api.consumePreloadedShorts()).resolves.toBeNull()
  })

  it('knows when it has finished', async () => {
    checker.feed[1] = { shorts: [] }
    api.preloadShorts()
    await vi.waitFor(() => expect(api.hasShortsPreloaded()).toBe(true))
    api.preloadShorts() // already done: no new request
    expect(seen.get).toHaveLength(1)
  })

  it('a failed preload leaves nothing to consume, and can be tried again', async () => {
    checker.feed[1] = { error: 'down' }
    api.preloadShorts()
    await expect(api.consumePreloadedShorts()).resolves.toBeNull()
    checker.feed[1] = { shorts: [] }
    api.preloadShorts()
    await expect(api.consumePreloadedShorts()).resolves.toMatchObject({ success: true })
  })

  it('nothing preloaded is null', async () => {
    await expect(api.consumePreloadedShorts()).resolves.toBeNull()
  })
})

describe('embed URLs', () => {
  it.each([
    ['@ismeris/20260129t125012354z', { author: 'ismeris', permlink: '20260129t125012354z' }],
    ['bob/p', { author: 'bob', permlink: 'p' }],
    ['https://3speak.tv/watch?v=bob/p&t=5', { author: 'bob', permlink: 'p' }],
    ['https://play.3speak.tv/embed?v=@bob/p', { author: 'bob', permlink: 'p' }],
    ['https://3speak.tv/bob/p/extra', { author: 'bob', permlink: 'p' }],
    ['nonsense', { author: null, permlink: null }],
    ['', { author: null, permlink: null }],
    [null, { author: null, permlink: null }],
  ])('parses %j', (input, out) => {
    expect(api.parseEmbedUrl(input)).toEqual(out)
  })

  // BUG: src/hive-api/hiveApi.js:198-204. A 3speak.tv URL with only one path part
  // keeps the whole URL as `cleaned`, which then splits on '/' into
  // ['https:', '', '3speak.tv', 'only-one'], so the author comes back as "https:"
  // and the permlink as "". It should be "nothing to parse" like any other
  // unparseable input. (Callers today pass checker embed_urls, "@author/permlink".)
  it('BUG: a 3speak.tv URL without author AND permlink parses to nothing, not author "https:"', () => {
    expect(api.parseEmbedUrl('https://3speak.tv/only-one')).toEqual({ author: null, permlink: null })
  })

  it('builds the /play iframe URL (no view counted), with or without controls', () => {
    expect(api.get3SpeakEmbedUrl('@bob/p')).toBe('https://player.test/play?v=bob/p&mode=iframe&layout=mobile')
    expect(api.get3SpeakEmbedUrl('bob/p', 'desktop', false)).toBe('https://player.test/play?v=bob/p&mode=iframe&layout=desktop&controls=0')
    expect(api.build3SpeakEmbedUrl('bob', 'p', 'mobile', false)).toBe('https://player.test/play?v=bob/p&mode=iframe&layout=mobile&controls=0')
    expect(api.build3SpeakEmbedUrl('bob', 'p')).toBe('https://player.test/play?v=bob/p&mode=iframe&layout=mobile')
  })

  it('uses the production player when none is configured', () => {
    player.url = ''
    expect(api.build3SpeakEmbedUrl('bob', 'p')).toMatch(/^https:\/\/play\.3speak\.tv\/play\?/)
  })

  it('nothing to embed is null', () => {
    expect(api.get3SpeakEmbedUrl('')).toBeNull()
    expect(api.build3SpeakEmbedUrl('bob', '')).toBeNull()
    expect(api.build3SpeakEmbedUrl(null, 'p')).toBeNull()
  })
})

describe('text and display helpers', () => {
  it('turns a post body into a one-line caption: no bare URLs, HTML or markdown markers; links and image alt text stay', () => {
    const body = '# Heading\n\n**Bold** and _it_ <b>html</b> ![pic](https://img.test/a.png) https://x.test/a\n\n\n\n[keep me](https://k.test)'
    expect(api.bodyToPlaintext(body)).toBe('Heading Bold and it html pic [keep me](https://k.test)')
  })

  it('drops the "Watch on 3speak.tv" footer from the caption', () => {
    expect(api.bodyToPlaintext('My caption\n\n[Watch on 3speak.tv](https://3speak.tv/watch?v=bob/p)')).toBe('My caption')
  })

  it('an empty body is an empty caption', () => {
    expect(api.bodyToPlaintext('')).toBe('')
    expect(api.bodyToPlaintext(null)).toBe('')
  })

  it.each([
    ['the posting profile image', { name: 'bob', posting_json_metadata: meta({ profile: { profile_image: 'https://a.test/p.png' } }) }, 'https://a.test/p.png'],
    ['an already parsed posting profile', { name: 'bob', posting_json_metadata: { profile: { profile_image: 'https://a.test/o.png' } } }, 'https://a.test/o.png'],
    ['the older json_metadata profile', { name: 'bob', posting_json_metadata: '{}', json_metadata: meta({ profile: { profile_image: 'https://a.test/j.png' } }) }, 'https://a.test/j.png'],
    ['the avatar proxy when there is none', { name: 'bob', posting_json_metadata: '', json_metadata: '' }, '/img/u/bob/avatar/small'],
    ['the avatar proxy when the metadata is broken', { name: 'bob', posting_json_metadata: '{oops' }, '/img/u/bob/avatar/small'],
    ['a placeholder for no account', null, '/img/u/null/avatar/small'],
  ])('an avatar is %s', (_, account, url) => {
    expect(api.parseUserAvatar(account)).toBe(url)
  })

  it('Hive times are UTC: a time without a zone is read as UTC, one with a zone is kept', () => {
    expect(api.timeAgo('2026-11-01T10:00:00')).toBe('ago(2026-11-01T10:00:00Z,narrow)')
    expect(api.timeAgo('2026-11-01T10:00:00Z')).toBe('ago(2026-11-01T10:00:00Z,narrow)')
    expect(api.timeAgo('2026-11-01T10:00:00+02:00')).toBe('ago(2026-11-01T10:00:00+02:00,narrow)')
    expect(api.timeAgo('')).toBe('common.time.justNow')
  })

  it('numbers are compact and localized', () => {
    expect(api.formatNumber(1500)).toBe('num(1500,true)')
  })

  it('the default export carries the same functions', () => {
    expect(api.default.parseEmbedUrl).toBe(api.parseEmbedUrl)
    expect(api.default.SHORTS_API).toBe(SHORTS)
  })
})
