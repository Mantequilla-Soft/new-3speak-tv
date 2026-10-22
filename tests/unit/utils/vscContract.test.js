// Calls to the Magi/VSC subscription contract: the custom_json shape, transfer
// intents, the deposit op, polling for the result and parsing getter replies
// (src/utils/vscContract.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  aioha: { getCurrentUser: vi.fn(), signAndBroadcastTx: vi.fn(), vscSetNetId: vi.fn(), vscCallContract: vi.fn() },
  broadcastWithAioha: vi.fn(),
  post: vi.fn(),
}))
vi.mock('../../../src/hive-api/aioha', () => ({ default: h.aioha, broadcastWithAioha: h.broadcastWithAioha }))
vi.mock('@aioha/aioha', () => ({ KeyTypes: { Active: 'active', Posting: 'posting' } }))
vi.mock('axios', () => ({ default: { post: h.post } }))

let mod
beforeEach(async () => {
  vi.resetModules()
  Object.values(h.aioha).forEach((f) => f.mockReset())
  h.broadcastWithAioha.mockReset()
  h.post.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  mod = await import('../../../src/utils/vscContract.js')
})
afterEach(() => vi.useRealTimers())

describe('network config', () => {
  it('defaults to mainnet and the current offers', () => {
    expect(mod.IS_VSC_TESTNET).toBe(false)
    expect(mod.VSC_NET_ID).toBe('vsc-mainnet')
    expect(mod.SUB_OFFER_ID).toBe(5)
    expect(mod.ONETIME_OFFER_ID).toBe(4)
  })

  it('switches net id and offer ids from env', async () => {
    vi.stubEnv('VITE_VSC_NETWORK', 'testnet')
    vi.stubEnv('VITE_VSC_SUB_OFFER_ID', '9')
    vi.resetModules()
    const t = await import('../../../src/utils/vscContract.js')
    expect(t.VSC_NET_ID).toBe('vsc-testnet')
    expect(t.SUB_OFFER_ID).toBe(9)
  })
})

describe('buildTransferIntent', () => {
  it('formats numbers to 3 decimals and lowercases the token', () => {
    expect(mod.buildTransferIntent(5, 'HBD')).toEqual({ type: 'transfer.allow', args: { limit: '5.000', token: 'hbd' } })
    expect(mod.buildTransferIntent(1.23456)).toEqual({ type: 'transfer.allow', args: { limit: '1.235', token: 'hive' } })
    expect(mod.buildTransferIntent('2.500', 'hive').args.limit).toBe('2.500')
  })
})

describe('buildDepositOp', () => {
  it('transfers to vsc.gateway with a to=<user> memo', () => {
    expect(mod.buildDepositOp('5.000', 'hbd', 'alice')).toEqual(['transfer', {
      from: 'alice', to: 'vsc.gateway', amount: '5.000 HBD', memo: 'to=alice',
    }])
  })

  it('uses TESTS/TBD on testnet', async () => {
    vi.stubEnv('VITE_VSC_NETWORK', 'testnet')
    vi.resetModules()
    const t = await import('../../../src/utils/vscContract.js')
    expect(t.buildDepositOp('1.000', 'hive', 'a')[1].amount).toBe('1.000 TESTS')
    expect(t.buildDepositOp('1.000', 'HBD', 'a')[1].amount).toBe('1.000 TBD')
  })
})

describe('callSubsContract', () => {
  it('refuses when nobody is logged in', async () => {
    h.aioha.getCurrentUser.mockReturnValue(null)
    await expect(mod.callSubsContract('pay_offer', 'x')).rejects.toThrow('Not logged in')
  })

  it('signs a vsc.call custom_json with the active key by default', async () => {
    h.aioha.getCurrentUser.mockReturnValue('alice')
    h.aioha.signAndBroadcastTx.mockResolvedValue({ success: true, result: 'tx1' })
    const intent = mod.buildTransferIntent(5, 'hbd')
    expect(await mod.callSubsContract('pay_offer', '5|monthly', [intent])).toEqual({ success: true, result: 'tx1' })
    const [[op], key] = h.aioha.signAndBroadcastTx.mock.calls[0]
    expect(key).toBe('active')
    expect(op[0]).toBe('custom_json')
    expect(op[1]).toMatchObject({ required_auths: ['alice'], required_posting_auths: [], id: 'vsc.call' })
    expect(JSON.parse(op[1].json)).toEqual({
      net_id: 'vsc-mainnet',
      contract_id: mod.SUBS_CONTRACT_ID,
      action: 'pay_offer',
      payload: '5|monthly',
      rc_limit: 10000,
      intents: [intent],
    })
  })

  it('puts the user in posting auths for a posting-key call', async () => {
    h.aioha.getCurrentUser.mockReturnValue('alice')
    h.aioha.signAndBroadcastTx.mockResolvedValue({ success: true })
    await mod.callSubsContract('cancel', '', [], 'posting')
    const op = h.aioha.signAndBroadcastTx.mock.calls[0][0][0]
    expect(op[1]).toMatchObject({ required_auths: [], required_posting_auths: ['alice'] })
  })

  it('throws the wallet error on failure', async () => {
    h.aioha.getCurrentUser.mockReturnValue('alice')
    h.aioha.signAndBroadcastTx.mockResolvedValue({ success: false, error: 'rejected' })
    await expect(mod.callSubsContract('x', '')).rejects.toThrow('rejected')
  })
})

