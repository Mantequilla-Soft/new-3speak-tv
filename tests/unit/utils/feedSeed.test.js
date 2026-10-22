// The per-page-load shuffle seed shared by the seeded feeds (src/utils/feedSeed.js).
import { describe, it, expect, vi } from 'vitest'
import { getFeedSeed, regenerateFeedSeed, refreshHomeFeeds } from '../../../src/utils/feedSeed.js'

describe('feed seed', () => {
  it('is one of 24 buckets and stays the same until regenerated', () => {
    const s = getFeedSeed()
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThan(24)
    expect(getFeedSeed()).toBe(s)
  })

  it('a pull-to-refresh never hands back the same bucket', () => {
    for (let i = 0; i < 200; i += 1) {
      const before = getFeedSeed()
      const after = regenerateFeedSeed()
      expect(after).not.toBe(before)
      expect(after).toBeGreaterThanOrEqual(0)
      expect(after).toBeLessThan(24)
      expect(getFeedSeed()).toBe(after)
    }
  })

  it('draws from the other 23 buckets, top and bottom included', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.9999)
    const a = regenerateFeedSeed()
    expect([22, 23]).toContain(a)
    expect(regenerateFeedSeed()).toBe(a === 23 ? 22 : 23)
    rnd.mockReturnValue(0)
    const b = regenerateFeedSeed()
    expect(b).toBe(0)
    expect(regenerateFeedSeed()).toBe(1)
    expect(regenerateFeedSeed()).toBe(0)
  })
})

describe('refreshHomeFeeds', () => {
  const client = () => ({ invalidateQueries: vi.fn(() => Promise.resolve()) })
  const keys = (qc) => qc.invalidateQueries.mock.calls.map((c) => c[0].queryKey)

  it('reshuffles and refetches the logged-in home feeds in place', async () => {
    const qc = client()
    const before = getFeedSeed()
    await refreshHomeFeeds(qc, { authenticated: true, user: 'alice' })
    expect(getFeedSeed()).not.toBe(before)
    expect(keys(qc)).toEqual([['follow-feed', 'alice'], ['discover-grouped'], ['interests-grouped'], ['newcontent-grouped']])
  })

  it('refetches the visitor home feed when logged out', async () => {
    const qc = client()
    await refreshHomeFeeds(qc)
    expect(keys(qc)[0]).toEqual(['home-grouped'])
  })

  it('does nothing without a query client', async () => {
    const before = getFeedSeed()
    await refreshHomeFeeds(null)
    expect(getFeedSeed()).toBe(before)
  })
})
