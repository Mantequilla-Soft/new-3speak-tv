// Wallet operations beyond sending (src/lib/walletOps.js): every builder's exact
// payload, the HP/VESTS maths and the account readers. Nothing is broadcast.
import { describe, it, expect, vi } from 'vitest'
import {
  asset, powerUpOp, powerDownOp, cancelPowerDownOp, toSavingsOp, fromSavingsOp, cancelSavingsWithdrawOp,
  convertOp, collateralizedConvertOp, delegateOp, removeDelegationOp, newRequestId, hpToVests, vestsToHp,
  hivePerVests, powerDownOf, freeVests, conversionsOf, savingsWithdrawalsOf, delegationsOf, collateralizedEstimate,
  convertEstimate, loadWalletState, delegatableVests, vestsWithHp,
} from '../../../src/lib/walletOps.js'

// 1 VESTS = 0.0005 HIVE, so 1000 HP = 2,000,000 VESTS.
const dgp = { total_vesting_fund_hive: '1000.000 HIVE', total_vesting_shares: '2000000.000000 VESTS', hbd_interest_rate: 1500 }

describe('asset', () => {
  it('rounds down to the precision of the coin', () => {
    expect(asset(1.23456, 'HIVE')).toBe('1.234 HIVE')
    expect(asset('2', 'HBD')).toBe('2.000 HBD')
    expect(asset(0.1 + 0.2, 'HBD')).toBe('0.300 HBD')
    expect(asset(12.3456789, 'VESTS')).toBe('12.345678 VESTS')
    expect(asset(0, 'VESTS')).toBe('0.000000 VESTS')
  })
  it('refuses a negative or broken amount', () => {
    expect(() => asset(-1, 'HIVE')).toThrow('bad_amount')
    expect(() => asset('x', 'HIVE')).toThrow('bad_amount')
  })
})

describe('the builders', () => {
  it('power up for yourself and for someone else', () => {
    expect(powerUpOp({ from: 'badadib', amount: 5 })).toEqual(['transfer_to_vesting', { from: 'badadib', to: 'badadib', amount: '5.000 HIVE' }])
    expect(powerUpOp({ from: 'badadib', to: 'fan', amount: '1.5' })).toEqual(['transfer_to_vesting', { from: 'badadib', to: 'fan', amount: '1.500 HIVE' }])
  })
  it('power down in VESTS, and 0 stops it', () => {
    expect(powerDownOp({ account: 'badadib', vests: 2000.1234567 })).toEqual(['withdraw_vesting', { account: 'badadib', vesting_shares: '2000.123456 VESTS' }])
    expect(cancelPowerDownOp({ account: 'badadib' })).toEqual(['withdraw_vesting', { account: 'badadib', vesting_shares: '0.000000 VESTS' }])
  })
  it('savings in, out and cancel', () => {
    expect(toSavingsOp({ from: 'badadib', amount: 10, currency: 'HBD' })).toEqual(['transfer_to_savings', { from: 'badadib', to: 'badadib', amount: '10.000 HBD', memo: '' }])
    expect(fromSavingsOp({ from: 'badadib', amount: 2, currency: 'HIVE', requestId: 1700000000 }))
      .toEqual(['transfer_from_savings', { from: 'badadib', request_id: 1700000000, to: 'badadib', amount: '2.000 HIVE', memo: '' }])
    expect(cancelSavingsWithdrawOp({ from: 'badadib', requestId: 7 })).toEqual(['cancel_transfer_from_savings', { from: 'badadib', request_id: 7 }])
    expect(() => toSavingsOp({ from: 'badadib', amount: 1, currency: 'HP' })).toThrow('bad_currency')
  })
  it('both conversions', () => {
    expect(convertOp({ owner: 'badadib', amount: 3, requestId: 42 })).toEqual(['convert', { owner: 'badadib', requestid: 42, amount: '3.000 HBD' }])
    expect(collateralizedConvertOp({ owner: 'badadib', amount: 8.8888, requestId: 43 })).toEqual(['collateralized_convert', { owner: 'badadib', requestid: 43, amount: '8.888 HIVE' }])
  })
  it('delegation set and removed', () => {
    expect(delegateOp({ delegator: 'badadib', delegatee: 'fan', vests: hpToVests(10, dgp) }))
      .toEqual(['delegate_vesting_shares', { delegator: 'badadib', delegatee: 'fan', vesting_shares: '20000.000000 VESTS' }])
    expect(removeDelegationOp({ delegator: 'badadib', delegatee: 'fan' }))
      .toEqual(['delegate_vesting_shares', { delegator: 'badadib', delegatee: 'fan', vesting_shares: '0.000000 VESTS' }])
  })
})

describe('request ids', () => {
  it('seconds since 1970, counting up past ids in use', () => {
    const now = 1_763_200_000_000
    expect(newRequestId([], now)).toBe(1_763_200_000)
    expect(newRequestId([1_763_200_000, 1_763_200_001], now)).toBe(1_763_200_002)
  })
})

