// The throttled, cached Hive request queue (src/utils/hiveApiThrottle.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let mod
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  mod = await import('../../../src/utils/hiveApiThrottle.js')
})
afterEach(() => vi.useRealTimers())

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('queueRequest', () => {
  it('runs at most 3 requests at once and starts the rest as slots free up', async () => {
    const ds = Array.from({ length: 5 }, deferred)
    const started = []
    const ps = ds.map((d, i) => mod.queueRequest(() => { started.push(i); return d.promise }, 'm', { i }))
    expect(started).toEqual([0, 1, 2])
    expect(mod.getQueueStats()).toMatchObject({ activeRequests: 3, queueLength: 2 })

    ds[0].resolve('r0')
    await expect(ps[0]).resolves.toBe('r0')
    await vi.advanceTimersByTimeAsync(100)
    expect(started).toEqual([0, 1, 2, 3])

    ds.slice(1).forEach((d, i) => d.resolve(`r${i + 1}`))
    await vi.advanceTimersByTimeAsync(500)
    expect(await Promise.all(ps)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    expect(mod.getQueueStats()).toMatchObject({ activeRequests: 0, queueLength: 0 })
  })

  it('serves a repeat call from the 30 second cache', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: 1 })
    await mod.queueRequest(fn, 'get_accounts', ['a'])
    expect(await mod.queueRequest(fn, 'get_accounts', ['a'])).toEqual({ ok: 1 })
    expect(fn).toHaveBeenCalledTimes(1)

    await mod.queueRequest(fn, 'get_accounts', ['b'])
    expect(fn).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(30001)
    await vi.advanceTimersByTimeAsync(200)
    await mod.queueRequest(fn, 'get_accounts', ['a'])
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not cache when caching is off', async () => {
    const fn = vi.fn().mockResolvedValue(1)
    await mod.queueRequest(fn, 'm', {}, false)
    await vi.advanceTimersByTimeAsync(200)
    await mod.queueRequest(fn, 'm', {}, false)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(mod.getQueueStats().cacheSize).toBe(0)
  })

  it('passes a rejection through, frees the slot and caches nothing', async () => {
    const err = new Error('429')
    await expect(mod.queueRequest(() => Promise.reject(err), 'm', {})).rejects.toBe(err)
    expect(mod.getQueueStats()).toMatchObject({ activeRequests: 0, cacheSize: 0 })
  })

  it('clearCache forces a fresh request', async () => {
    const fn = vi.fn().mockResolvedValue(1)
    await mod.queueRequest(fn, 'm', {})
    mod.clearCache()
    await vi.advanceTimersByTimeAsync(200)
    await mod.queueRequest(fn, 'm', {})
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('caps the cache at 500 entries', async () => {
    for (let i = 0; i < 502; i++) {
      await mod.queueRequest(() => Promise.resolve(i), 'm', { i })
    }
    expect(mod.getQueueStats().cacheSize).toBe(500)
  })
})
