// Hive read helpers: the batched get_content call, payout and vote-value maths,
// effective vesting shares with power-downs, asset parsing
// (src/utils/hiveUtils.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  dbCall: vi.fn(),
  getAccounts: vi.fn(),
  call: vi.fn(),
  calculateVPMana: vi.fn(),
}))
vi.mock('axios', () => ({ default: { post: h.post } }))
vi.mock('../../../src/utils/hiveNode', () => ({
  getHiveUrl: () => 'https://node.test',
  getHiveClient: () => ({
    call: h.call,
    database: { call: h.dbCall, getAccounts: h.getAccounts },
    rc: { calculateVPMana: h.calculateVPMana },
  }),
}))

import {
  batchGetContent,
  has3SpeakPostAuth,
  isMissingOnHive,
  getUersContent,
  getContentData,
  vestsToRshares,
  getVotePower,
  getRewardPool,
  getFollowers,
  getFollowing,
  parseAsset,
  getDynamicProps,
  votingPower,
  accountVestingShares,
  calculateVoteRshares,
  estimate,
} from '../../../src/utils/hiveUtils.js'

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

const post = (over = {}) => ({
  author: 'alice',
  permlink: 'p1',
  last_payout: '1970-01-01T00:00:00',
  pending_payout_value: '1.234 HBD',
  total_payout_value: '0.000 HBD',
  curator_payout_value: '0.000 HBD',
  active_votes: [{ voter: 'bob' }, { voter: 'carol' }],
  children: 4,
  title: 'Hello',
  json_metadata: '{"image":["https://img.test/a.jpg"]}',
  ...over,
})

describe('batchGetContent', () => {
  it('returns an empty map without posts and makes no request', async () => {
    expect((await batchGetContent([])).size).toBe(0)
    expect((await batchGetContent(null)).size).toBe(0)
    expect(h.post).not.toHaveBeenCalled()
  })

  it('sends one JSON-RPC batch with one get_content per post', async () => {
    h.post.mockResolvedValue({ data: [] })
    await batchGetContent([{ author: 'a', permlink: 'x' }, { author: 'b', permlink: 'y' }])
    expect(h.post).toHaveBeenCalledWith('https://node.test', [
      { jsonrpc: '2.0', id: 0, method: 'condenser_api.get_content', params: ['a', 'x'] },
      { jsonrpc: '2.0', id: 1, method: 'condenser_api.get_content', params: ['b', 'y'] },
    ])
  })

  it('uses pending payout before payout and author+curator after', async () => {
    h.post.mockResolvedValue({ data: [
      { result: post() },
      { result: post({ permlink: 'paid', last_payout: '2026-01-08T00:00:00', total_payout_value: '3.100 HBD', curator_payout_value: '2.005 HBD' }) },
    ] })
    const m = await batchGetContent([{}, {}], 'carol')
    expect(m.get('alice/p1')).toEqual({ payout: '1.23', voters: 2, isVoted: true, children: 4, title: 'Hello', image: 'https://img.test/a.jpg' })
    expect(m.get('alice/paid').payout).toBe('5.11')
  })

  it('skips errored entries and survives hostile metadata', async () => {
    h.post.mockResolvedValue({ data: [
      { error: { message: 'x' } },
      { result: null },
      { result: post({ permlink: 'bad', json_metadata: '{oops', active_votes: undefined, children: undefined, title: '' }) },
      { result: post({ permlink: 'js', json_metadata: { image: 'javascript:alert(1)' } }) },
    ] })
    const m = await batchGetContent([{}], null)
    expect([...m.keys()]).toEqual(['alice/bad', 'alice/js'])
    expect(m.get('alice/bad')).toMatchObject({ image: null, voters: 0, children: 0, isVoted: false, title: '' })
    expect(m.get('alice/js').image).toBeNull()
  })

  it('handles a single non-array response and returns an empty map on failure', async () => {
    h.post.mockResolvedValueOnce({ data: { result: post() } })
    expect((await batchGetContent([{}])).has('alice/p1')).toBe(true)
    h.post.mockRejectedValueOnce(new Error('down'))
    expect((await batchGetContent([{}])).size).toBe(0)
  })
})

describe('getContentData', () => {
  it('computes payout, voter count and whether this user voted', async () => {
    h.dbCall.mockResolvedValue(post())
    expect(await getContentData('bob', 'alice', 'p1')).toEqual({ payout: '1.23', voters: 2, isVoted: true })
    expect(h.dbCall).toHaveBeenCalledWith('get_content', ['alice', 'p1'])
  })

  it('returns null for a missing post', async () => {
    h.dbCall.mockResolvedValue(null)
    expect(await getContentData('bob', 'a', 'p')).toBeNull()
  })
})

