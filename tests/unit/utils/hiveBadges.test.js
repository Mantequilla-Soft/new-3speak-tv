// PeakD-style profile badges (src/utils/hiveBadges.js): reading which badge-*
// accounts follow a creator, their art and names, the creator's saved order with
// 3Speak badges pinned first, and saving that order without losing other
// metadata. Hive RPC and signing are mocked; nothing is broadcast.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ post: vi.fn(), getAccounts: vi.fn(), broadcast: vi.fn() }))
vi.mock('axios', () => ({ default: { post: h.post } }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.example' }))
vi.mock('../../../src/utils/avatarCache', () => ({
  cachedProfileImage: (name, img, size) => `img:${name}:${img ?? ''}:${size}`,
}))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: h.getAccounts }))
vi.mock('../../../src/hive-api/aioha', () => ({ broadcastWithAioha: h.broadcast, KeyTypes: { Posting: 'posting' } }))

import fetchHiveBadges, {
  fetchHiveBadges as named, isThreeSpeakBadge, readBadgeOrderFromAccount, saveBadgeOrder,
} from '../../../src/utils/hiveBadges.js'

const profileMeta = (profile, extra = {}) => JSON.stringify({ profile, ...extra })
const follower = (name) => ({ follower: name, following: 'alice', what: ['blog'] })

// Fake chain: followers per account (sorted, as hivemind returns them) and accounts by name.
let followers
let accounts
beforeEach(() => {
  followers = {}
  accounts = {}
  h.post.mockReset().mockImplementation(async (_url, { method, params }) => {
    if (method === 'condenser_api.get_followers') {
      const [user, start, , limit] = params
      const all = (followers[user] || []).filter((f) => f > start).sort()
      return { data: { result: all.slice(0, limit).map(follower) } }
    }
    if (method === 'condenser_api.get_accounts') {
      return { data: { result: params[0].map((n) => accounts[n]).filter(Boolean) } }
    }
    throw new Error(`unexpected ${method}`)
  })
  h.getAccounts.mockReset()
  h.broadcast.mockReset().mockResolvedValue({ success: true })
})

describe('isThreeSpeakBadge', () => {
  it.each([
    ['3Speak Users', true],
    ['3-speak creator', true],
    ['The 3SPEAK OG', true],
    ['Speak Easy', false],
    [undefined, false],
  ])('%j -> %s', (name, yes) => {
    expect(isThreeSpeakBadge({ name })).toBe(yes)
  })
})

describe('readBadgeOrderFromAccount', () => {
  it('reads the saved order and keeps only badge account names', () => {
    const account = { posting_json_metadata: JSON.stringify({ '3speak': { badgeOrder: ['badge-2', 'alice', 7, 'badge-1'] } }) }
    expect(readBadgeOrderFromAccount(account)).toEqual(['badge-2', 'badge-1'])
  })

  it.each([
    ['no account', undefined],
    ['broken JSON', { posting_json_metadata: '{oops' }],
    ['empty metadata', { posting_json_metadata: '' }],
    ['an order that is not a list', { posting_json_metadata: { '3speak': { badgeOrder: 'badge-1' } } }],
  ])('is empty for %s', (_name, account) => {
    expect(readBadgeOrderFromAccount(account)).toEqual([])
  })

  it('accepts already-parsed metadata', () => {
    expect(readBadgeOrderFromAccount({ posting_json_metadata: { '3speak': { badgeOrder: ['badge-9'] } } })).toEqual(['badge-9'])
  })
})

