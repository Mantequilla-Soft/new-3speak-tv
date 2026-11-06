// A creator's year on Hive for the recap (src/lib/hiveYear.js): fans, follows,
// new followers, communities and income. HafSQL via the checker comes first; the
// browser history scans are the fallback. Axios is mocked, so every Hive call is
// answered by a small router keyed on the JSON-RPC method.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get, post: h.post } }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.test' }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

import {
  RECAP_EXCLUDED,
  notExcluded,
  fetchHiveYear,
  fetchNewFollowers,
  fetchCommunityPosts,
  fetchIncomeYear,
} from '../../../src/lib/hiveYear.js'

const NOW = Date.parse('2026-06-01T00:00:00Z')
// Hive timestamps have no zone suffix; the module appends "Z".
const ts = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString().slice(0, 19)

// Routes axios.post bodies to handlers by method name. A handler may be a
// function (called with params) or a list of pages consumed in order.
function hive(routes) {
  const calls = []
  h.post.mockImplementation(async (url, body) => {
    calls.push(body)
    const route = routes[body.method]
    if (route === undefined) throw new Error(`unexpected ${body.method}`)
    if (route instanceof Error) return { data: { error: { message: route.message } } }
    const result = typeof route === 'function' ? route(body.params) : route.shift()
    return { data: { result } }
  })
  return calls
}

const chainPrices = {
  'condenser_api.get_dynamic_global_properties': () => ({
    total_vesting_fund_hive: '500.000 HIVE',
    total_vesting_shares: '1000.000000 VESTS',
  }),
  'condenser_api.get_current_median_history_price': () => ({ base: '0.250 HBD', quote: '1.000 HIVE' }),
}

let userSeq = 0
const freshUser = () => `user${++userSeq}`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  h.get.mockReset()
  h.post.mockReset()
  // The checker is down unless a test says otherwise: the browser scan runs.
  h.get.mockRejectedValue(new Error('checker down'))
})
afterEach(() => vi.useRealTimers())

describe('notExcluded', () => {
  it.each([
    ['kgakakillerg', false],
    ['BPCVOTER1', false],
    ['alice', true],
    [null, true],
    [undefined, true],
  ])('%s -> %s', (name, expected) => {
    expect(notExcluded(name)).toBe(expected)
  })

  it('lists the accounts the team asked to leave out', () => {
    expect([...RECAP_EXCLUDED]).toEqual(['kgakakillerg', 'bpcvoter1'])
  })
})

describe('fetchHiveYear from HafSQL', () => {
  it('drops service and excluded accounts and caps the fan list', async () => {
    const user = freshUser()
    h.get.mockResolvedValue({
      data: {
        success: true,
        fans: [
          { account: 'hivebuzz', votes: 99, comments: 0 },
          { account: 'kgakakillerg', votes: 50, comments: 0 },
          { account: 'bob', votes: 10, comments: 1 },
          { account: 'carol', votes: 5, comments: 0 },
          { account: 'dave', votes: 1, comments: 0 },
        ],
      },
    })
    const out = await fetchHiveYear(user, { fanLimit: 2 })
    expect(out).toEqual({
      fans: [{ account: 'bob', votes: 10, comments: 1 }, { account: 'carol', votes: 5, comments: 0 }],
      followed: null,
      followedCount: 0,
      source: 'hafsql',
    })
    expect(h.get).toHaveBeenCalledWith('https://checker.test/creator-stats/hive-year', expect.objectContaining({
      params: { username: user, days: 365 },
    }))
    expect(h.post).not.toHaveBeenCalled()
  })

  it('asks the checker once per account and window, shared with the income reader', async () => {
    const user = freshUser()
    h.get.mockResolvedValue({
      data: { success: true, fans: [], author: { hbd: 0, hive: 0, vests: 0, count: 0, byPost: {} }, ads: [] },
    })
    hive({ ...chainPrices })
    await fetchHiveYear(user)
    await fetchIncomeYear(user)
    expect(h.get).toHaveBeenCalledTimes(1)
  })

  it('asks again after a failed checker answer instead of caching the failure', async () => {
    const user = freshUser()
    h.get.mockResolvedValueOnce({ data: { success: false } })
    hive({ 'condenser_api.get_account_history': [[]] })
    await fetchHiveYear(user)
    h.get.mockResolvedValueOnce({ data: { success: true, fans: [] } })
    const out = await fetchHiveYear(user)
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(out.source).toBe('hafsql')
  })
})