describe('getUersContent', () => {
  it('returns null without author/permlink, when missing on Hive, or on error', async () => {
    expect(await getUersContent('', 'p')).toBeNull()
    h.dbCall.mockRejectedValueOnce({ message: 'Post does not exist' })
    expect(await getUersContent('a', 'p')).toBeNull()
    expect(console.error).not.toHaveBeenCalled()
    h.dbCall.mockRejectedValueOnce(new Error('timeout'))
    expect(await getUersContent('a', 'p')).toBeNull()
    h.dbCall.mockResolvedValueOnce({ body: 'hi' })
    expect(await getUersContent('a', 'p')).toEqual({ body: 'hi' })
  })
})

describe('isMissingOnHive', () => {
  it('recognises "does not exist" in the message or in jse_info', () => {
    expect(isMissingOnHive(new Error('Account x does not exist'))).toBe(true)
    expect(isMissingOnHive({ jse_info: { stack: [{ format: 'post does not exist' }] } })).toBe(true)
    expect(isMissingOnHive(new Error('timeout'))).toBe(false)
    expect(isMissingOnHive(null)).toBe(false)
  })
})

describe('has3SpeakPostAuth', () => {
  it('checks posting account_auths for threespeak', async () => {
    h.getAccounts.mockResolvedValueOnce([{ posting: { account_auths: [['threespeak', 1]] } }])
    expect(await has3SpeakPostAuth('alice')).toBe(true)
    h.getAccounts.mockResolvedValueOnce([{ posting: { account_auths: [] } }])
    expect(await has3SpeakPostAuth('alice')).toBe(false)
    h.getAccounts.mockResolvedValueOnce([])
    expect(await has3SpeakPostAuth('ghost')).toBe(false)
    h.getAccounts.mockRejectedValueOnce(new Error('down'))
    expect(await has3SpeakPostAuth('alice')).toBe(false)
  })
})

describe('parseAsset', () => {
  it('parses legacy strings and NAI objects', () => {
    expect(parseAsset('1.500 HBD')).toEqual({ amount: 1.5, symbol: 'HBD' })
    expect(parseAsset('10.000 HIVE')).toEqual({ amount: 10, symbol: 'HIVE' })
    expect(parseAsset({ amount: '123456', precision: 3, nai: '@@000000021' })).toEqual({ amount: 123.456, symbol: 'HIVE' })
    expect(parseAsset({ amount: '1000000', precision: 6, nai: '@@000000037' })).toEqual({ amount: 1, symbol: 'VESTS' })
  })
})

describe('accountVestingShares', () => {
  const base = {
    vesting_shares: '1000.000000 VESTS',
    received_vesting_shares: '500.000000 VESTS',
    delegated_vesting_shares: '200.000000 VESTS',
    next_vesting_withdrawal: '1969-12-31T23:59:59',
  }

  it('is own + received - delegated when not powering down', () => {
    expect(accountVestingShares(base)).toBe(1300)
  })

  it('subtracts this week\'s power-down, capped at what is left to withdraw', () => {
    const pd = { ...base, next_vesting_withdrawal: '2026-10-29T00:00:00', vesting_withdraw_rate: '100.000000 VESTS' }
    expect(accountVestingShares({ ...pd, to_withdraw: 1300e6, withdrawn: 0 })).toBe(1200)
    expect(accountVestingShares({ ...pd, to_withdraw: 1300e6, withdrawn: 1260e6 })).toBe(1260)
  })
})

describe('vote rshares', () => {
  it('a full vote at full power spends 2% of vesting shares', () => {
    expect(calculateVoteRshares(1000, 10000)).toBe(1000 * 1e6 * 0.02)
    expect(calculateVoteRshares(1000, 5000)).toBe(1000 * 1e6 * 0.01)
    expect(calculateVoteRshares(1000, -10000)).toBe(calculateVoteRshares(1000, 10000))
  })

  it('vestsToRshares: power = VP% x weight / 1e4 / 50 + 1, over vests in micro-units / 1e4', () => {
    expect(vestsToRshares(1000, 100, 10000)).toBe(3 * 1000 * 1e6 / 1e4)
    expect(vestsToRshares(1000, 0, 10000)).toBe(1000 * 1e6 / 1e4)
  })
})

describe('votingPower', () => {
  it('turns dhive mana percentage (basis points) into 0-100', () => {
    h.calculateVPMana.mockReturnValue({ percentage: 8550 })
    expect(votingPower({ name: 'a' })).toBe(85.5)
  })
})