describe('depositAndCallContract', () => {
  it('bundles the deposit and the contract call in one active-key transaction', async () => {
    h.broadcastWithAioha.mockResolvedValue({ success: true, result: 'tx' })
    await mod.depositAndCallContract('5.000', 'hbd', 'alice', 'pay_offer', '5', [])
    const [ops, key] = h.broadcastWithAioha.mock.calls[0]
    expect(key).toBe('active')
    expect(ops[0]).toEqual(mod.buildDepositOp('5.000', 'hbd', 'alice'))
    expect(ops[1][1]).toMatchObject({ id: 'vsc.call', required_auths: ['alice'] })
  })

  it('throws when the broadcast fails', async () => {
    h.broadcastWithAioha.mockResolvedValue({ success: false })
    await expect(mod.depositAndCallContract('1', 'hive', 'a', 'x', '')).rejects.toThrow('Broadcast failed')
  })
})

describe('pollTxStatus', () => {
  const out = (ok, ret) => ({ data: { data: { findContractOutput: [{ id: 'o', results: [{ ok, ret }] }] } } })

  it('queries by input tx id and reports success', async () => {
    h.post.mockResolvedValue(out(true, 'done'))
    expect(await mod.pollTxStatus('tx1')).toEqual({ status: 'success', result: 'done' })
    const [url, body] = h.post.mock.calls[0]
    expect(url).toBe('https://api.okinoko.io/api/v1/graphql')
    expect(body.variables).toEqual({ filterOptions: { byInput: 'tx1' } })
  })

  it('accepts ok as true, "true" or 1, and anything else is an error', async () => {
    for (const ok of [true, 'true', 1]) {
      h.post.mockResolvedValueOnce(out(ok, 'r'))
      expect((await mod.pollTxStatus('t')).status).toBe('success')
    }
    h.post.mockResolvedValueOnce(out(false, 'insufficient funds'))
    expect(await mod.pollTxStatus('t')).toEqual({ status: 'error', result: 'insufficient funds' })
  })

  it('keeps polling every 5 seconds through empty answers and errors, with progress', async () => {
    vi.useFakeTimers()
    h.post
      .mockResolvedValueOnce({ data: { data: { findContractOutput: [] } } })
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(out(true, 'ok'))
    const progress = vi.fn()
    const p = mod.pollTxStatus('t', 60000, progress)
    await vi.advanceTimersByTimeAsync(10000)
    expect(await p).toEqual({ status: 'success', result: 'ok' })
    expect(progress.mock.calls.map((c) => c[0].attempt)).toEqual([1, 2, 3])
  })

  it('times out', async () => {
    vi.useFakeTimers()
    h.post.mockResolvedValue({ data: {} })
    const p = mod.pollTxStatus('t', 12000)
    await vi.advanceTimersByTimeAsync(20000)
    expect(await p).toEqual({ status: 'timeout', result: null })
  })
})

describe('querySubsContract', () => {
  it('calls the getter with the posting key and returns the polled result', async () => {
    h.aioha.vscCallContract.mockResolvedValue({ success: true, result: 'tx' })
    h.post.mockResolvedValue({ data: { data: { findContractOutput: [{ results: [{ ok: true, ret: 'id:1' }] }] } } })
    expect(await mod.querySubsContract('get_offer', '5')).toBe('id:1')
    expect(h.aioha.vscSetNetId).toHaveBeenCalledWith('vsc-mainnet')
    expect(h.aioha.vscCallContract).toHaveBeenCalledWith(mod.SUBS_CONTRACT_ID, 'get_offer', '5', 10000, [], 'posting')
  })

  it('throws the contract error', async () => {
    h.aioha.vscCallContract.mockResolvedValueOnce({ success: false, error: 'nope' })
    await expect(mod.querySubsContract('x', '')).rejects.toThrow('nope')
    h.aioha.vscCallContract.mockResolvedValueOnce({ success: true, result: 'tx' })
    h.post.mockResolvedValue({ data: { data: { findContractOutput: [{ results: [{ ok: false, ret: 'no such offer' }] }] } } })
    await expect(mod.querySubsContract('x', '')).rejects.toThrow('no such offer')
  })
})

describe('parseContractResponse', () => {
  it('splits key:value pairs on | and keeps colons inside values', () => {
    expect(mod.parseContractResponse('id:1|provider:hive:creator|name:Pro Plan')).toEqual({ id: '1', provider: 'hive:creator', name: 'Pro Plan' })
  })

  it('skips parts without a colon and returns {} for non-strings', () => {
    expect(mod.parseContractResponse('a:1|junk|b:')).toEqual({ a: '1', b: '' })
    expect(mod.parseContractResponse(null)).toEqual({})
    expect(mod.parseContractResponse(42)).toEqual({})
  })
})

describe('queryHasura and getVscBalance', () => {
  it('throws the first GraphQL error', async () => {
    h.post.mockResolvedValue({ data: { errors: [{ message: 'field missing' }] } })
    await expect(mod.queryHasura('{ x }')).rejects.toThrow('field missing')
  })

  it('returns data on success', async () => {
    h.post.mockResolvedValue({ data: { data: { x: 1 } } })
    expect(await mod.queryHasura('{ x }', { a: 1 })).toEqual({ x: 1 })
    expect(h.post).toHaveBeenCalledWith('https://api.okinoko.io/hasura/v1/graphql', { query: '{ x }', variables: { a: 1 } })
  })

  it('converts milliunit balances and treats missing ones as 0', async () => {
    h.post.mockResolvedValueOnce({ data: { data: { getAccountBalance: { hive: 12345, hbd: 500 } } } })
    expect(await mod.getVscBalance('alice')).toEqual({ hive: 12.345, hbd: 0.5 })
    expect(h.post.mock.calls[0][1].query).toContain('hive:alice')
    h.post.mockResolvedValueOnce({ data: { data: { getAccountBalance: null } } })
    expect(await mod.getVscBalance('alice')).toEqual({ hive: 0, hbd: 0 })
  })
})