describe('fetchHiveYear browser scan', () => {
  const follow = (follower, following, what = ['blog']) => ({
    id: 'follow',
    json: JSON.stringify(['follow', { follower, following, what }]),
  })

  it('ranks fans by votes plus weighted replies and keeps only follows still on', async () => {
    const user = freshUser()
    const rows = [
      [0, { timestamp: ts(400), op: ['vote', { voter: 'old', author: user }] }],
      [1, { timestamp: ts(30), op: ['vote', { voter: 'bob', author: user }] }],
      [2, { timestamp: ts(29), op: ['vote', { voter: 'bob', author: user }] }],
      [3, { timestamp: ts(28), op: ['comment', { author: 'carol', parent_author: user }] }],
      [4, { timestamp: ts(27), op: ['vote', { voter: user, author: user }] }],
      [5, { timestamp: ts(26), op: ['vote', { voter: 'hivebuzz', author: user }] }],
      [6, { timestamp: ts(25), op: ['vote', { voter: 'bpcvoter1', author: user }] }],
      [7, { timestamp: ts(24), op: ['vote', { voter: 'zed', author: 'someoneelse' }] }],
      [8, { timestamp: ts(20), op: ['custom_json', follow(user, 'x')] }],
      [9, { timestamp: ts(19), op: ['custom_json', follow(user, 'y')] }],
      [10, { timestamp: ts(18), op: ['custom_json', follow(user, 'x', [])] }],
      [11, { timestamp: ts(17), op: ['custom_json', follow(user, user)] }],
      [12, { timestamp: ts(16), op: ['custom_json', follow('other', 'z')] }],
      [13, { timestamp: ts(15), op: ['custom_json', { id: 'follow', json: '{broken' }] }],
      [14, { timestamp: ts(14), op: ['custom_json', { id: 'notify', json: '[]' }] }],
      [15, { timestamp: ts(13), op: ['custom_json', follow(user, 'w')] }],
    ]
    const calls = hive({ 'condenser_api.get_account_history': [rows] })
    const out = await fetchHiveYear(user)
    // carol: 1 reply x 3 = 3 beats bob's 2 votes.
    expect(out.fans).toEqual([
      { account: 'carol', votes: 0, comments: 1 },
      { account: 'bob', votes: 2, comments: 0 },
    ])
    expect(out.followed).toEqual(['w', 'y'])
    expect(out.followedCount).toBe(2)
    // Reaching index 0 ends the scan after one page.
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual([user, -1, 1000, 1 | 2 | (1 << 18), 0])
  })

  it('pages backwards until the window start and breaks ties alphabetically', async () => {
    const user = freshUser()
    const pages = [
      [[5000, { timestamp: ts(10), op: ['vote', { voter: 'zoe', author: user }] }]],
      [[4000, { timestamp: ts(20), op: ['vote', { voter: 'amy', author: user }] }]],
      [[3000, { timestamp: ts(500), op: ['vote', { voter: 'ancient', author: user }] }]],
    ]
    const calls = hive({ 'condenser_api.get_account_history': pages })
    const out = await fetchHiveYear(user)
    expect(out.fans.map((f) => f.account)).toEqual(['amy', 'zoe'])
    expect(calls.map((c) => c.params[1])).toEqual([-1, 4999, 3999])
  })

  it('stops on an empty page and on a null result', async () => {
    const user = freshUser()
    hive({ 'condenser_api.get_account_history': [null] })
    expect(await fetchHiveYear(user)).toEqual({ fans: [], followed: [], followedCount: 0 })
  })

  it('surfaces a Hive RPC error', async () => {
    hive({ 'condenser_api.get_account_history': new Error('node exploded') })
    await expect(fetchHiveYear(freshUser())).rejects.toThrow('node exploded')
  })
})

describe('fetchNewFollowers', () => {
  const note = (id, daysAgo, extra) => ({ id, date: ts(daysAgo), type: 'follow', ...extra })

  it('reads the follower from the url or the message and skips duplicates and service accounts', async () => {
    hive({
      'bridge.account_notifications': [[
        note(1, 1, { url: '@bob' }),
        note(2, 2, { msg: '@carol followed you' }),
        note(3, 3, { url: '@bob' }),
        note(4, 4, { url: '@hivebuzz' }),
        note(5, 5, { url: '@alice' }),
        note(6, 6, { type: 'vote', url: '@dan' }),
        note(7, 7, { url: '@kgakakillerg' }),
        note(8, 8, { url: 'nonsense' }),
      ]],
    })
    const out = await fetchNewFollowers('alice')
    expect(out.accounts).toEqual(['bob', 'carol'])
    expect(out.since).toEqual(new Date(Date.parse(`${ts(8)}Z`)))
  })

  it('pages with last_id while pages are full and stops at the window start', async () => {
    const full = Array.from({ length: 100 }, (_, i) => note(1000 - i, 1, { url: `@f${i}` }))
    const second = [note(10, 2, { url: '@late' }), note(9, 400, { url: '@tooold' })]
    const calls = hive({ 'bridge.account_notifications': [full, second] })
    const out = await fetchNewFollowers('alice')
    expect(calls[0].params).toEqual({ account: 'alice', limit: 100 })
    expect(calls[1].params).toEqual({ account: 'alice', limit: 100, last_id: 901 })
    expect(out.accounts).toHaveLength(101)
    expect(out.accounts.at(-1)).toBe('late')
    expect(out.accounts).not.toContain('tooold')
  })

  it('answers no accounts and no date when there are no notifications', async () => {
    hive({ 'bridge.account_notifications': [[]] })
    expect(await fetchNewFollowers('alice')).toEqual({ accounts: [], since: null })
  })
})

