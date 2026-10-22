// A creator hiding a tip they received: signed by @threespeak or the creator's
// own wallet, then stored by the checker (src/lib/supportsHide.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  provider: 'keychain',
  mante: false,
  signMessageWithAioha: vi.fn(),
  establishWalletSession: vi.fn(),
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  signMessageWithAioha: h.signMessageWithAioha,
  getCurrentProvider: () => h.provider,
  isManteAuthLogin: () => h.mante,
  establishWalletSession: h.establishWalletSession,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))

import { setSupportHidden } from '../../../src/lib/supportsHide.js'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

let fetchMock
beforeEach(() => {
  h.provider = 'keychain'
  h.mante = false
  h.signMessageWithAioha.mockReset()
  h.establishWalletSession.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('setSupportHidden', () => {
  it('signs through @threespeak and returns the new hidden state', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 'sig', timestamp: 5 }))
      .mockResolvedValueOnce(json(200, { success: true, hidden: true }))
    expect(await setSupportHidden({ author: 'alice', trxId: 'abc', hidden: true })).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/supports/hide-signature')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ trx_id: 'abc', hidden: true, username: 'alice' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://checker.3speak.tv/supports/hide')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ author: 'alice', trx_id: 'abc', hidden: true, signature: 'sig', timestamp: 5 })
  })

  it('unhiding resolves false', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(json(200, { success: true, hidden: false }))
    expect(await setSupportHidden({ author: 'alice', trxId: 'abc', hidden: false })).toBe(false)
  })

  it('signs the exact checker message in the wallet when @threespeak cannot', async () => {
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'w' })
    fetchMock
      .mockResolvedValueOnce(json(403, {}))
      .mockResolvedValueOnce(json(200, { success: true, hidden: true }))
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    await setSupportHidden({ author: 'alice', trxId: 'abc', hidden: true })
    vi.useRealTimers()
    expect(h.signMessageWithAioha.mock.calls[0][0]).toBe('3speak-supports|hide|alice|abc|1700000000000')
  })

  it('retries once after establishing a wallet session', async () => {
    h.establishWalletSession.mockResolvedValue(true)
    fetchMock
      .mockResolvedValueOnce(json(401, { reason: 'not_signed_in_as' }))
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(json(200, { success: true, hidden: true }))
    expect(await setSupportHidden({ author: 'alice', trxId: 't', hidden: true })).toBe(true)
  })

  it('refuses a signature issued for someone else and a checker failure', async () => {
    h.mante = true
    fetchMock.mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1, username: 'Mallory' }))
    await expect(setSupportHidden({ author: 'alice', trxId: 't', hidden: true })).rejects.toThrow()

    h.mante = false
    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1, username: 'ALICE' }))
      .mockResolvedValueOnce(json(500, { error: 'db down' }))
    await expect(setSupportHidden({ author: 'alice', trxId: 't', hidden: true })).rejects.toThrow('db down')
  })
})
