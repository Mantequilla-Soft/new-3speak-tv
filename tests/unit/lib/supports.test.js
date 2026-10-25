// Tips ("supports"): the pending queue saved before broadcast, the retrying
// report to the checker, resume on app start, links and HBD formatting
// (src/lib/supports.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const axios = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))

const KEY = '3speak_pending_supports'
const DAY = 24 * 60 * 60 * 1000
const tip = (over = {}) => ({ tipper: 'bob', author: 'alice', permlink: 'vid', amount: '1.5', currency: 'HBD', memo: 'thanks', ...over })
const pending = () => JSON.parse(localStorage.getItem(KEY) || '[]')
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })

let m
beforeEach(async () => {
  vi.resetModules()
  axios.post.mockReset()
  axios.get.mockReset()
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
  m = await import('../../../src/lib/supports.js')
})
afterEach(() => vi.useRealTimers())

describe('queueSupport', () => {
  it('saves a qualifying tip before broadcast and returns the entry', () => {
    const e = m.queueSupport(tip())
    expect(e).toMatchObject({ tipper: 'bob', author: 'alice', permlink: 'vid', amount: 1.5, currency: 'HBD', memo: 'thanks', createdAt: Date.now() })
    expect(e.id).toMatch(/^\d+-[a-z0-9]+$/)
    expect(pending()).toEqual([e])
  })

  it('refuses a tip that cannot count', () => {
    expect(m.queueSupport(tip({ tipper: 'alice' }))).toBeNull()
    expect(m.queueSupport(tip({ amount: 0 }))).toBeNull()
    expect(m.queueSupport(tip({ amount: 'abc' }))).toBeNull()
    expect(m.queueSupport(tip({ currency: 'VESTS' }))).toBeNull()
    expect(m.queueSupport(tip({ permlink: '' }))).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps at most 10 pending tips', () => {
    for (let i = 0; i < 12; i++) m.queueSupport(tip({ permlink: `v${i}` }))
    const list = pending()
    expect(list).toHaveLength(10)
    expect(list[0].permlink).toBe('v2')
  })

  it('an empty memo is stored as ""', () => {
    expect(m.queueSupport(tip({ memo: undefined })).memo).toBe('')
  })
})

