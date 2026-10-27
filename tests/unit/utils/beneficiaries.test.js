// The locked beneficiaries every publish flow injects: the 10% 3Speak fund, the
// 1% encoder.pay split, remix and sound attribution (src/utils/beneficiaries.js).
import { describe, it, expect } from 'vitest'
import {
  chargesEncoder,
  getLockedBeneficiaries,
  enforceLockedBeneficiaries,
  LOCKED_FUND_WEIGHT,
  LOCKED_ENCODER_WEIGHT,
  REMIX_AUTHOR_WEIGHT,
  SOUND_AUTHOR_WEIGHT,
  HIVE_MAX_BENEFICIARIES,
} from '../../../src/utils/beneficiaries.js'

describe('split constants', () => {
  it('weights are percent x 100, as Hive expects', () => {
    expect(LOCKED_FUND_WEIGHT).toBe(1000)
    expect(LOCKED_ENCODER_WEIGHT).toBe(100)
    expect(REMIX_AUTHOR_WEIGHT).toBe(500)
    expect(SOUND_AUTHOR_WEIGHT).toBe(500)
  })
})

describe('chargesEncoder', () => {
  it('never charges a flow that does not encode video', () => {
    expect(chargesEncoder({ isPremium: false, username: 'alice', includeEncoder: false })).toBe(false)
    expect(chargesEncoder({ isPremium: true, username: 'meno', includeEncoder: false })).toBe(false)
  })

  it('always charges a non-Pro uploader on an encoding flow', () => {
    expect(chargesEncoder({ isPremium: false, username: 'alice', includeEncoder: true })).toBe(true)
  })

  it('skips a new Pro subscriber but keeps charging grandfathered ones, case-insensitively', () => {
    expect(chargesEncoder({ isPremium: true, username: 'alice', includeEncoder: true })).toBe(false)
    expect(chargesEncoder({ isPremium: true, username: 'meno', includeEncoder: true })).toBe(true)
    expect(chargesEncoder({ isPremium: true, username: 'MeNo', includeEncoder: true })).toBe(true)
    expect(chargesEncoder({ isPremium: true, username: undefined, includeEncoder: true })).toBe(false)
  })
})

describe('getLockedBeneficiaries', () => {
  it('a plain non-Pro post gets only the 10% fund', () => {
    expect(getLockedBeneficiaries({ isPremium: false })).toEqual([
      { account: 'threespeakfund', percent: 10, locked: true, minPercent: 10 },
    ])
  })

  it('a Pro post without encoding or attribution has no locked splits', () => {
    expect(getLockedBeneficiaries({ isPremium: true, username: 'alice', includeEncoder: true })).toEqual([])
  })

  it('an encoded non-Pro upload adds the 1% encoder split after the fund', () => {
    const list = getLockedBeneficiaries({ isPremium: false, includeEncoder: true, username: 'alice' })
    expect(list.map((b) => [b.account, b.percent])).toEqual([['threespeakfund', 10], ['encoder.pay', 1]])
  })

  it('remix attribution survives Pro', () => {
    const list = getLockedBeneficiaries({ isPremium: true, originalAuthor: 'bob' })
    expect(list).toEqual([{ account: 'bob', percent: 5, locked: true, minPercent: 5 }])
  })

  it('adds every sound author at 5%', () => {
    const list = getLockedBeneficiaries({ isPremium: true, soundAuthors: ['dj1', 'dj2'] })
    expect(list.map((b) => b.account)).toEqual(['dj1', 'dj2'])
    expect(list.every((b) => b.percent === 5 && b.locked)).toBe(true)
  })

  it('a sound author who is also the remix source is listed once, not twice', () => {
    const list = getLockedBeneficiaries({ isPremium: true, originalAuthor: 'bob', soundAuthors: ['bob'] })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ account: 'bob', percent: 5, minPercent: 5 })
  })

  it('defaults soundAuthors to none', () => {
    expect(() => getLockedBeneficiaries({ isPremium: true })).not.toThrow()
  })
})

