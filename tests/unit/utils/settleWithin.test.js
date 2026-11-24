// settleWithin (utils/settleWithin.js): the warm-up Shorts get at most
// WARMUP_SHORTS_WAIT_MS before the Shorts feed shows without them.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { settleWithin } from '../../../src/utils/settleWithin.js'

afterEach(() => vi.useRealTimers())

describe('settleWithin', () => {
  it('gives the value when it comes in time', async () => {
    await expect(settleWithin(Promise.resolve(['a']), 1500, [])).resolves.toEqual(['a'])
  })

  it('gives the fallback once the time is up, without waiting for a slow answer', async () => {
    vi.useFakeTimers()
    const out = settleWithin(new Promise(() => {}), 1500, [])
    await vi.advanceTimersByTimeAsync(1500)
    await expect(out).resolves.toEqual([])
  })

  it('gives the fallback on a failure, and never rejects', async () => {
    await expect(settleWithin(Promise.reject(new Error('502')), 1500, [])).resolves.toEqual([])
  })

  it('a late answer does not replace the fallback', async () => {
    vi.useFakeTimers()
    let answer
    const out = settleWithin(new Promise((r) => { answer = r }), 1500, [])
    await vi.advanceTimersByTimeAsync(1500)
    answer(['late'])
    await expect(out).resolves.toEqual([])
  })
})