describe('fetchHiveBadges', () => {
  it('is the default export too', () => {
    expect(fetchHiveBadges).toBe(named)
  })

  it('returns nothing for a blank user without asking Hive', async () => {
    expect(await fetchHiveBadges('  @ ')).toEqual([])
    expect(h.post).not.toHaveBeenCalled()
  })

  it('seeks to the badge block and stops at the first non-badge follower', async () => {
    followers.alice = ['aaron', 'badge-000001', 'badge-000002', 'bob', 'zed']
    accounts.alice = { name: 'alice' }
    accounts['badge-000001'] = { name: 'badge-000001', posting_json_metadata: profileMeta({ name: ' Hive OG ', about: ' early ', profile_image: 'https://x/og.png' }) }
    accounts['badge-000002'] = { name: 'badge-000002', json_metadata: profileMeta({ name: 'Builder' }) }

    const badges = await fetchHiveBadges('@Alice')
    expect(h.post.mock.calls[0][1].params).toEqual(['alice', 'badge', 'blog', 100])
    expect(badges).toEqual([
      { account: 'badge-000001', name: 'Hive OG', about: 'early', image: 'img:badge-000001:https://x/og.png:small', url: '/b/badge-000001' },
      { account: 'badge-000002', name: 'Builder', about: '', image: 'img:badge-000002::small', url: '/b/badge-000002' },
    ])
  })

  it('falls back to json_metadata when posting metadata has no profile, and to the account name', async () => {
    followers.alice = ['badge-1', 'badge-2']
    accounts.alice = { name: 'alice' }
    accounts['badge-1'] = { name: 'badge-1', posting_json_metadata: '{bad', json_metadata: profileMeta({ about: 'only about' }) }
    accounts['badge-2'] = { name: 'badge-2', posting_json_metadata: JSON.stringify({ other: 1 }) }
    const badges = await fetchHiveBadges('alice')
    expect(badges.map((b) => [b.name, b.about])).toEqual([['badge-1', 'only about'], ['badge-2', '']])
  })

  it('hides the retired duplicate 3Speak badge and returns nothing when none are left', async () => {
    followers.alice = ['badge-100421']
    expect(await fetchHiveBadges('alice')).toEqual([])
    expect(h.post).toHaveBeenCalledTimes(1)
  })

  it('pages through a long badge block, starting each page after the last row', async () => {
    followers.alice = Array.from({ length: 150 }, (_, i) => `badge-${String(i).padStart(6, '0')}`)
    for (const n of ['alice', ...followers.alice]) accounts[n] = { name: n }
    const badges = await fetchHiveBadges('alice')
    const followerCalls = h.post.mock.calls.filter((c) => c[1].method === 'condenser_api.get_followers')
    expect(followerCalls.map((c) => c[1].params[1])).toEqual(['badge', 'badge-000099'])
    expect(badges).toHaveLength(150)
    // 151 accounts (the owner rides along) in chunks of 30.
    const accountCalls = h.post.mock.calls.filter((c) => c[1].method === 'condenser_api.get_accounts')
    expect(accountCalls.map((c) => c[1].params[0].length)).toEqual([30, 30, 30, 30, 30, 1])
  })

  it('stops paging after five pages even if the node keeps answering', async () => {
    let n = 0
    h.post.mockImplementation(async (_url, { method }) => {
      if (method === 'condenser_api.get_followers') {
        return { data: { result: Array.from({ length: 100 }, () => follower(`badge-${String(n++).padStart(6, '0')}`)) } }
      }
      return { data: { result: [] } }
    })
    await fetchHiveBadges('alice')
    expect(h.post.mock.calls.filter((c) => c[1].method === 'condenser_api.get_followers')).toHaveLength(5)
  })

  it('puts 3Speak badges first, then the saved order, then newer badges in chain order', async () => {
    followers.alice = ['badge-a', 'badge-b', 'badge-c', 'badge-d', 'badge-e']
    accounts.alice = { name: 'alice', posting_json_metadata: JSON.stringify({ '3speak': { badgeOrder: ['badge-c', 'badge-a'] } }) }
    for (const x of ['a', 'b', 'c', 'e']) accounts[`badge-${x}`] = { name: `badge-${x}`, posting_json_metadata: profileMeta({ name: `B ${x}` }) }
    accounts['badge-d'] = { name: 'badge-d', posting_json_metadata: profileMeta({ name: '3Speak Users' }) }
    const order = (await fetchHiveBadges('alice')).map((b) => b.account)
    expect(order).toEqual(['badge-d', 'badge-c', 'badge-a', 'badge-b', 'badge-e'])
  })

  it('surfaces an RPC error', async () => {
    h.post.mockResolvedValue({ data: { error: { message: 'Internal Error' } } })
    await expect(fetchHiveBadges('alice')).rejects.toThrow('Internal Error')
    h.post.mockResolvedValue({ data: { error: {} } })
    await expect(fetchHiveBadges('alice')).rejects.toThrow('condenser_api.get_followers')
  })

  it('treats an empty or odd metadata answer as no metadata', async () => {
    followers.alice = ['badge-1']
    h.post.mockImplementation(async (_u, { method }) => (method === 'condenser_api.get_followers'
      ? { data: { result: [follower('badge-1')] } }
      : { data: { result: null } }))
    expect(await fetchHiveBadges('alice')).toEqual([])
  })
})

describe('saveBadgeOrder', () => {
  it('merges the order into fresh metadata, keeping every other key, with posting authority only', async () => {
    h.getAccounts.mockResolvedValue([{ name: 'alice', posting_json_metadata: JSON.stringify({ profile: { name: 'Alice' }, '3speak': { interests: ['music'] } }) }])
    const saved = await saveBadgeOrder('@Alice', ['@Badge-2', 'badge-1', 'badge-2', 'alice', ''])
    expect(saved).toEqual(['badge-2', 'badge-1'])
    expect(h.getAccounts).toHaveBeenCalledWith(['alice'])
    const [[ops, key]] = h.broadcast.mock.calls
    expect(key).toBe('posting')
    expect(ops).toHaveLength(1)
    const [type, op] = ops[0]
    expect(type).toBe('account_update2')
    expect(op).toMatchObject({ account: 'alice', json_metadata: '', extensions: [] })
    expect(JSON.parse(op.posting_json_metadata)).toEqual({
      profile: { name: 'Alice' },
      '3speak': { interests: ['music'], badgeOrder: ['badge-2', 'badge-1'] },
    })
  })

  it('starts fresh metadata for an account that has none', async () => {
    h.getAccounts.mockResolvedValue([undefined])
    await saveBadgeOrder('alice', null)
    expect(JSON.parse(h.broadcast.mock.calls[0][0][0][1].posting_json_metadata)).toEqual({ '3speak': { badgeOrder: [] } })
  })

  it('refuses without a user, and reports a failed or cancelled broadcast', async () => {
    await expect(saveBadgeOrder('', [])).rejects.toThrow('Not logged in')
    h.getAccounts.mockResolvedValue([{ name: 'alice' }])
    h.broadcast.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce(null)
    await expect(saveBadgeOrder('alice', [])).rejects.toThrow('Could not save your badge order to Hive')
    await expect(saveBadgeOrder('alice', [])).rejects.toThrow('Could not save your badge order to Hive')
  })
})