describe('recordSupport', () => {
  it('waits for the block, posts the tip and forgets it once recorded', async () => {
    const e = m.queueSupport(tip())
    axios.post.mockResolvedValue({ status: 200, data: { recorded: true } })
    const p = m.recordSupport(e)
    await vi.advanceTimersByTimeAsync(2999)
    expect(axios.post).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ recorded: true })
    const [url, body, opts] = axios.post.mock.calls[0]
    expect(url).toBe('https://checker.3speak.tv/supports/record')
    expect(body).toEqual({ tipper: 'bob', author: 'alice', permlink: 'vid', amount: 1.5, currency: 'HBD', memo: 'thanks' })
    expect(opts.validateStatus(202)).toBe(true)
    expect(opts.validateStatus(500)).toBe(false)
    expect(pending()).toEqual([])
  })

  it('keeps asking while the transfer is not on chain yet (202), on the 3/6/10/20/40s schedule', async () => {
    const e = m.queueSupport(tip())
    axios.post
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValueOnce({ status: 200, data: 'ok' })
    const p = m.recordSupport(e)
    await vi.advanceTimersByTimeAsync(3000 + 6000)
    expect(axios.post).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(await p).toBe('ok')
  })

  it('drops the report on a final 400 or 404', async () => {
    for (const status of [400, 404]) {
      localStorage.clear()
      const e = m.queueSupport(tip())
      axios.post.mockRejectedValueOnce(httpError(status))
      const p = m.recordSupport(e)
      await vi.advanceTimersByTimeAsync(3000)
      expect(await p).toBeNull()
      expect(pending()).toEqual([])
    }
  })

  it('stops on a 429 but keeps the report for later', async () => {
    const e = m.queueSupport(tip())
    axios.post.mockRejectedValueOnce(httpError(429))
    const p = m.recordSupport(e)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBeNull()
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(pending()).toHaveLength(1)
  })

  it('a report still unanswered after every retry stays queued', async () => {
    const e = m.queueSupport(tip())
    axios.post.mockRejectedValue(httpError(503))
    const p = m.recordSupport(e)
    await vi.advanceTimersByTimeAsync(80000)
    expect(await p).toBeNull()
    expect(axios.post).toHaveBeenCalledTimes(5)
    expect(pending()).toHaveLength(1)
  })

  it('reports each tip once at a time', async () => {
    const e = m.queueSupport(tip())
    axios.post.mockResolvedValue({ status: 200, data: 'ok' })
    const a = m.recordSupport(e)
    expect(await m.recordSupport(e)).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    await a
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('ignores a missing or non-qualifying entry', async () => {
    expect(await m.recordSupport(null)).toBeNull()
    expect(await m.recordSupport({ ...tip(), tipper: 'alice', id: 'x' })).toBeNull()
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('gives up on and drops a tip older than the checker\'s 24h window', async () => {
    const e = m.queueSupport(tip())
    vi.setSystemTime(Date.now() + DAY)
    const p = m.recordSupport(e)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBeNull()
    expect(axios.post).not.toHaveBeenCalled()
    expect(pending()).toEqual([])
  })
})

describe('resumePendingSupports', () => {
  it('drops stale or broken entries and reports the live ones', async () => {
    const live = m.queueSupport(tip())
    const list = [...pending(), { id: 'old', ...tip(), createdAt: Date.now() - DAY - 1 }, { ...tip() }, null]
    localStorage.setItem(KEY, JSON.stringify(list))
    axios.post.mockResolvedValue({ status: 200, data: 'ok' })
    m.resumePendingSupports()
    expect(pending().map((p) => p.id)).toEqual([live.id])
    await vi.advanceTimersByTimeAsync(3000)
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(pending()).toEqual([])
  })

  it('copes with corrupt storage', () => {
    localStorage.setItem(KEY, '{nope')
    expect(() => m.resumePendingSupports()).not.toThrow()
  })
})

describe('dropPendingSupport', () => {
  it('removes one entry and clears the key when the list empties', () => {
    const a = m.queueSupport(tip())
    const b = m.queueSupport(tip({ permlink: 'v2' }))
    m.dropPendingSupport(a.id)
    expect(pending().map((p) => p.id)).toEqual([b.id])
    m.dropPendingSupport(b.id)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('supporter lists', () => {
  it('ask the checker with paging and the hidden flag only when wanted', async () => {
    axios.get.mockResolvedValue({ data: { items: [] } })
    await m.fetchSupports('alice')
    await m.fetchSupports('alice', 2, 10, { includeHidden: true })
    await m.fetchSupportsGiven('bob', 3)
    await m.fetchSupporters('a b')
    await m.fetchSupported('bob', 6)
    expect(axios.get.mock.calls).toEqual([
      ['https://checker.3speak.tv/supports/alice', { params: { page: 1, limit: 20 } }],
      ['https://checker.3speak.tv/supports/alice', { params: { page: 2, limit: 10, includeHidden: 1 } }],
      ['https://checker.3speak.tv/supports/by/bob', { params: { page: 3, limit: 20 } }],
      ['https://checker.3speak.tv/supports/a%20b/supporters', { params: { limit: 12 } }],
      ['https://checker.3speak.tv/supports/by/bob/supported', { params: { limit: 6 } }],
    ])
  })
})

describe('supportItemLink', () => {
  it('links videos, shorts (by asset id) and audio to their pages', () => {
    expect(m.supportItemLink({ author: 'a', permlink: 'p' })).toBe('/@a/p')
    expect(m.supportItemLink({ author: 'a', permlink: 'p', kind: 'audio' })).toBe('/audio/a/p')
    expect(m.supportItemLink({ author: 'a', permlink: 'p', kind: 'short', video: { asset_permlink: 'asset1' } })).toBe('/shorts?v=a/asset1')
    expect(m.supportItemLink({ author: 'a', permlink: 'p', video: { short: true } })).toBe('/shorts?v=a/p')
  })
})

describe('HBD formatting', () => {
  it('formatHbd shows 3 decimals and never "0.000" for a real tiny tip', () => {
    expect(m.formatHbd(1.5)).toBe('1.500 HBD')
    expect(m.formatHbd(0.0004)).toBe('<0.001 HBD')
    expect(m.formatHbd(0)).toBe('0.000 HBD')
    expect(m.formatHbd(null)).toBe('0.000 HBD')
  })

  it('formatHbdCompact scales its precision with the amount', () => {
    expect(m.formatHbdCompact(0)).toBe('0 HBD')
    expect(m.formatHbdCompact(-1)).toBe('0 HBD')
    expect(m.formatHbdCompact(0.0004)).toBe('<0.001 HBD')
    expect(m.formatHbdCompact(0.001)).toBe('0.001 HBD')
    expect(m.formatHbdCompact(0.5)).toBe('0.5 HBD')
    expect(m.formatHbdCompact(4.4789)).toBe('4.48 HBD')
    expect(m.formatHbdCompact(12.34)).toBe('12.3 HBD')
    expect(m.formatHbdCompact(150.4)).toBe('150 HBD')
    expect(m.formatHbdCompact(1000)).toBe('1k HBD')
    expect(m.formatHbdCompact(1250)).toBe('1.3k HBD')
  })

  // Minor: 999.6 rounds to 0 decimals and prints "1000 HBD" instead of switching to "1k HBD".
  it('an amount that rounds up to 1000 reads "1k HBD", not "1000 HBD"', () => {
    expect(m.formatHbdCompact(999.6)).toBe('1k HBD')
  })
})
