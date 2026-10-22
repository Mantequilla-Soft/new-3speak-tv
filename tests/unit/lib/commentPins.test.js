// An author pinning comments on their own video: @threespeak signs when it can,
// a capable wallet signs locally otherwise, then the checker stores the pin
// (src/lib/commentPins.js).
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

import { setCommentPinned } from '../../../src/lib/commentPins.js'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const args = { author: 'alice', permlink: 'vid', comment: 'bob/re-vid', pinned: true }

let fetchMock
beforeEach(() => {
  h.provider = 'keychain'
  h.mante = false
  h.signMessageWithAioha.mockReset()
  h.establishWalletSession.mockReset()
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('setCommentPinned', () => {
  it('gets a @threespeak signature, then stores the pin with it', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 'sig', timestamp: 111, username: 'alice' }))
      .mockResolvedValueOnce(json(200, { success: true, pinned_comments: ['bob/re-vid'] }))
    expect(await setCommentPinned(args)).toEqual(['bob/re-vid'])

    const [sigUrl, sigOpts] = fetchMock.mock.calls[0]
    expect(sigUrl).toBe('/api/comments/pin-signature')
    expect(sigOpts.credentials).toBe('include')
    expect(JSON.parse(sigOpts.body)).toEqual({ permlink: 'vid', comment: 'bob/re-vid', pinned: true, username: 'alice' })

    const [pinUrl, pinOpts] = fetchMock.mock.calls[1]
    expect(pinUrl).toBe('https://checker.3speak.tv/comments/pin')
    expect(JSON.parse(pinOpts.body)).toEqual({ ...args, signature: 'sig', timestamp: 111 })
  })

  it('sends the HiveSigner token as a bearer header', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'tok')
    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(json(200, { success: true, pinned_comments: [] }))
    await setCommentPinned(args)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('a wallet without a session for this account logs in once and retries', async () => {
    h.establishWalletSession.mockResolvedValue(true)
    fetchMock
      .mockResolvedValueOnce(json(401, { reason: 'not_signed_in_as' }))
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 2 }))
      .mockResolvedValueOnce(json(200, { success: true, pinned_comments: ['x'] }))
    expect(await setCommentPinned(args)).toEqual(['x'])
    expect(h.establishWalletSession).toHaveBeenCalledWith('alice')
  })

  it('falls back to signing in a capable wallet when @threespeak cannot sign', async () => {
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'walletsig' })
    fetchMock
      .mockResolvedValueOnce(json(403, { error: 'no grant' }))
      .mockResolvedValueOnce(json(200, { success: true, pinned_comments: [] }))
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    await setCommentPinned({ ...args, pinned: false })
    vi.useRealTimers()
    const [message, keyType] = h.signMessageWithAioha.mock.calls[0]
    expect(message).toBe('3speak-comments|unpin|alice|vid|bob/re-vid|1700000000000')
    expect(keyType).toBe('posting')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ signature: 'walletsig', timestamp: 1700000000000 })
  })

  it('never uses a signature made for a different account', async () => {
    h.provider = 'hivesigner'
    fetchMock.mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1, username: 'mallory' }))
    await expect(setCommentPinned(args)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HiveSigner and Butter Auth have no local fallback: the server error surfaces', async () => {
    h.provider = 'hivesigner'
    fetchMock.mockResolvedValueOnce(json(403, { error: 'grant @threespeak first' }))
    await expect(setCommentPinned(args)).rejects.toThrow('grant @threespeak first')
    h.provider = 'keychain'
    h.mante = true
    fetchMock.mockResolvedValueOnce(json(403, { error: 'no grant' }))
    await expect(setCommentPinned(args)).rejects.toThrow('no grant')
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('a rejected wallet signature or checker refusal throws', async () => {
    h.signMessageWithAioha.mockResolvedValue({ success: false })
    fetchMock.mockResolvedValueOnce(json(403, {}))
    await expect(setCommentPinned(args)).rejects.toThrow()

    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(json(400, { error: 'too many pins' }))
    await expect(setCommentPinned(args)).rejects.toThrow('too many pins')
  })

  it('returns [] when the checker answers without a list', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(json(200, { success: true }))
    expect(await setCommentPinned(args)).toEqual([])
  })
})