describe('fetchCommunityPosts', () => {
  const post = (permlink, daysAgo, extra = {}) => ({
    author: 'alice', permlink, title: `T ${permlink}`, created: ts(daysAgo), body: '', json_metadata: {}, ...extra,
  })

  it('groups posts by community, picks each post picture and attaches community avatars', async () => {
    const rows = [
      post('a', 1, { community: 'hive-1', community_title: 'One', json_metadata: { image: ['', 'https://img/a.png'] } }),
      post('b', 2, { community: 'hive-1', json_metadata: { video: { info: { sourceMap: [{ type: 'thumbnail', url: 'ipfs://thumb' }] } } } }),
      post('c', 3, { community: 'hive-2', json_metadata: { video: { info: { thumbnail: 'https://t/c.jpg' } } } }),
      post('d', 4, { community: 'hive-1', body: 'see https://x.test/pic.webp here' }),
      post('e', 5, { community: 'hive-2' }),
      post('f', 6),
    ]
    hive({
      'bridge.get_account_posts': [rows],
      'condenser_api.get_accounts': () => [
        { name: 'hive-1', posting_json_metadata: JSON.stringify({ profile: { profile_image: 'https://p/1.png' } }) },
        { name: 'hive-2', posting_json_metadata: '{not json' },
      ],
    })
    const out = await fetchCommunityPosts('alice')
    expect(out.total).toBe(2)
    expect(out.communities.map((c) => [c.name, c.title, c.posts, c.image])).toEqual([
      ['hive-1', 'One', 3, 'https://p/1.png'],
      ['hive-2', 'hive-2', 2, null],
    ])
    expect(out.communities[0].items.map((i) => i.image)).toEqual(['https://img/a.png', 'ipfs://thumb', 'https://x.test/pic.webp'])
    expect(out.communities[1].items.map((i) => i.image)).toEqual(['https://t/c.jpg', null])
  })

  it('continues from the last post (inclusive start) and stops at the window start', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => post(`p${i}`, 1, { community: 'hive-1' }))
    const page2 = [page1[19], post('q', 2, { community: 'hive-1' }), post('old', 500, { community: 'hive-1' })]
    const calls = hive({ 'bridge.get_account_posts': [page1, page2], 'condenser_api.get_accounts': () => [] })
    const out = await fetchCommunityPosts('alice', { limit: 1 })
    expect(calls[1].params).toMatchObject({ start_author: 'alice', start_permlink: 'p19' })
    expect(out.communities[0].posts).toBe(21)
  })

  it('still answers when the community avatars cannot be read', async () => {
    hive({
      'bridge.get_account_posts': [[post('a', 1, { community: 'hive-1' })]],
      'condenser_api.get_accounts': new Error('nope'),
    })
    const out = await fetchCommunityPosts('alice')
    expect(out.communities[0]).toMatchObject({ name: 'hive-1', posts: 1 })
    expect(out.communities[0].image).toBeUndefined()
  })

  it('keeps at most 100 items per community but counts every post', async () => {
    const many = Array.from({ length: 120 }, (_, i) => post(`p${i}`, 1, { community: 'hive-1' }))
    hive({ 'bridge.get_account_posts': [many], 'condenser_api.get_accounts': () => [] })
    const out = await fetchCommunityPosts('alice')
    expect(out.communities[0].posts).toBe(120)
    expect(out.communities[0].items).toHaveLength(100)
  })
})