describe('HP and VESTS', () => {
  it('converts both ways with the chain rate', () => {
    expect(hivePerVests(dgp)).toBe(0.0005)
    expect(vestsToHp(2_000_000, dgp)).toBe(1000)
    expect(hpToVests(1000, dgp)).toBe(2_000_000)
    expect(hpToVests(1, {})).toBe(0)
  })
  it('free VESTS leave out what is delegated', () => {
    expect(freeVests({ vesting_shares: '5000.000000 VESTS', delegated_vesting_shares: '1200.000000 VESTS' })).toBe(3800)
  })
  it('delegatable VESTS also leave out what a running power down still pays out (raw VESTS, 6 decimals)', () => {
    const acct = { vesting_shares: '5000.000000 VESTS', delegated_vesting_shares: '1200.000000 VESTS', to_withdraw: 2_600_000_000, withdrawn: 400_000_000 }
    expect(delegatableVests(acct)).toBe(1600)
    expect(delegatableVests({ ...acct, to_withdraw: 0, withdrawn: 0 })).toBe(3800)
    expect(delegatableVests({ ...acct, to_withdraw: 9_000_000_000 })).toBe(0)
    expect(delegatableVests(null)).toBe(0)
  })
  it('shows VESTS with their HP for the signing summary', () => {
    expect(vestsWithHp('26000.000000 VESTS', hivePerVests(dgp))).toBe('13.000 HP (26000.000000 VESTS)')
    expect(vestsWithHp('26000.000000 VESTS', 0)).toBe('26000.000000 VESTS')
    expect(vestsWithHp('1.000 HIVE', 0.0005)).toBe('1.000 HIVE')
  })
})

describe('reading the account', () => {
  it('a running power down', () => {
    const pd = powerDownOf({
      vesting_withdraw_rate: '200000.000000 VESTS', next_vesting_withdrawal: '2026-11-21T00:21:42',
      to_withdraw: 2_600_000_000_000, withdrawn: 400_000_000_000,
    }, dgp)
    expect(pd.weeklyHp).toBe(100)
    expect(pd.leftHp).toBe(1100)
    expect(pd.weeksLeft).toBe(11)
    expect(pd.next.toISOString()).toBe('2026-11-21T00:21:42.000Z')
  })
  it('no power down when the rate is zero', () => {
    expect(powerDownOf({ vesting_withdraw_rate: '0.000000 VESTS', next_vesting_withdrawal: '1969-12-31T23:59:59', to_withdraw: 0, withdrawn: 0 }, dgp)).toBeNull()
  })
  it('withdrawals, conversions and delegations', () => {
    expect(savingsWithdrawalsOf([{ id: 1, from: 'badadib', to: 'badadib', memo: '', request_id: 9, amount: '1.000 HBD', complete: '2026-11-18T10:00:00' }]))
      .toEqual([{ requestId: 9, to: 'badadib', amount: 1, symbol: 'HBD', complete: new Date('2026-11-18T10:00:00Z') }])
    const conv = conversionsOf(
      [{ id: 2, owner: 'badadib', requestid: 5, amount: '2.000 HBD', conversion_date: '2026-11-19T00:00:00' }],
      [{ id: 3, owner: 'badadib', requestid: 6, collateral_amount: '10.000 HIVE', converted_amount: '2.300 HBD', conversion_date: '2026-11-18T00:00:00' }],
    )
    expect(conv.map((c) => [c.kind, c.requestId, c.amount, c.symbol])).toEqual([['hive', 6, 10, 'HIVE'], ['hbd', 5, 2, 'HBD']])
    expect(conv[0].hbd).toBe(2.3)
    expect(delegationsOf([{ delegator: 'badadib', delegatee: 'fan', vesting_shares: '20000.000000 VESTS', min_delegation_time: '2026-01-01T00:00:00' }], dgp))
      .toEqual([{ delegatee: 'fan', vests: 20000, hp: 10, since: new Date('2026-01-01T00:00:00Z') }])
  })
})

describe('estimates', () => {
  it('HIVE to HBD pays half the HIVE at the median, minus 5%', () => {
    expect(collateralizedEstimate(10, 0.25)).toBeCloseTo(1.1875, 6)
  })
  it('HBD to HIVE at the median', () => {
    expect(convertEstimate(1, 0.25)).toBe(4)
    expect(convertEstimate(1, 0)).toBe(0)
  })
})

describe('loadWalletState', () => {
  it('reads everything in one round and survives a failing side call', async () => {
    const call = vi.fn(async (api, method) => {
      if (method === 'get_accounts') return [{ balance: '3.000 HIVE', hbd_balance: '1.000 HBD', savings_balance: '0.000 HIVE', savings_hbd_balance: '4.000 HBD', vesting_shares: '20000.000000 VESTS', delegated_vesting_shares: '2000.000000 VESTS', received_vesting_shares: '0.000000 VESTS', vesting_withdraw_rate: '0.000000 VESTS', next_vesting_withdrawal: '1969-12-31T23:59:59', to_withdraw: 0, withdrawn: 0 }]
      if (method === 'get_dynamic_global_properties') return dgp
      if (method === 'get_current_median_history_price') return { base: '0.250 HBD', quote: '1.000 HIVE' }
      if (method === 'get_vesting_delegations') throw new Error('node down')
      return []
    })
    const s = await loadWalletState(call, 'badadib')
    expect(call).toHaveBeenCalledWith('condenser_api', 'get_vesting_delegations', ['badadib', '', 100])
    expect(s.hbdPerHive).toBe(0.25)
    expect(s.hp).toBe(10)
    expect(s.freeHp).toBe(9)
    expect(s.delegatableVests).toBe(18000)
    expect(s.delegatableHp).toBe(9)
    expect(s.savingsHbd).toBe(4)
    expect(s.delegations).toEqual([])
    expect(s.powerDown).toBeNull()
  })
})
