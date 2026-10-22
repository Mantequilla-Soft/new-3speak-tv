// Spam filtering by Hive reputation: score conversion, the cached
// bridge.get_profile lookup and the thread filter/marker (src/utils/reputation.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const call = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/hiveNode', () => ({ hiveClient: { call } }))

import {
  hiveRepToScore,
  getUserReputation,
  isLowReputation,
  batchGetReputations,
  filterByReputation,
  markByReputation,
  clearReputationCache,
  LOW_REP_THRESHOLD,
} from '../../../src/utils/reputation.js'

beforeEach(() => {
  clearReputationCache()
  call.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('hiveRepToScore', () => {
  it('converts the raw bigint to the familiar 25-based score', () => {
    expect(hiveRepToScore(0)).toBe(25)
    expect(hiveRepToScore('1000000000')).toBe(25)
    expect(hiveRepToScore(10 ** 10)).toBe(34)
    expect(hiveRepToScore(10 ** 14)).toBe(70)
    expect(hiveRepToScore('-10000000000')).toBe(16)
    expect(hiveRepToScore(-(10 ** 12))).toBe(-2)
  })

  it('returns null without a value and 25 for junk', () => {
    expect(hiveRepToScore(null)).toBeNull()
    expect(hiveRepToScore(undefined)).toBeNull()
    expect(hiveRepToScore('abc')).toBe(25)
  })
})

describe('getUserReputation', () => {
  it('reads bridge.get_profile and caches the score', async () => {
    call.mockResolvedValue({ reputation: 61.2 })
    expect(await getUserReputation('alice')).toBe(61.2)
    expect(await getUserReputation('alice')).toBe(61.2)
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('bridge', 'get_profile', { account: 'alice' })
  })

  it('looks the user up again once the 5 minute cache expires', async () => {
    vi.useFakeTimers()
    try {
      call.mockResolvedValue({ reputation: 50 })
      await getUserReputation('alice')
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      await getUserReputation('alice')
      expect(call).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a new account (no or zero reputation) as neutral 25', async () => {
    call.mockResolvedValueOnce({}).mockResolvedValueOnce({ reputation: 0 })
    expect(await getUserReputation('new1')).toBe(25)
    expect(await getUserReputation('new2')).toBe(25)
  })

  it('treats an account that does not exist on Hive as neutral and caches it', async () => {
    call.mockRejectedValue({ message: 'Account warmup does not exist' })
    expect(await getUserReputation('warmup')).toBe(25)
    expect(await getUserReputation('warmup')).toBe(25)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('fails open to 25 on any other error, without caching', async () => {
    call.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ reputation: -3 })
    expect(await getUserReputation('alice')).toBe(25)
    expect(await getUserReputation('alice')).toBe(-3)
  })
})

describe('isLowReputation', () => {
  it('only a negative score counts as a spammer', async () => {
    call.mockImplementation(async (_a, _m, { account }) => ({ reputation: { bad: -1, zero: 0, low: 5 }[account] }))
    expect(await isLowReputation('bad')).toBe(true)
    expect(await isLowReputation('zero')).toBe(false)
    expect(await isLowReputation('low')).toBe(false)
  })
})

describe('batchGetReputations', () => {
  it('looks up each distinct name once', async () => {
    call.mockResolvedValue({ reputation: 40 })
    const map = await batchGetReputations(['a', 'b', 'a'])
    expect([...map.keys()]).toEqual(['a', 'b'])
    expect(call).toHaveBeenCalledTimes(2)
  })
})

describe('filterByReputation', () => {
  const reps = { good: 60, spam: -5, kid: 30 }
  beforeEach(() => {
    call.mockImplementation(async (_a, _m, { account }) => ({ reputation: reps[account] }))
  })

  it('returns [] for empty input', async () => {
    expect(await filterByReputation([])).toEqual([])
    expect(await filterByReputation(null)).toEqual([])
  })

  it('drops spammers at every depth, for both children and replies, without mutating input', async () => {
    const input = [
      { author: 'good', children: [{ author: 'spam' }, { author: { username: 'kid' } }] },
      { author: 'spam', children: [{ author: 'good' }] },
      { author: 'good', replies: [{ author: 'spam' }] },
    ]
    const out = await filterByReputation(input)
    expect(out).toHaveLength(2)
    expect(out[0].children).toEqual([{ author: { username: 'kid' } }])
    expect(out[1].replies).toEqual([])
    expect(input[0].children).toHaveLength(2)
  })

  it('uses author_reputation shipped on the comments instead of extra RPCs', async () => {
    const out = await filterByReputation([
      { author: 'x', author_reputation: -(10 ** 12) },
      { author: 'y', author_reputation: 10 ** 14 },
    ])
    expect(out.map((c) => c.author)).toEqual(['y'])
    expect(call).not.toHaveBeenCalled()
  })
})

describe('markByReputation', () => {
  it('flags authors under the threshold without removing anything', async () => {
    expect(LOW_REP_THRESHOLD).toBe(15)
    call.mockImplementation(async (_a, _m, { account }) => ({ reputation: { a: 14.9, b: 15, c: -2 }[account] }))
    const out = await markByReputation([{ author: 'a', children: [{ author: 'c' }] }, { author: 'b' }])
    expect(out[0].isLowReputation).toBe(true)
    expect(out[0].children[0].isLowReputation).toBe(true)
    expect(out[1].isLowReputation).toBe(false)
  })

  it('returns [] for empty input', async () => {
    expect(await markByReputation(undefined)).toEqual([])
  })
})
