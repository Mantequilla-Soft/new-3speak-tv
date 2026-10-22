// Whale / orca badges from effective vesting shares (own + received - delegated),
// fetched in batches of 10 (src/utils/whaleDetection.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

const post = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post } }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const acct = (name, own, received = 0, delegated = 0) => ({
  name,
  vesting_shares: `${own}.000000 VESTS`,
  received_vesting_shares: `${received}.000000 VESTS`,
  delegated_vesting_shares: `${delegated}.000000 VESTS`,
})

let mod
beforeEach(async () => {
  vi.resetModules()
  post.mockReset()
  mod = await import('../../../src/utils/whaleDetection.js')
})

async function renderHook(usernames) {
  const seen = []
  const Probe = () => { seen.push(mod.useWhaleDetection(usernames)); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => { root.render(createElement(Probe)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  root.unmount()
  return seen.at(-1)
}

describe('fetchAccountVests', () => {
  it('asks condenser_api.get_accounts and returns own + received - delegated', async () => {
    post.mockResolvedValue({ data: { result: [acct('alice', 1000, 500, 200)] } })
    expect(await mod.fetchAccountVests('alice')).toBe(1300)
    expect(post).toHaveBeenCalledWith('https://node.test', {
      jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['alice']], id: 1,
    })
  })

  it('is 0 for an unknown account', async () => {
    post.mockResolvedValue({ data: { result: [] } })
    expect(await mod.fetchAccountVests('ghost')).toBe(0)
  })
})

describe('useWhaleDetection', () => {
  it('tiers accounts at the whale and orca thresholds, counting delegations', async () => {
    const W = mod.WHALE_THRESHOLD
    const O = mod.ORCA_THRESHOLD
    post.mockResolvedValue({ data: { result: [
      acct('whale', W),
      acct('justunder', W - 1),
      acct('orca', O),
      acct('fish', O - 1),
      acct('lent', W, 0, W - O + 1),
      acct('borrowed', 0, O),
    ] } })
    const map = await renderHook(['whale', 'justunder', 'orca', 'fish', 'lent', 'borrowed', 'missing'])
    expect(map.get('whale').tier).toBe('whale')
    expect(map.get('justunder').tier).toBe('orca')
    expect(map.get('orca').tier).toBe('orca')
    expect(map.get('fish').tier).toBe(null)
    expect(map.get('lent').tier).toBe(null)
    expect(map.get('borrowed').tier).toBe('orca')
    expect(map.get('missing')).toEqual({ vests: 0, tier: null })
  })

  it('batches lookups in groups of 10 and skips empty names', async () => {
    post.mockResolvedValue({ data: { result: [] } })
    const names = Array.from({ length: 23 }, (_, i) => `u${i}`)
    await renderHook([...names, '', null])
    expect(post).toHaveBeenCalledTimes(3)
    expect(post.mock.calls.map((c) => c[1].params[0].length)).toEqual([10, 10, 3])
  })

  it('marks a failed batch as no tier instead of retrying forever', async () => {
    post.mockRejectedValue(new Error('down'))
    const map = await renderHook(['a', 'b'])
    expect(map.get('a')).toEqual({ vests: 0, tier: null })
    await renderHook(['a', 'b'])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('returns an empty map for no usernames', async () => {
    expect((await renderHook([])).size).toBe(0)
    expect(post).not.toHaveBeenCalled()
  })
})
