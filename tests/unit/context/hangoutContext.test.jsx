// OpenPods (Hangouts) sessions (src/context/HangoutContext.jsx): signing in through
// the @threespeak background signer with a wallet fallback, one shared sign-in for
// concurrent callers, cached and persisted tokens that are re-checked before use,
// and the clean-up on logout or an account switch. Nothing is signed for real: the
// Hangouts SDK, the wallet and fetch are stand-ins.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const sdk = vi.hoisted(() => ({ clients: [], loginWithSignFn: null, loginWithAioha: null }))
vi.mock('@snapie/hangouts-core', () => ({
  HangoutsApiClient: class {
    constructor(opts) {
      this.opts = opts
      this.setSessionToken = vi.fn()
      this.clearSessionToken = vi.fn()
      sdk.clients.push(this)
    }
  },
  loginWithSignFn: (...a) => sdk.loginWithSignFn(...a),
  loginWithAioha: (...a) => sdk.loginWithAioha(...a),
}))
vi.mock('@aioha/aioha', () => ({ Providers: { HiveSigner: 'hivesigner', Keychain: 'keychain' } }))
const wallet = vi.hoisted(() => ({ provider: 'keychain', mante: false }))
vi.mock('../../../src/hive-api/aioha', () => ({
  default: { getCurrentProvider: () => wallet.provider },
  isManteAuthLogin: () => wallet.mante,
}))
vi.mock('../../../src/utils/config', () => ({ EMBED_API_KEY: 'app-key' }))
vi.mock('../../../src/lib/store', async () => {
  const { create } = await import('zustand')
  return { useAppStore: create(() => ({ user: null, authenticated: false })) }
})

const HANGOUTS = 'https://hangouts.test/'
const jwt = (exp) => `h.${btoa(JSON.stringify({ exp }))}.s`
// Fixed once per file: computed per call, two calls in one test could fall either
// side of a second boundary under load and name two different tokens.
const IN_AN_HOUR = Math.floor(Date.now() / 1000) + 3600
const inAnHour = () => IN_AN_HOUR

let mod
let store
let fetchMock
let meStatus
let signResponse

async function load({ enabled = true } = {}) {
  vi.resetModules()
  sdk.clients = []
  vi.stubEnv('VITE_HANGOUTS_API_URL', enabled ? HANGOUTS : '')
  vi.stubEnv('VITE_THREESPEAK_API', 'https://api.test')
  mod = await import('../../../src/context/HangoutContext.jsx')
  store = (await import('../../../src/lib/store')).useAppStore
  store.setState({ user: null, authenticated: false })
}

const mount = (props = {}) => renderHook(() => mod.useHangout(), {
  wrapper: ({ children }) => <mod.HangoutContextProvider {...props}>{children}</mod.HangoutContextProvider>,
})
const client = () => sdk.clients[0]
const signCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/openpods/sign-challenge'))

beforeEach(async () => {
  localStorage.clear()
  wallet.provider = 'keychain'
  wallet.mante = false
  meStatus = 200
  signResponse = { ok: true, body: { signature: 'sig-1' } }
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith('/auth/me')) {
      if (meStatus === 'offline') throw new TypeError('Failed to fetch')
      return { status: meStatus }
    }
    return { ok: signResponse.ok, json: async () => signResponse.body }
  })
  vi.stubGlobal('fetch', fetchMock)
  // The SDK asks our signer to sign its challenge, then hands back a session.
  sdk.loginWithSignFn = vi.fn(async (_client, username, sign) => {
    await sign('challenge-1')
    return { token: `tok-${username}`, username }
  })
  sdk.loginWithAioha = vi.fn(async (_client, _aioha, username) => ({ token: `wallet-${username}`, username }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await load()
})

describe('without an OpenPods server configured', () => {
  it('never signs anything, yet rooms still open in listen-only mode', async () => {
    await load({ enabled: false })
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let token
    await act(async () => { token = await result.current.retryLogin('badadib') })
    expect(token).toBeNull()
    expect(sdk.loginWithSignFn).not.toHaveBeenCalled()
    act(() => { result.current.openRoom('room-1') })
    expect(result.current.activeRoom).toBe('room-1')
  })
})

