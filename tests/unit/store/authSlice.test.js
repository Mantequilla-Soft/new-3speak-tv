// The sign-in state (src/lib/slices/createAuthStore.js): restoring a session on
// load (a live wallet, an expired one, a warm-up handle), switching between saved
// accounts, graduating from warm-up to a Hive account, and logging out, which
// clears the server cookies and every local key but keeps the other saved accounts.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { create } from 'zustand'

const wallet = vi.hoisted(() => ({
  current: null,
  live: false,
  switchUser: vi.fn(() => true),
  logout: vi.fn(),
  removeOtherLogin: vi.fn(),
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  default: {
    getCurrentUser: () => wallet.current,
    switchUser: (...a) => wallet.switchUser(...a),
    logout: (...a) => wallet.logout(...a),
    removeOtherLogin: (...a) => wallet.removeOtherLogin(...a),
  },
  isLoggedIn: () => wallet.live,
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => toasts }))
vi.mock('../../../src/i18n', () => ({ t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }))
const backend = vi.hoisted(() => ({ checkAuthentication: vi.fn(), getUserDetails: vi.fn() }))
vi.mock('../../../src/utils/api', () => ({ api: { auth: backend } }))
vi.mock('../../../src/utils/config', () => ({ API_URL_FROM_WEST: 'https://west.test' }))
const axiosPost = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post: axiosPost } }))

const { createAuthUserSlice } = await import('../../../src/lib/slices/createAuthStore.js')

let store
let fetchMock
const state = () => store.getState()

beforeEach(() => {
  localStorage.clear()
  wallet.current = null
  wallet.live = false
  wallet.switchUser.mockReset().mockReturnValue(true)
  wallet.logout.mockReset()
  wallet.removeOtherLogin.mockReset()
  toasts.success.mockReset()
  fetchMock = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  store = create((...a) => createAuthUserSlice(...a))
})

describe('before the first check', () => {
  it('nobody is signed in and the check has not run', () => {
    expect(state()).toMatchObject({ authenticated: false, user: null, authChecked: false, sessionExpired: false })
  })
})

