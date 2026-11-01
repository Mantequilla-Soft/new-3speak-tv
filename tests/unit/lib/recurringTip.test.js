// Monthly support through Hive's recurrent_transfer (src/lib/recurringTip.js).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/hive-api/hiveApi.js', () => ({ getRecurrentTransfers: vi.fn() }))

const { recurrentTransferOp, stopRecurrentTransferOp, findMonthlySupport, MONTH_CHOICES, MONTH_HOURS } = await import('../../../src/lib/recurringTip.js')
const { getRecurrentTransfers } = await import('../../../src/hive-api/hiveApi.js')

describe('recurrentTransferOp', () => {
  it('builds a 30-day op with three decimals', () => {
    expect(recurrentTransferOp({ from: 'a', to: 'badadib', amount: '2.5', currency: 'HBD', memo: 'm', months: 12 }))
      .toEqual(['recurrent_transfer', { from: 'a', to: 'badadib', amount: '2.500 HBD', memo: 'm', recurrence: 720, executions: 12, extensions: [] }])
  })

  it('stays within the chain limits (>= 2 runs, whole run <= 730 days)', () => {
    for (const m of MONTH_CHOICES) {
      expect(m).toBeGreaterThanOrEqual(2)
      expect((m * MONTH_HOURS) / 24).toBeLessThanOrEqual(730)
    }
  })

  it('stops with amount 0 in the same currency', () => {
    const [, op] = stopRecurrentTransferOp({ from: 'a', to: 'badadib', currency: 'HIVE' })
    expect(op.amount).toBe('0.000 HIVE')
    expect(op.executions).toBeGreaterThanOrEqual(2)
  })
})

describe('findMonthlySupport', () => {
  it('finds the pair-0 transfer and dates its last payment', async () => {
    getRecurrentTransfers.mockResolvedValueOnce([
      { to: 'other', amount: '1.000 HBD', recurrence: 720, remaining_executions: 2, trigger_date: '2026-11-17T09:49:27', pair_id: 0 },
      { to: 'badadib', amount: '5.000 HBD', recurrence: 720, remaining_executions: 3, trigger_date: '2026-11-17T00:00:00', pair_id: 0 },
    ])
    const r = await findMonthlySupport('a', 'badadib')
    expect(r.amount).toBe('5.000 HBD')
    expect(r.currency).toBe('HBD')
    expect(r.until.toISOString()).toBe('2027-01-16T00:00:00.000Z')
  })

  it('is null when there is none', async () => {
    getRecurrentTransfers.mockResolvedValueOnce([])
    expect(await findMonthlySupport('a', 'badadib')).toBeNull()
  })
})