describe('signing in', () => {
  it('a logged-out visitor gets no session', async () => {
    const { result } = mount()
    let token
    await act(async () => { token = await result.current.retryLogin() })
    expect(token).toBeNull()
    expect(sdk.loginWithSignFn).not.toHaveBeenCalled()
  })

  it('a wallet login is signed by @threespeak with the app key and the claimed name', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let token
    await act(async () => { token = await result.current.retryLogin() })
    expect(token).toBe('tok-badadib')
    expect(result.current).toMatchObject({ sessionToken: 'tok-badadib', sessionLoading: false, hangoutsUser: 'badadib' })
    expect(client().setSessionToken).toHaveBeenCalledWith('tok-badadib')

    const [url, init] = signCalls()[0]
    expect(url).toBe('https://api.test/openpods/sign-challenge')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'app-key' })
    expect(JSON.parse(init.body)).toEqual({ challenge: 'challenge-1', username: 'badadib' })
  })

  it('a HiveSigner login authenticates with its own token instead', async () => {
    wallet.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'hs-token')
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    const [, init] = signCalls()[0]
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer hs-token' })
    expect(JSON.parse(init.body)).toEqual({ challenge: 'challenge-1' })
  })

  it('a ButrAuth login relies on its cookie: no key, no claimed name', async () => {
    wallet.provider = null
    wallet.mante = true
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    const [, init] = signCalls()[0]
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ challenge: 'challenge-1' })
  })

  it('when @threespeak cannot sign, a wallet that can sign falls back to its own signature', async () => {
    signResponse = { ok: false, body: { error: 'posting authority not granted' } }
    sdk.loginWithSignFn = vi.fn(async (_c, u, sign) => { await sign('challenge-1'); return { token: 'never', username: u } })
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let token
    await act(async () => { token = await result.current.retryLogin() })
    expect(token).toBe('wallet-badadib')
    expect(sdk.loginWithAioha).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a silent (non-interactive) attempt', 'keychain', false],
    ['HiveSigner, which cannot sign a challenge', 'hivesigner', true],
  ])('%s never falls back to a wallet popup', async (_label, provider, interactive) => {
    wallet.provider = provider
    localStorage.setItem('hivesignerToken', 'hs-token')
    signResponse = { ok: false, body: {} }
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let token
    await act(async () => { token = await result.current.retryLogin('badadib', { interactive }) })
    expect(token).toBeNull()
    expect(sdk.loginWithAioha).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ sessionToken: null, sessionLoading: false })
  })

  it('an expired HiveSigner session fails before anything is sent', async () => {
    wallet.provider = 'hivesigner'
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin('badadib', { interactive: false }) })
    expect(signCalls()).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith('[OpenPods] Session auth failed:', expect.objectContaining({ message: expect.stringContaining('HiveSigner session expired') }))
  })

  it('shows loading while the signature is pending', async () => {
    let finish
    sdk.loginWithSignFn = vi.fn(() => new Promise((r) => { finish = () => r({ token: 'tok', username: 'badadib' }) }))
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let pending
    act(() => { pending = result.current.retryLogin() })
    expect(result.current.sessionLoading).toBe(true)
    await act(async () => { finish(); await pending })
    expect(result.current).toMatchObject({ sessionLoading: false, sessionToken: 'tok' })
  })
})

