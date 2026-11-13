// Warm-up videos spread through a ranked feed (src/lib/spreadIn.js), not at the top.
import { describe, it, expect } from 'vitest'
import { spreadIn } from '../../../src/lib/spreadIn.js'

const feed = (n) => Array.from({ length: n }, (_, i) => `v${i}`)
const extras = (n) => Array.from({ length: n }, (_, i) => `w${i}`)
const spots = (out) => out.map((x, i) => (x.startsWith('w') ? i : -1)).filter((i) => i >= 0)

describe('spreadIn', () => {
  it('never puts one at the top: the first lands after about two rows', () => {
    for (let seed = 0; seed < 50; seed++) {
      const first = spots(spreadIn(feed(60), extras(8), { seed }))[0]
      expect(first).toBeGreaterThanOrEqual(7)
      expect(first).toBeLessThanOrEqual(9)
    }
  })

  it('spaces them out, keeps every card and the feed order', () => {
    const out = spreadIn(feed(60), extras(8), { seed: 42 })
    expect(out).toHaveLength(68)
    expect(out.filter((x) => x.startsWith('v'))).toEqual(feed(60))
    expect(out.filter((x) => x.startsWith('w'))).toEqual(extras(8))
    const s = spots(out)
    for (let i = 1; i < s.length; i++) {
      expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(6)
      expect(s[i] - s[i - 1]).toBeLessThanOrEqual(8)
    }
  })

  it('same seed, same spots (stable while the page is open); another seed may differ', () => {
    expect(spreadIn(feed(60), extras(8), { seed: 7 })).toEqual(spreadIn(feed(60), extras(8), { seed: 7 }))
    const variants = new Set(Array.from({ length: 20 }, (_, seed) => spots(spreadIn(feed(60), extras(8), { seed })).join(',')))
    expect(variants.size).toBeGreaterThan(1)
  })

  it('a spot past what has loaded waits for the next page instead of sitting at the bottom', () => {
    const out = spreadIn(feed(12), extras(8), { seed: 1 })
    expect(out[out.length - 1]).toBe('v11')
    expect(out.filter((x) => x.startsWith('w')).length).toBeLessThan(8)
  })

  it('a finished feed takes the rest at the end', () => {
    const out = spreadIn(feed(5), extras(2), { seed: 1, complete: true })
    expect(out).toEqual([...feed(5), 'w0', 'w1'])
  })

  it('nothing to mix: the feed as it is', () => {
    const f = feed(10)
    expect(spreadIn(f, [], { seed: 1 })).toBe(f)
    expect(spreadIn(undefined, extras(2))).toEqual([])
  })
})