describe('getDynamicProps and estimate (vote value)', () => {
  const chain = {
    get_reward_fund: { reward_balance: '800000.000 HIVE', recent_claims: '200000000000000' },
    get_dynamic_global_properties: {
      total_vesting_fund_hive: '200000000.000 HIVE',
      total_vesting_shares: '400000000000.000000 VESTS',
      virtual_supply: '500000000.000 HIVE',
      hbd_print_rate: 10000,
      hbd_interest_rate: 1500,
      head_block_number: 99,
      vesting_reward_percent: 1500,
    },
    get_feed_history: { current_median_history: { base: '0.250 HBD', quote: '1.000 HIVE' } },
    get_chain_properties: { account_creation_fee: '3.000 HIVE' },
  }
  const voter = {
    vesting_shares: '1000000.000000 VESTS',
    received_vesting_shares: '0.000000 VESTS',
    delegated_vesting_shares: '0.000000 VESTS',
    next_vesting_withdrawal: '1969-12-31T23:59:59',
  }
  beforeEach(() => { h.dbCall.mockImplementation(async (m) => chain[m]) })

  it('derives HIVE per MVESTS, the price feed and the reward fund', async () => {
    const p = await getDynamicProps()
    expect(p).toMatchObject({
      hivePerMVests: 500,
      base: 0.25,
      quote: 1,
      fundRecentClaims: 2e14,
      fundRewardBalance: 800000,
      headBlock: 99,
      accountCreationFee: '3.000 HIVE',
    })
  })

  it('returns null when a chain read fails', async () => {
    h.dbCall.mockRejectedValue(new Error('down'))
    expect(await getDynamicProps()).toBeNull()
  })

  it('values a vote as rshares / recent_claims x reward balance x price', async () => {
    h.calculateVPMana.mockReturnValue({ percentage: 10000 })
    // 1e6 VESTS x 1e6 x 2% = 2e10 rshares; 2e10/2e14 x 800000 x 0.25 = 20
    expect(await estimate(voter, 100)).toBe('20.000')
    expect(await estimate(voter, 50)).toBe('10.000')
    expect(await estimate(voter, -100)).toBe('-20.000')
  })

  it('scales with current voting power', async () => {
    h.calculateVPMana.mockReturnValue({ percentage: 5000 })
    expect(await estimate(voter, 100)).toBe('10.000')
  })

  it('answers 0.000 when chain data is missing', async () => {
    h.dbCall.mockRejectedValue(new Error('down'))
    expect(await estimate(voter, 100)).toBe('0.000')
  })
})

describe('getRewardPool', () => {
  it('derives the HIVE price from the median feed', async () => {
    h.dbCall.mockImplementation(async (m) => (m === 'get_reward_fund'
      ? { reward_balance: '800000.000 HIVE', recent_claims: '123' }
      : { base: '0.300 HBD', quote: '1.000 HIVE' }))
    expect(await getRewardPool()).toEqual({ reward_balance: 800000, recent_claims: 123, hive_price: 0.3 })
  })

  it('returns zeros on failure', async () => {
    h.dbCall.mockRejectedValue(new Error('down'))
    expect(await getRewardPool()).toEqual({ reward_balance: 0, recent_claims: 0, hive_price: 0 })
  })
})

describe('getVotePower', () => {
  it('returns null for a guest or an unknown account', async () => {
    expect(await getVotePower('')).toBeNull()
    h.getAccounts.mockResolvedValue([])
    expect(await getVotePower('ghost')).toBeNull()
  })

  it('regenerates voting power since the last vote, capped at 100%', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
      h.call.mockResolvedValue({ rc_accounts: [{ max_rc: '1000', rc_manabar: { current_mana: '250' } }] })
      h.getAccounts.mockResolvedValueOnce([{ voting_power: 5000, last_vote_time: '2026-10-22T00:00:00' }])
      const r = await getVotePower('alice')
      expect(r.vp).toBeCloseTo(5000 + 10000 * 12 * 3600 / (5 * 86400))
      expect(r.rcPercent).toBe(25)
      h.getAccounts.mockResolvedValueOnce([{ voting_power: 9900, last_vote_time: '2026-10-01T00:00:00' }])
      expect((await getVotePower('alice')).vp).toBe(10000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('followers / following', () => {
  it('maps the condenser result to names and falls back to []', async () => {
    h.call.mockResolvedValueOnce([{ follower: 'a' }, { follower: 'b' }])
    expect(await getFollowers('alice')).toEqual(['a', 'b'])
    expect(h.call).toHaveBeenCalledWith('condenser_api', 'get_followers', ['alice', '', 'blog', 100])
    h.call.mockResolvedValueOnce([{ following: 'c' }])
    expect(await getFollowing('alice', 'x', 5)).toEqual(['c'])
    expect(h.call).toHaveBeenLastCalledWith('condenser_api', 'get_following', ['alice', 'x', 'blog', 5])
    h.call.mockRejectedValueOnce(new Error('down'))
    expect(await getFollowers('alice')).toEqual([])
  })
})