describe('one sign-in for everybody', () => {
  it('concurrent callers share the request in flight', async () => {
    let finish
    sdk.loginWithSignFn = vi.fn(() => new Promise((r) => { finish = () => r({ token: 'tok', username: 'badadib' }) }))
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let a, b
    act(() => { a = result.current.retryLogin(); b = result.current.retryLogin() })
    await act(async () => { finish() })
    await expect(a).resolves.toBe('tok')
    await expect(b).resolves.toBe('tok')
    expect(sdk.loginWithSignFn).toHaveBeenCalledTimes(1)
  })

  it('a later call reuses the cached token once the server still accepts it', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    let again
    await act(async () => { again = await result.current.retryLogin() })
    expect(again).toBe('tok-badadib')
    expect(sdk.loginWithSignFn).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://hangouts.test/auth/me', { headers: { Authorization: 'Bearer tok-badadib' } })
  })

  it('a flaky connection does not throw a cached token away', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    meStatus = 'offline'
    await act(async () => { await result.current.retryLogin() })
    expect(sdk.loginWithSignFn).toHaveBeenCalledTimes(1)
  })

  it('a token the server rejects (401) is dropped and a fresh one minted', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    meStatus = 401
    sdk.loginWithSignFn = vi.fn(async () => ({ token: 'tok-2', username: 'badadib' }))
    let token
    await act(async () => { token = await result.current.retryLogin() })
    expect(token).toBe('tok-2')
    expect(client().clearSessionToken).toHaveBeenCalled()
  })

  it('an interactive request does not settle for a silent attempt that fails', async () => {
    let failSilent
    sdk.loginWithSignFn = vi.fn()
      .mockImplementationOnce(() => new Promise((_, rej) => { failSilent = () => rej(new Error('no grant')) }))
      .mockImplementationOnce(async () => { throw new Error('no grant') })
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let silent, interactive
    act(() => {
      silent = result.current.retryLogin('badadib', { interactive: false })
      interactive = result.current.retryLogin('badadib', { interactive: true })
    })
    await act(async () => { failSilent() })
    await expect(silent).resolves.toBeNull()
    await expect(interactive).resolves.toBe('wallet-badadib')
  })

  it('a token signed for someone who logged out meanwhile is not applied', async () => {
    let finish
    sdk.loginWithSignFn = vi.fn(() => new Promise((r) => { finish = () => r({ token: 'tok', username: 'badadib' }) }))
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let pending
    act(() => { pending = result.current.retryLogin() })
    act(() => store.setState({ user: 'other', authenticated: true }))
    await act(async () => { finish(); await pending })
    expect(client().setSessionToken).not.toHaveBeenCalledWith('tok')
    expect(client().clearSessionToken).toHaveBeenCalled()
    expect(result.current.sessionToken).toBeNull()
  })

  it('a second account waits for the first signature to settle, then signs for itself', async () => {
    let finish
    sdk.loginWithSignFn = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { finish = () => r({ token: 'tok-a', username: 'a' }) }))
      .mockImplementationOnce(async () => ({ token: 'tok-b', username: 'b' }))
    store.setState({ user: 'a', authenticated: true })
    const { result } = mount()
    let first, second
    act(() => { first = result.current.retryLogin('a') })
    act(() => store.setState({ user: 'b', authenticated: true }))
    act(() => { second = result.current.retryLogin('b') })
    await act(async () => { finish() })
    await expect(first).resolves.toBe('tok-a')
    await expect(second).resolves.toBe('tok-b')
    expect(sdk.loginWithSignFn.mock.calls.map(([, u]) => u)).toEqual(['a', 'b'])
  })
})

describe('rooms', () => {
  it('opening a room signs a logged-in user in lazily', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    let ok
    act(() => { ok = result.current.openRoom('room-1') })
    expect(ok).toBe(true)
    expect(result.current.activeRoom).toBe('room-1')
    await waitFor(() => expect(result.current.sessionToken).toBe('tok-badadib'))

    act(() => result.current.closeRoom())
    expect(result.current.activeRoom).toBeNull()
  })

  it('a guest opens a room without any sign-in, and a nameless room is refused', () => {
    const { result } = mount()
    let ok
    act(() => { ok = result.current.openRoom('') })
    expect(ok).toBe(false)
    act(() => { result.current.openRoom('room-1') })
    expect(result.current.activeRoom).toBe('room-1')
    expect(sdk.loginWithSignFn).not.toHaveBeenCalled()
  })

  it('a deep link opened before the first auth check survives it', () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result, rerender } = mount()
    act(() => { result.current.openRoom('room-1') })
    rerender()
    expect(result.current.activeRoom).toBe('room-1')
  })

  it('switching accounts closes the room and drops the old session', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    act(() => { result.current.openRoom('room-1') })
    act(() => store.setState({ user: 'other', authenticated: true }))
    expect(result.current).toMatchObject({ activeRoom: null, sessionToken: null })
    expect(client().clearSessionToken).toHaveBeenCalled()
  })

  it('logging out closes the room and forgets every cached session', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    act(() => { result.current.openRoom('room-1') })
    act(() => store.setState({ user: null, authenticated: false }))
    expect(result.current).toMatchObject({ activeRoom: null, sessionToken: null, sessionLoading: false })

    // Back in as the same account: the old token is not reused.
    act(() => store.setState({ user: 'badadib', authenticated: true }))
    await act(async () => { await result.current.retryLogin() })
    expect(sdk.loginWithSignFn).toHaveBeenCalledTimes(2)
  })

  it('the rehydrating store flipping `authenticated` alone is not an account switch', () => {
    store.setState({ user: 'badadib', authenticated: false })
    const { result } = mount()
    act(() => { result.current.openRoom('room-1') })
    act(() => store.setState({ authenticated: true }))
    expect(result.current.activeRoom).toBe('room-1')
  })
})

