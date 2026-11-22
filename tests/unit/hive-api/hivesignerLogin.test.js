// The HiveSigner login hardening in src/hive-api/aioha.js. aioha's own HiveSigner
// provider revokes the token on logout BEFORE deleting it, in one try/catch, so a
// token HiveSigner already refuses stayed in localStorage; its login then took
// that leftover token as a fresh login the moment the HiveSigner window closed.
// "Log out and back in" could never get a user out of "session has expired".
// The provider here is a fake with the same behaviour; nothing reaches HiveSigner.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Providers } from './helpers/fakeAioha.js'

vi.mock('@aioha/aioha', async () => (await import('./helpers/fakeAioha.js')).aiohaModule)
vi.mock('../../../src/utils/config.js', () => ({ ENABLE_METAMASK_SNAP: false, EMBED_API_KEY: 'test-app-key' }))
vi.mock('../../../src/utils/vscContract.js', () => ({ IS_VSC_TESTNET: false, VSC_NET_ID: 'vsc-mainnet' }))
vi.mock('../../../src/utils/hiveNode.js', () => ({
  getHiveUrl: () => 'https://node.test',
  ensureHealthyNode: () => new Promise(() => {}),
}))

const { hardenHiveSignerLogin, forgetHiveSignerToken } = await import('../../../src/hive-api/aioha.js')

const KEYS = ['hivesignerToken', 'hivesignerExpiry', 'hivesignerUsername']
const stored = () => KEYS.map((k) => localStorage.getItem(k))
const store = (token, user, exp = '9999999999') => {
  localStorage.setItem('hivesignerToken', token)
  localStorage.setItem('hivesignerExpiry', exp)
  localStorage.setItem('hivesignerUsername', user)
}

// Same shape as aioha's HiveSigner provider. `callback` is what /hivesigner.html
// writes while the HiveSigner window is open (null: it never wrote anything).
function fakeProvider({ revokeFails = false, callback = null } = {}) {
  const hs = {
    username: undefined,
    provider: { accessToken: null, removeAccessToken: vi.fn(function () { this.accessToken = null }) },
    async logout() {
      try {
        if (revokeFails) throw { error: 'invalid_grant' }
        KEYS.forEach((k) => localStorage.removeItem(k))
        this.provider.removeAccessToken()
        delete this.username
      } catch { /* aioha swallows it */ }
    },
    async login() {
      if (callback) store(callback.token, callback.user)
      const token = localStorage.getItem('hivesignerToken')
      const user = localStorage.getItem('hivesignerUsername')
      if (token && user) {
        this.provider.accessToken = token
        this.username = user
        return { provider: Providers.HiveSigner, success: true, result: token, username: user }
      }
      return { success: false, error: 'Failed to obtain HiveSigner access token' }
    },
  }
  return hs
}
const clientWith = (hs) => ({ providers: { [Providers.HiveSigner]: hs } })

beforeEach(() => localStorage.clear())

describe('logging out of HiveSigner', () => {
  it('removes the stored token even when revoking it fails', async () => {
    const hs = fakeProvider({ revokeFails: true })
    hardenHiveSignerLogin(clientWith(hs))
    store('dead-token', 'alice')
    hs.provider.accessToken = 'dead-token'
    hs.username = 'alice'
    await hs.logout()
    expect(stored()).toEqual([null, null, null])
    expect(hs.provider.accessToken).toBeNull()
    expect(hs.username).toBeUndefined()
  })
})

describe('logging in with HiveSigner', () => {
  it('does not take a token left over from before as a fresh login', async () => {
    const hs = fakeProvider({ callback: null })
    hardenHiveSignerLogin(clientWith(hs))
    store('dead-token', 'alice')
    const res = await hs.login('alice', {})
    expect(res.success).toBe(false)
    expect(hs.provider.accessToken).toBeNull()
  })

  it('uses the token the callback page wrote during this login', async () => {
    const hs = fakeProvider({ callback: { token: 'fresh-token', user: 'alice' } })
    hardenHiveSignerLogin(clientWith(hs))
    store('dead-token', 'alice')
    const res = await hs.login('alice', {})
    expect(res).toMatchObject({ success: true, result: 'fresh-token', username: 'alice' })
    expect(localStorage.getItem('hivesignerToken')).toBe('fresh-token')
  })

  it('a login that does not complete leaves the current HiveSigner login as it was', async () => {
    const hs = fakeProvider({ callback: null })
    hardenHiveSignerLogin(clientWith(hs))
    store('alice-token', 'alice', '1234567890')
    await hs.login('bob', {})
    expect(stored()).toEqual(['alice-token', '1234567890', 'alice'])
  })

  it('the full loop: log out with a dead token, log back in, get a fresh token', async () => {
    let callback = null
    const hs = fakeProvider({ revokeFails: true })
    const plainLogin = hs.login
    hs.login = async function (...a) {
      if (callback) store(callback.token, callback.user)
      return plainLogin.apply(this, a)
    }
    hardenHiveSignerLogin(clientWith(hs))
    store('dead-token', 'alice')
    await hs.logout()
    callback = { token: 'fresh-token', user: 'alice' }
    const res = await hs.login('alice', {})
    expect(res.result).toBe('fresh-token')
  })
})

describe('setting it up', () => {
  it('patches a provider once, and does nothing without a HiveSigner provider', () => {
    const hs = fakeProvider()
    const client = clientWith(hs)
    hardenHiveSignerLogin(client)
    const patched = hs.logout
    hardenHiveSignerLogin(client)
    expect(hs.logout).toBe(patched)
    expect(() => hardenHiveSignerLogin({})).not.toThrow()
    expect(() => hardenHiveSignerLogin(undefined)).not.toThrow()
  })

  it('forgetHiveSignerToken clears all three keys', () => {
    store('t', 'alice')
    forgetHiveSignerToken()
    expect(stored()).toEqual([null, null, null])
  })
})