describe('fetchIncomeYear', () => {
  it('converts the HafSQL answer to HP and HBD and reads ad memos', async () => {
    const user = freshUser()
    h.get.mockResolvedValue({
      data: {
        success: true,
        fans: [],
        author: { hbd: 1, hive: 2, vests: 100, count: 3, byPost: { p1: { hbd: 1, hive: 0, vests: 10 } } },
        ads: [
          { memo: '3Speak ad revenue share (viewer) - 2026-05', symbol: 'HBD', amount: 0.5 },
          { memo: 'something else', symbol: 'HIVE', amount: 2 },
        ],
      },
    })
    hive({ ...chainPrices })
    const out = await fetchIncomeYear(user)
    expect(out).toEqual({
      author: { hbd: 1, hive: 2, hp: 50, count: 3 },
      authorByPost: { p1: { hbd: 1, hive: 0, hp: 5 } },
      curation: { hp: 0, count: 0 },
      ads: {
        hbd: 0.5,
        hive: 2,
        count: 2,
        payments: [
          { kind: 'viewer', period: '2026-05', hbd: 0.5, hive: 0 },
          { kind: 'creator', period: null, hbd: 0, hive: 2 },
        ],
      },
      hivePrice: 0.25,
      complete: true,
      source: 'hafsql',
    })
  })

  it('scans history for author, curation and ad income in the window', async () => {
    const user = freshUser()
    const rows = [
      [0, { timestamp: ts(400), op: ['author_reward', { author: user, permlink: 'old', hbd_payout: '9.000 HBD' }] }],
      [1, { timestamp: ts(10), op: ['author_reward', { author: user, permlink: 'p1', hbd_payout: '1.000 HBD', hive_payout: '0.500 HIVE', vesting_payout: '20.000000 VESTS' }] }],
      [2, { timestamp: ts(9), op: ['author_reward', { author: user, permlink: 'p1', hbd_payout: '1.000 HBD', hive_payout: '0.000 HIVE', vesting_payout: '20.000000 VESTS' }] }],
      [3, { timestamp: ts(8), op: ['author_reward', { author: 'other', permlink: 'x', hbd_payout: '5.000 HBD' }] }],
      [4, { timestamp: ts(7), op: ['curation_reward', { curator: user, reward: '10.000000 VESTS' }] }],
      [5, { timestamp: ts(6), op: ['transfer', { to: user, amount: '2.000 HBD', memo: '3Speak ad revenue share (creator+viewer) - 2026-W20' }] }],
      [6, { timestamp: ts(5), op: ['transfer', { to: user, amount: '3.000 HIVE', memo: '3Speak ad revenue share' }] }],
      [7, { timestamp: ts(4), op: ['transfer', { to: user, amount: '100.000 HBD', memo: 'rent' }] }],
      [8, { timestamp: ts(3), op: ['transfer', { to: user, amount: '1.000 XYZ', memo: '3Speak ad revenue share' }] }],
    ]
    hive({ 'condenser_api.get_account_history': [rows], ...chainPrices })
    const out = await fetchIncomeYear(user)
    expect(out.author).toEqual({ hbd: 2, hive: 0.5, hp: 20, count: 2 })
    expect(out.authorByPost).toEqual({ p1: { hbd: 2, hive: 0.5, hp: 20 } })
    expect(out.curation).toEqual({ hp: 5, count: 1 })
    expect(out.ads.hbd).toBe(2)
    expect(out.ads.hive).toBe(3)
    expect(out.ads.count).toBe(3)
    expect(out.ads.payments[0]).toEqual({ kind: 'creator+viewer', period: '2026-W20', hbd: 2, hive: 0 })
    expect(out.complete).toBe(true)
  })

  it('says the scan is incomplete when it runs out of pages before the window start', async () => {
    const user = freshUser()
    const page = (i) => [[i, { timestamp: ts(1), op: ['curation_reward', { curator: user, reward: '2.000000 VESTS' }] }]]
    hive({ 'condenser_api.get_account_history': [page(300), page(200)], ...chainPrices })
    const out = await fetchIncomeYear(user, { maxPages: 2 })
    expect(out.complete).toBe(false)
    expect(out.curation).toEqual({ hp: 2, count: 2 })
  })

  it('treats an empty first page as a complete, empty year and guards zero divisors', async () => {
    const user = freshUser()
    hive({
      'condenser_api.get_account_history': [[]],
      'condenser_api.get_dynamic_global_properties': () => ({ total_vesting_fund_hive: '1.000 HIVE', total_vesting_shares: '' }),
      'condenser_api.get_current_median_history_price': () => ({ base: '0.300 HBD', quote: '' }),
    })
    const out = await fetchIncomeYear(user)
    expect(out.complete).toBe(true)
    expect(out.hivePrice).toBeCloseTo(0.3)
    expect(out.author.hp).toBe(0)
  })
})