describe('remembered tokens (tokenStorage)', () => {
  it('are off by default: nothing is written', async () => {
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await act(async () => { await result.current.retryLogin() })
    expect(localStorage.getItem('hh_session_badadib')).toBeNull()
  })

  it('"local" keeps the token and restores it on the next load without re-signing', async () => {
    sdk.loginWithSignFn = vi.fn(async () => ({ token: jwt(inAnHour()), username: 'badadib' }))
    store.setState({ user: 'badadib', authenticated: true })
    const first = mount({ tokenStorage: 'local' })
    await act(async () => { await first.result.current.retryLogin() })
    const saved = localStorage.getItem('hh_session_badadib')
    expect(saved).toBe(jwt(inAnHour()))
    first.unmount()

    await load()
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount({ tokenStorage: 'local' })
    expect(result.current.sessionToken).toBe(saved)
    expect(client().setSessionToken).toHaveBeenCalledWith(saved)
  })

  it('"session" uses sessionStorage', async () => {
    sessionStorage.setItem('hh_session_badadib', jwt(inAnHour()))
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount({ tokenStorage: 'session' })
    expect(result.current.sessionToken).toBe(jwt(inAnHour()))
    sessionStorage.clear()
  })

  it.each([
    ['expired', () => jwt(Math.floor(Date.now() / 1000) - 10)],
    ['expiring within 30 seconds', () => jwt(Math.floor(Date.now() / 1000) + 10)],
    ['unreadable', () => 'not-a-jwt'],
  ])('an %s stored token is deleted, not used', (_label, make) => {
    localStorage.setItem('hh_session_badadib', make())
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount({ tokenStorage: 'local' })
    expect(result.current.sessionToken).toBeNull()
    expect(localStorage.getItem('hh_session_badadib')).toBeNull()
  })

  it('a stored token is picked up by the sign-in too, after the server confirms it', async () => {
    store.setState({ user: 'badadib', authenticated: false })
    const { result } = mount({ tokenStorage: 'local' })
    localStorage.setItem('hh_session_badadib', jwt(inAnHour()))
    act(() => store.setState({ authenticated: true }))
    let token
    await act(async () => { token = await result.current.retryLogin('badadib') })
    expect(token).toBe(jwt(inAnHour()))
    expect(sdk.loginWithSignFn).not.toHaveBeenCalled()
  })

  it('switching to an account with a stored token resumes that session', async () => {
    localStorage.setItem('hh_session_other', jwt(inAnHour()))
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount({ tokenStorage: 'local' })
    act(() => store.setState({ user: 'other' }))
    expect(result.current.sessionToken).toBe(jwt(inAnHour()))
  })

  it('logging out deletes the previous account\'s stored token', async () => {
    localStorage.setItem('hh_session_badadib', jwt(inAnHour()))
    store.setState({ user: 'badadib', authenticated: true })
    mount({ tokenStorage: 'local' })
    act(() => store.setState({ user: null, authenticated: false }))
    expect(localStorage.getItem('hh_session_badadib')).toBeNull()
  })

  it('a custom storage object is used as given', async () => {
    const custom = { read: vi.fn(() => null), write: vi.fn(), clear: vi.fn() }
    store.setState({ user: 'badadib', authenticated: true })
    const { result } = mount({ tokenStorage: custom })
    await act(async () => { await result.current.retryLogin() })
    expect(custom.read).toHaveBeenCalledWith('badadib')
    expect(custom.write).toHaveBeenCalledWith('badadib', 'tok-badadib')
  })
})

describe('useHangout', () => {
  it('outside the provider is a programming error', () => {
    expect(() => renderHook(() => mod.useHangout())).toThrow('useHangout must be used within HangoutContextProvider')
  })
})
