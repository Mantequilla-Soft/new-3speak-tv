// Granting and revoking @threespeak on a user's posting authority, which lets
// the scheduled-posts cron publish for them (src/utils/postingAuthority.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  broadcastWithAioha: vi.fn(),
  provider: 'keychain',
}))

vi.mock('@hiveio/dhive', () => ({
  Client: class { constructor() { this.database = { getAccounts: h.getAccounts } } },
}))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))
vi.mock('../../../src/hive-api/aioha', () => ({
  broadcastWithAioha: h.broadcastWithAioha,
  KeyTypes: { Active: 'active', Posting: 'posting' },
  Providers: { HiveSigner: 'hivesigner', Keychain: 'keychain' },
  getCurrentProvider: () => h.provider,
}))
vi.mock('../../../src/hive-api/api', () => ({
  sortAuths: (auths) => [...auths].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
}))
vi.mock('@aioha/aioha/build/lib/hive-uri.js', () => ({ encodeOps: () => 'hive://sign/ops/x' }))

import {
  hasThreespeakPostingAuth,
  addThreespeakToPostingAuth,
  removeThreespeakFromPostingAuth,
  waitForThreespeakPostingAuth,
} from '../../../src/utils/postingAuthority.js'

const account = (accountAuths, keyAuths = [['STMkey', 1]], threshold = 1) => ({
  name: 'alice',
  json_metadata: '{"a":1}',
  posting_json_metadata: '{"p":1}',
  posting: { weight_threshold: threshold, account_auths: accountAuths, key_auths: keyAuths },
})

beforeEach(() => {
  h.getAccounts.mockReset()
  h.broadcastWithAioha.mockReset()
  h.provider = 'keychain'
})

describe('hasThreespeakPostingAuth', () => {
  it('is false without a username and never asks the chain', async () => {
    expect(await hasThreespeakPostingAuth('')).toBe(false)
    expect(h.getAccounts).not.toHaveBeenCalled()
  })

  it('looks for threespeak in posting account_auths', async () => {
    h.getAccounts.mockResolvedValueOnce([account([['peakd.app', 1], ['threespeak', 1]])])
    expect(await hasThreespeakPostingAuth('alice')).toBe(true)
    h.getAccounts.mockResolvedValueOnce([account([['threespeak.app', 1]])])
    expect(await hasThreespeakPostingAuth('alice')).toBe(false)
    h.getAccounts.mockResolvedValueOnce([{ name: 'alice' }])
    expect(await hasThreespeakPostingAuth('alice')).toBe(false)
  })

  it('throws for an account that does not exist', async () => {
    h.getAccounts.mockResolvedValue([])
    await expect(hasThreespeakPostingAuth('ghost')).rejects.toThrow(/not found/)
  })
})

describe('addThreespeakToPostingAuth', () => {
  it('does not open a wallet when threespeak is already authorized', async () => {
    h.getAccounts.mockResolvedValue([account([['threespeak', 1]])])
    expect(await addThreespeakToPostingAuth('alice')).toEqual({ alreadyAuthorized: true })
    expect(h.broadcastWithAioha).not.toHaveBeenCalled()
  })

  it('broadcasts an active-key account_update2 that keeps everything else and sorts the auths', async () => {
    h.getAccounts.mockResolvedValue([account([['zzz.app', 1], ['travelfeed.app', 1]], [['STMkey', 1]], 1)])
    h.broadcastWithAioha.mockResolvedValue({ success: true, result: 'tx123' })
    expect(await addThreespeakToPostingAuth('alice')).toEqual({ alreadyAuthorized: false, tx: 'tx123' })

    const [ops, keyType] = h.broadcastWithAioha.mock.calls[0]
    expect(keyType).toBe('active')
    expect(ops).toEqual([[
      'account_update2',
      {
        account: 'alice',
        posting: {
          weight_threshold: 1,
          account_auths: [['threespeak', 1], ['travelfeed.app', 1], ['zzz.app', 1]],
          key_auths: [['STMkey', 1]],
        },
        json_metadata: '{"a":1}',
        posting_json_metadata: '{"p":1}',
        extensions: [],
      },
    ]])
  })

  it('uses the requested weight', async () => {
    h.getAccounts.mockResolvedValue([account([])])
    h.broadcastWithAioha.mockResolvedValue({ success: true, result: 't' })
    await addThreespeakToPostingAuth('alice', { weight: 3 })
    expect(h.broadcastWithAioha.mock.calls[0][0][0][1].posting.account_auths).toEqual([['threespeak', 3]])
  })

  it('surfaces the wallet error when the broadcast fails', async () => {
    h.getAccounts.mockResolvedValue([account([])])
    h.broadcastWithAioha.mockResolvedValueOnce({ success: false, error: 'user rejected' })
    await expect(addThreespeakToPostingAuth('alice')).rejects.toThrow('user rejected')
    h.broadcastWithAioha.mockResolvedValueOnce({ success: false, error: { message: 'Missing active authority' } })
    await expect(addThreespeakToPostingAuth('alice')).rejects.toThrow('Missing active authority')
    h.broadcastWithAioha.mockResolvedValueOnce(null)
    await expect(addThreespeakToPostingAuth('alice')).rejects.toThrow('Failed to update posting authority')
  })
})

describe('removeThreespeakFromPostingAuth', () => {
  it('reports notAuthorized when threespeak is not there', async () => {
    h.getAccounts.mockResolvedValue([account([['peakd.app', 1]])])
    expect(await removeThreespeakFromPostingAuth('alice')).toEqual({ notAuthorized: true })
    expect(h.broadcastWithAioha).not.toHaveBeenCalled()
  })

  it('removes only threespeak and keeps the rest', async () => {
    h.getAccounts.mockResolvedValue([account([['peakd.app', 1], ['threespeak', 1]])])
    h.broadcastWithAioha.mockResolvedValue({ success: true, result: 'tx9' })
    expect(await removeThreespeakFromPostingAuth('alice')).toEqual({ notAuthorized: false, tx: 'tx9' })
    const posting = h.broadcastWithAioha.mock.calls[0][0][0][1].posting
    expect(posting.account_auths).toEqual([['peakd.app', 1]])
    expect(posting.key_auths).toEqual([['STMkey', 1]])
  })

  it('refuses when threespeak alone meets the threshold', async () => {
    h.getAccounts.mockResolvedValue([account([['threespeak', 2]], [['STMkey', 1]], 2)])
    await expect(removeThreespeakFromPostingAuth('alice')).rejects.toThrow(/unable to sign/)
    expect(h.broadcastWithAioha).not.toHaveBeenCalled()
  })
})

describe('waitForThreespeakPostingAuth', () => {
  it('re-reads until the chain shows the expected state', async () => {
    h.getAccounts
      .mockResolvedValueOnce([account([])])
      .mockRejectedValueOnce(new Error('node hiccup'))
      .mockResolvedValueOnce([account([['threespeak', 1]])])
    expect(await waitForThreespeakPostingAuth('alice', true, { timeoutMs: 1000, intervalMs: 1 })).toBe(true)
    expect(h.getAccounts).toHaveBeenCalledTimes(3)
  })

  it('gives up at the deadline and returns the last state read', async () => {
    h.getAccounts.mockResolvedValue([account([])])
    expect(await waitForThreespeakPostingAuth('alice', true, { timeoutMs: 0, intervalMs: 1 })).toBe(false)
  })
})
