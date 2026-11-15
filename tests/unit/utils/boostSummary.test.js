import { describe, it, expect, vi } from 'vitest'
import { fetchBoostTotals, normalizeBoostSummary, summarizeLedger } from '../../../src/utils/boostSummary.js'

const API = 'https://live.example'
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const SUMMARY = {
  goal: { title: 'New mic', targetHbd: 50, progressHbd: 12.5, reached: false },
  count: 3,
  totalHbd: 17.5,
  top: [{ account: 'fan', hbd: 10, count: 2 }, { account: 'badadib', displayName: 'Badadib', hbd: 7.5, count: 1 }],
}

describe('normalizeBoostSummary', () => {
  it('reads goal, totals and top supporters', () => {
    expect(normalizeBoostSummary(SUMMARY)).toEqual({
      source: 'summary',
      count: 3,
      total: 17.5,
      goal: { title: 'New mic', target: 50, progress: 12.5, reached: false },
      top: [
        { account: 'fan', displayName: undefined, hbd: 10, count: 2 },
        { account: 'badadib', displayName: 'Badadib', hbd: 7.5, count: 1 },
      ],
    })
  })

  it('has no goal without one or with a zero target, and counts a covered target as reached', () => {
    expect(normalizeBoostSummary({ goal: null, count: 0, totalHbd: 0, top: [] }).goal).toBeNull()
    expect(normalizeBoostSummary({ goal: { targetHbd: 0, progressHbd: 3 } }).goal).toBeNull()
    expect(normalizeBoostSummary({ goal: { targetHbd: 10, progressHbd: 10 } }).goal.reached).toBe(true)
  })

  it('rejects what is not a summary and drops broken supporter rows', () => {
    expect(normalizeBoostSummary(null)).toBeNull()
    expect(normalizeBoostSummary('x')).toBeNull()
    expect(normalizeBoostSummary({ top: [null, { hbd: 1 }, { account: 'fan', hbd: '2' }] }).top)
      .toEqual([{ account: 'fan', displayName: undefined, hbd: 2, count: 0 }])
  })
})

describe('summarizeLedger', () => {
  it('sums the USD of the boosts that were not rejected', () => {
    expect(summarizeLedger([
      { usdAmount: 2, status: 'ok' }, { usdAmount: '3.5' }, { usdAmount: 9, status: 'rejected' },
    ])).toEqual({ source: 'ledger', count: 2, total: 5.5, goal: null, top: [] })
    expect(summarizeLedger({})).toBeNull()
  })
})

describe('fetchBoostTotals', () => {
  it('asks the summary route first', async () => {
    const fetchImpl = vi.fn(async () => res(200, SUMMARY))
    const out = await fetchBoostTotals(API, 'badadib-live 1', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API}/rooms/badadib-live%201/boost/summary`)
    expect(out.source).toBe('summary')
    expect(out.goal.target).toBe(50)
  })

  it('falls back to the ledger when the server has no summary route (404)', async () => {
    const fetchImpl = vi.fn(async (url) => (url.includes('/boost/summary')
      ? res(404, { message: 'Not Found' })
      : res(200, [{ usdAmount: 4 }])))
    const out = await fetchBoostTotals(API, 'badadib-live', { fetchImpl })
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      `${API}/rooms/badadib-live/boost/summary`,
      `${API}/boosts/ledger?room=badadib-live`,
    ])
    expect(out).toEqual({ source: 'ledger', count: 1, total: 4, goal: null, top: [] })
  })

  it('goes straight to the ledger once it is known to be an old server', async () => {
    const fetchImpl = vi.fn(async () => res(200, []))
    await fetchBoostTotals(API, 'badadib-live', { legacy: true, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toContain('/boosts/ledger')
  })

  it('gives null on a server error, so the dock keeps its last numbers', async () => {
    const fetchImpl = vi.fn(async () => res(502, null))
    expect(await fetchBoostTotals(API, 'badadib-live', { fetchImpl })).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