describe('enforceLockedBeneficiaries', () => {
  it('raises the fund to 10% when the user lowered it', () => {
    const m = new Map([['threespeakfund', 200], ['friend', 1500]])
    enforceLockedBeneficiaries(m, { isPremium: false })
    expect(m.get('threespeakfund')).toBe(1000)
    expect(m.get('friend')).toBe(1500)
  })

  it('keeps a fund share the user raised above the minimum', () => {
    const m = new Map([['threespeakfund', 2500]])
    enforceLockedBeneficiaries(m, { isPremium: false })
    expect(m.get('threespeakfund')).toBe(2500)
  })

  it('strips a stale fund entry from a Pro publish', () => {
    const m = new Map([['threespeakfund', 1000]])
    enforceLockedBeneficiaries(m, { isPremium: true, username: 'alice' })
    expect(m.has('threespeakfund')).toBe(false)
  })

  it('adds encoder.pay on an encoding flow and removes it where it does not apply', () => {
    const charged = enforceLockedBeneficiaries(new Map(), { isPremium: false, includeEncoder: true })
    expect(charged.get('encoder.pay')).toBe(100)

    const free = enforceLockedBeneficiaries(new Map([['encoder.pay', 100]]), { isPremium: false, includeEncoder: false })
    expect(free.has('encoder.pay')).toBe(false)

    const pro = enforceLockedBeneficiaries(new Map([['encoder.pay', 100]]), { isPremium: true, username: 'alice', includeEncoder: true })
    expect(pro.has('encoder.pay')).toBe(false)

    const grandfathered = enforceLockedBeneficiaries(new Map(), { isPremium: true, username: 'starkerz', includeEncoder: true })
    expect(grandfathered.get('encoder.pay')).toBe(100)
  })

  it('enforces at least 5% for the remix source and each sound author', () => {
    const m = new Map([['bob', 100], ['dj', 900]])
    enforceLockedBeneficiaries(m, { isPremium: true, originalAuthor: 'bob', soundAuthors: ['dj', 'dj2'] })
    expect(m.get('bob')).toBe(500)
    expect(m.get('dj')).toBe(900)
    expect(m.get('dj2')).toBe(500)
  })

  it('returns the same map for chaining', () => {
    const m = new Map()
    expect(enforceLockedBeneficiaries(m, { isPremium: false })).toBe(m)
  })
})

describe('remix chain authors', () => {
  it('locks 5% for every earlier author of the chain, each once', () => {
    const list = getLockedBeneficiaries({ isPremium: true, originalAuthor: 'bob', remixAuthors: ['bob', 'carol', 'dave'] })
    expect(list.map(b => [b.account, b.percent, b.locked])).toEqual([
      ['bob', 5, true], ['carol', 5, true], ['dave', 5, true],
    ])
    const map = enforceLockedBeneficiaries(new Map(), { isPremium: true, originalAuthor: 'bob', remixAuthors: ['carol', 'bob'] })
    expect(Object.fromEntries(map)).toEqual({ bob: REMIX_AUTHOR_WEIGHT, carol: REMIX_AUTHOR_WEIGHT })
  })

  it('leaves out a sound split that no longer fits in Hive\'s 8 slots', () => {
    const chain = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
    const list = getLockedBeneficiaries({ isPremium: false, includeEncoder: true, username: 'me', remixAuthors: chain, soundAuthors: ['singer'] })
    expect(list).toHaveLength(HIVE_MAX_BENEFICIARIES)
    expect(list.some(b => b.account === 'singer')).toBe(false)
    const map = enforceLockedBeneficiaries(new Map(), { isPremium: false, includeEncoder: true, username: 'me', remixAuthors: chain, soundAuthors: ['singer'] })
    expect(map.size).toBe(HIVE_MAX_BENEFICIARIES)
    expect(map.has('singer')).toBe(false)
  })

  it('still raises a sound creator who is already in the chain', () => {
    const list = getLockedBeneficiaries({ isPremium: false, includeEncoder: true, username: 'me', remixAuthors: ['a1', 'a2', 'a3', 'a4', 'a5', 'singer'], soundAuthors: ['singer'] })
    expect(list.find(b => b.account === 'singer').percent).toBe(5)
  })
})
