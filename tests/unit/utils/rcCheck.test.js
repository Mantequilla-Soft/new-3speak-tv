// Resource Credit pre-flight before an upload: the live post-cost estimate,
// regeneration since the last manabar update and the ok / wait / never verdict
// (src/utils/rcCheck.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const client = vi.hoisted(() => ({
  call: vi.fn(),
  database: { getDynamicGlobalProperties: vi.fn() },
}))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => client }))

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const curve = { coeff_a: '1', coeff_b: '0', shift: 0 }
const names = ['resource_history_bytes', 'resource_state_bytes', 'resource_execution_time']

function chainParams() {
  client.call.mockImplementation(async (api, method) => {
    if (method === 'get_resource_params') {
      return { resource_params: Object.fromEntries(names.map((n) => [n, { price_curve_params: curve }])) }
    }
    if (method === 'get_resource_pool') {
      return { resource_pool: Object.fromEntries(names.map((n) => [n, { pool: '1000000' }])) }
    }
    throw new Error(`unexpected ${api}.${method}`)
  })
  // 144000.000000 VESTS -> rc_regen = 144000000000 / 144000 = 1,000,000
  client.database.getDynamicGlobalProperties.mockResolvedValue({ total_vesting_shares: '144000.000000 VESTS' })
}

function rcAccount({ max, mana, lastUpdate }) {
  return { rc_accounts: [{ max_rc: String(max), rc_manabar: { current_mana: String(mana), last_update_time: lastUpdate } }] }
}

let mod
beforeEach(async () => {
  vi.resetModules()
  client.call.mockReset()
  client.database.getDynamicGlobalProperties.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mod = await import('../../../src/utils/rcCheck.js')
})
afterEach(() => vi.useRealTimers())

describe('estimatePostRcCost', () => {
  it('prices a representative post on the chain cost curve with a 20% margin', async () => {
    chainParams()
    // (1000001*1500/1e6+1) + (1000001*200000/1e6+1) + (1000001*300000/1e6+1) = 501503; x1.2 rounded up
    expect(await mod.estimatePostRcCost()).toBe(601804)
  })

  it('caches the estimate for 10 minutes', async () => {
    chainParams()
    await mod.estimatePostRcCost()
    await mod.estimatePostRcCost()
    expect(client.database.getDynamicGlobalProperties).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    await mod.estimatePostRcCost()
    expect(client.database.getDynamicGlobalProperties).toHaveBeenCalledTimes(2)
  })

  it('falls back to 2.2B RC, well under the 4.88B new-account grant, when the chain read fails', async () => {
    client.call.mockRejectedValue(new Error('down'))
    client.database.getDynamicGlobalProperties.mockRejectedValue(new Error('down'))
    const cost = await mod.estimatePostRcCost()
    expect(cost).toBe(2.2e9)
    expect(cost).toBeLessThan(4.88e9)
  })

  it('VITE_POST_RC_COST pins the cost without asking the chain', async () => {
    vi.stubEnv('VITE_POST_RC_COST', '123456')
    vi.resetModules()
    const pinned = await import('../../../src/utils/rcCheck.js')
    expect(await pinned.estimatePostRcCost()).toBe(123456)
    expect(client.call).not.toHaveBeenCalled()
  })
})

describe('getRcStatus', () => {
  it('adds regeneration since the last update (full bar over 5 days)', async () => {
    const max = 432000 * 1000 // regen 1000 RC per second
    client.call.mockResolvedValue(rcAccount({ max, mana: 0, lastUpdate: NOW / 1000 - 3600 }))
    const s = await mod.getRcStatus('alice')
    expect(client.call).toHaveBeenCalledWith('rc_api', 'find_rc_accounts', { accounts: ['alice'] })
    expect(s.regenPerSecond).toBe(1000)
    expect(s.currentMana).toBe(3600 * 1000)
    expect(s.percentage).toBeCloseTo((3600 * 1000 / max) * 100)
  })

  it('never regenerates past the maximum', async () => {
    client.call.mockResolvedValue(rcAccount({ max: 1000, mana: 900, lastUpdate: NOW / 1000 - 86400 * 10 }))
    expect((await mod.getRcStatus('alice')).currentMana).toBe(1000)
  })

  it('a last_update in the future adds nothing', async () => {
    client.call.mockResolvedValue(rcAccount({ max: 1000, mana: 100, lastUpdate: NOW / 1000 + 600 }))
    expect((await mod.getRcStatus('alice')).currentMana).toBe(100)
  })

  it('reports 0% for an account with no max RC', async () => {
    client.call.mockResolvedValue(rcAccount({ max: 0, mana: 0, lastUpdate: NOW / 1000 }))
    expect((await mod.getRcStatus('alice')).percentage).toBe(0)
  })

  it('returns null for an unknown account or a failed read', async () => {
    client.call.mockResolvedValueOnce({ rc_accounts: [] })
    expect(await mod.getRcStatus('ghost')).toBeNull()
    client.call.mockRejectedValueOnce(new Error('down'))
    expect(await mod.getRcStatus('alice')).toBeNull()
  })
})

describe('checkPostingRc', () => {
  beforeEach(() => { vi.stubEnv('VITE_POST_RC_COST', '1000000') })
  async function fresh() {
    vi.resetModules()
    return import('../../../src/utils/rcCheck.js')
  }

  it('lets the upload through when there is enough RC now', async () => {
    const m = await fresh()
    client.call.mockResolvedValue(rcAccount({ max: 5e6, mana: 2e6, lastUpdate: NOW / 1000 }))
    expect(await m.checkPostingRc('alice')).toMatchObject({ ok: true, unknown: false, requiredRc: 1e6, secondsUntilEnough: 0, canEverAfford: true })
  })

  it('says how long to wait when RC will regenerate enough', async () => {
    const m = await fresh()
    const max = 432000 * 10 // 10 RC per second
    client.call.mockResolvedValue(rcAccount({ max, mana: 1e6 - 105, lastUpdate: NOW / 1000 }))
    const r = await m.checkPostingRc('alice')
    expect(r.ok).toBe(false)
    expect(r.canEverAfford).toBe(true)
    expect(r.secondsUntilEnough).toBe(11)
  })

  it('reports never-affordable when even a full bar is below the cost', async () => {
    const m = await fresh()
    client.call.mockResolvedValue(rcAccount({ max: 5e5, mana: 5e5, lastUpdate: NOW / 1000 }))
    const r = await m.checkPostingRc('alice')
    expect(r).toMatchObject({ ok: false, canEverAfford: false, secondsUntilEnough: Infinity })
  })

  it('fails open when the RC status cannot be read', async () => {
    const m = await fresh()
    client.call.mockRejectedValue(new Error('down'))
    expect(await m.checkPostingRc('alice')).toEqual({ ok: true, unknown: true, requiredRc: 1e6 })
  })
})

describe('formatDuration', () => {
  it('says "a moment" for zero, negative or non-finite input', () => {
    expect(mod.formatDuration(0)).toBe('a moment')
    expect(mod.formatDuration(-5)).toBe('a moment')
    expect(mod.formatDuration(Infinity)).toBe('a moment')
  })

  it('says "less than a minute" under 60 seconds', () => {
    expect(mod.formatDuration(59)).toBe('less than a minute')
  })

  it('lists hours and minutes, and drops minutes once days are shown', () => {
    expect(mod.formatDuration(2 * 3600 + 15 * 60)).toBe('2 hours 15 minutes')
    expect(mod.formatDuration(8 * 60)).toBe('8 minutes')
    expect(mod.formatDuration(86400 * 2 + 3600 * 3 + 600)).toBe('2 days 3 hours')
  })
})