describe('restoring a session on load', () => {
  it('a live wallet session signs its account in and remembers it', () => {
    wallet.current = 'badadib'
    wallet.live = true
    state().initializeAuth()
    expect(state()).toMatchObject({ authenticated: true, user: 'badadib', incubationHandle: null, authChecked: true })
    expect(localStorage.getItem('user_id')).toBe('badadib')
  })

  it('a remembered account with a cookie login (no wallet) stays signed in', () => {
    localStorage.setItem('user_id', 'badadib')
    wallet.live = true
    state().initializeAuth()
    expect(state()).toMatchObject({ authenticated: true, user: 'badadib' })
  })

  it('a remembered account whose session expired is signed out and flagged for a re-login', () => {
    localStorage.setItem('user_id', 'badadib')
    localStorage.setItem('access_token', 'old')
    state().initializeAuth()
    expect(state()).toMatchObject({ authenticated: false, user: null, sessionExpired: true, authChecked: true })
    expect(localStorage.getItem('user_id')).toBeNull()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('a warm-up handle without a Hive account signs in with no Hive user', () => {
    localStorage.setItem('incubation_handle', 'sunny-otter')
    state().initializeAuth()
    expect(state()).toMatchObject({ authenticated: true, user: null, userId: null, incubationHandle: 'sunny-otter', authChecked: true })
  })

  it('nothing remembered means a guest, and the check is marked done', () => {
    state().initializeAuth()
    expect(state()).toMatchObject({ authenticated: false, user: null, authChecked: true, sessionExpired: false })
  })

  it('the expired flag clears once the prompt was shown', () => {
    localStorage.setItem('user_id', 'badadib')
    state().initializeAuth()
    state().clearSessionExpired()
    expect(state().sessionExpired).toBe(false)
  })
})

describe('warm-up accounts', () => {
  it('signing in a warm-up user keeps the handle apart from user_id', () => {
    localStorage.setItem('user_id', 'stale')
    state().setIncubationUser('sunny-otter')
    expect(state()).toMatchObject({ authenticated: true, user: null, incubationHandle: 'sunny-otter' })
    expect(localStorage.getItem('incubation_handle')).toBe('sunny-otter')
    expect(localStorage.getItem('user_id')).toBeNull()
  })

  it('graduating moves both keys together, so a reload signs in the Hive account', () => {
    state().setIncubationUser('sunny-otter')
    state().promoteFromIncubation('badadib')
    expect(state()).toMatchObject({ authenticated: true, user: 'badadib', userId: 'badadib', incubationHandle: null })
    expect(localStorage.getItem('user_id')).toBe('badadib')
    expect(localStorage.getItem('incubation_handle')).toBeNull()

    wallet.live = true
    const reloaded = create((...a) => createAuthUserSlice(...a))
    reloaded.getState().initializeAuth()
    expect(reloaded.getState()).toMatchObject({ user: 'badadib', incubationHandle: null })
  })

  it('graduating without an account name changes nothing (it would log a warm-up user out)', () => {
    state().setIncubationUser('sunny-otter')
    state().promoteFromIncubation('')
    expect(state().incubationHandle).toBe('sunny-otter')
    expect(localStorage.getItem('incubation_handle')).toBe('sunny-otter')
  })

  it('setUser names a real Hive account and drops any warm-up handle', () => {
    state().setIncubationUser('sunny-otter')
    state().setUser('badadib')
    expect(state()).toMatchObject({ user: 'badadib', userId: 'badadib', authenticated: true, incubationHandle: null })
  })
})

describe('switching between saved accounts', () => {
  const saved = [
    { username: 'badadib', access_token: 'tok-a' },
    { username: 'badadib.test', access_token: 'tok-b' },
  ]

  it('makes the chosen account current, with its own token, and says so', () => {
    localStorage.setItem('accountsList', JSON.stringify(saved))
    state().switchAccount('badadib.test')
    expect(wallet.switchUser).toHaveBeenCalledWith('badadib.test')
    expect(state()).toMatchObject({ user: 'badadib.test', userId: 'badadib.test', authenticated: true })
    expect(localStorage.getItem('access_token')).toBe('tok-b')
    expect(localStorage.getItem('user_id')).toBe('badadib.test')
    expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('badadib.test'))
  })

  it('an account that is not saved leaves the current user as it was', () => {
    localStorage.setItem('accountsList', JSON.stringify(saved))
    state().setUser('badadib')
    wallet.switchUser.mockReturnValue(false)
    state().switchAccount('someone.else')
    expect(state().user).toBe('badadib')
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  // BUG: switchAccount (src/lib/slices/createAuthStore.js:100) runs
  // JSON.parse(localStorage.getItem("accountsList")).find(...) with no fallback,
  // so with no saved list yet (a fresh browser, or a cleared one) it throws
  // "Cannot read properties of null (reading 'find')" instead of just switching.
  it.skip('BUG: switching with no saved account list does not throw', () => {
    expect(() => state().switchAccount('badadib')).not.toThrow()
  })
})

describe('logging out', () => {
  it('clears the server cookies, the wallet, every local key and the signed-in state', async () => {
    localStorage.setItem('accountsList', JSON.stringify([{ username: 'badadib' }, { username: 'badadib.test' }]))
    for (const k of ['user_id', 'access_token', 'manteauth_login', 'manteauth_token', 'incubation_handle']) localStorage.setItem(k, 'x')
    state().setUser('badadib')

    await state().LogOut('badadib')

    expect(fetchMock.mock.calls.map(([url, o]) => [url, o.method, o.credentials])).toEqual([
      ['/api/manteauth/logout', 'POST', 'include'],
      ['/api/auth/wallet/logout', 'POST', 'include'],
    ])
    expect(wallet.logout).toHaveBeenCalled()
    for (const k of ['user_id', 'access_token', 'manteauth_login', 'manteauth_token', 'incubation_handle']) {
      expect(localStorage.getItem(k)).toBeNull()
    }
    // The other saved account stays available to switch back to.
    expect(JSON.parse(localStorage.getItem('accountsList'))).toEqual([{ username: 'badadib.test' }])
    expect(state()).toMatchObject({ authenticated: false, user: null, userId: null, incubationHandle: null, listAccounts: [], isProcessing: null })
  })

  it('still logs out locally when the server cannot be reached or the wallet throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    wallet.logout.mockImplementation(() => { throw new Error('no provider') })
    localStorage.setItem('user_id', 'badadib')
    state().setUser('badadib')
    await state().LogOut('badadib')
    expect(state().authenticated).toBe(false)
    expect(localStorage.getItem('user_id')).toBeNull()
    expect(localStorage.getItem('accountsList')).toBe('[]')
  })
})

describe('forgetting one saved account', () => {
  it('drops it from the wallet and the saved list only', () => {
    localStorage.setItem('accountsList', JSON.stringify([{ username: 'badadib' }, { username: 'badadib.test' }]))
    state().setUser('badadib')
    state().clearAccount('badadib.test')
    expect(wallet.removeOtherLogin).toHaveBeenCalledWith('badadib.test')
    expect(JSON.parse(localStorage.getItem('accountsList'))).toEqual([{ username: 'badadib' }])
    expect(state().user).toBe('badadib')
  })
})

describe('the legacy token login', () => {
  it('checkAuth trusts a token the backend accepts', async () => {
    localStorage.setItem('access_token', 'tok')
    backend.checkAuthentication.mockResolvedValue({ ok: 1 })
    await state().checkAuth()
    expect(backend.checkAuthentication).toHaveBeenCalledWith('tok')
    expect(state()).toMatchObject({ allowAccess: { ok: 1 }, authenticated: true })
  })

  it('checkAuth without a token denies access', async () => {
    await state().checkAuth()
    expect(state()).toMatchObject({ allowAccess: false, authenticated: false })
  })

  it('getUserDetails stores the username the backend returns, or clears it with no token', async () => {
    localStorage.setItem('access_token', 'tok')
    backend.getUserDetails.mockResolvedValue('badadib')
    await state().getUserDetails()
    expect(state().userDetails).toEqual({ username: 'badadib' })
    localStorage.removeItem('access_token')
    await state().getUserDetails()
    expect(state().userDetails).toBeNull()
  })

  it('login posts the email as the username and keeps the returned token', async () => {
    axiosPost.mockResolvedValue({ data: { access_token: 'new-token', user_id: 'u1' } })
    await state().login({ email: 'a@b.test', password: 'pw' })
    expect(axiosPost).toHaveBeenCalledWith('https://west.test/v1/auth/login', { username: 'a@b.test', password: 'pw' }, expect.any(Object))
    expect(localStorage.getItem('access_token')).toBe('new-token')
    expect(state()).toMatchObject({ authenticated: true, userId: 'u1' })
  })

  it('register sends the email as the username too', async () => {
    axiosPost.mockResolvedValue({ data: {} })
    await state().register({ email: 'a@b.test', password: 'pw' })
    expect(axiosPost).toHaveBeenCalledWith('https://west.test/v1/auth/register', { email: 'a@b.test', password: 'pw', username: 'a@b.test' }, expect.any(Object))
  })

  it('the Keychain login asks for a posting signature over the account and time', async () => {
    const requestSignBuffer = vi.fn()
    window.hive_keychain = { requestSignBuffer }
    const callback = () => {}
    await state().login_with_hive({ username: 'badadib', dateNow: 1700000000, callback })
    const [account, message, role, cb] = requestSignBuffer.mock.calls[0]
    expect([account, JSON.parse(message), role, cb]).toEqual(['badadib', { account: 'badadib', ts: 1700000000 }, 'Posting', callback])
    delete window.hive_keychain
  })

  it('the Keychain login without the extension fails quietly', async () => {
    delete window.hive_keychain
    await expect(state().login_with_hive({ username: 'badadib' })).resolves.toBeUndefined()
  })
})
