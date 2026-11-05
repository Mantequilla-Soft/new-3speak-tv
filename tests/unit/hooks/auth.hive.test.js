// The legacy Hive login helpers in src/hooks/auth (api.js, hive.js, index.js): the
// login proof a wallet signs (a timestamped payload with the account, posting key),
// minting the server session at login without ever making it fatal, the request
// that trades the proof for an access token, storing that token for later requests,
// and logout clearing it again. The wallet and the HTTP client are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { METHODS } from '../hive-api/helpers/fakeAioha.js'

const fake = vi.hoisted(() => ({ wallet: null, snap: false, establish: null }))

vi.mock('@aioha/aioha', async () => {
  const { KeyTypes, Providers } = await import('../hive-api/helpers/fakeAioha.js')
  return { Aioha: class { constructor() { return fake.wallet } }, KeyTypes, Providers }
})
vi.mock('../../../src/hive-api/aioha', () => ({ establishWalletSession: (...a) => fake.establish(...a) }))
vi.mock('../../../src/utils/config', () => ({ get ENABLE_METAMASK_SNAP() { return fake.snap } }))

async function loadHive() {
  fake.wallet = Object.fromEntries(METHODS.map((m) => [m, vi.fn()]))
  vi.resetModules()
  const { hive } = await import('../../../src/hooks/auth/hive.js')
  return { hive, wallet: fake.wallet }
}

beforeEach(() => {
  fake.snap = false
  fake.establish = vi.fn(async () => true)
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.useRealTimers())

describe('setting the login wallet up', () => {
  it('offers the wallets, HiveSigner for login and votes only, and restores a saved login', async () => {
    const { wallet } = await loadHive()
    for (const m of ['registerKeychain', 'registerLedger', 'registerPeakVault', 'loadAuth']) expect(wallet[m]).toHaveBeenCalled()
    expect(wallet.registerHiveAuth).toHaveBeenCalledWith({ name: '3Speak' })
    expect(wallet.registerHiveSigner).toHaveBeenCalledWith({
      app: '3speak.tv', callbackURL: `${window.location.origin}/hivesigner.html`, scope: ['login', 'vote'],
    })
  })

  it('leaves MetaMask Snap out unless switched on (it pops up other wallet extensions)', async () => {
    expect((await loadHive()).wallet.registerMetaMaskSnap).not.toHaveBeenCalled()
    fake.snap = true
    expect((await loadHive()).wallet.registerMetaMaskSnap).toHaveBeenCalled()
  })
})

describe('logging in with a Hive wallet', () => {
  it('signs a timestamped proof naming the account with the posting key', async () => {
    vi.useFakeTimers({ now: 1_760_000_000_000 })
    const { hive, wallet } = await loadHive()
    wallet.login.mockResolvedValue({ success: true, result: 'PROOF-SIG' })
    await hive.login('keychain', 'alice')
    expect(wallet.login).toHaveBeenCalledWith('keychain', 'alice', {
      keyType: 'posting',
      msg: JSON.stringify({ ts: 1_760_000_000_000, account: 'alice' }),
    })
  })

  it('returns the request that trades the proof for an access token', async () => {
    vi.useFakeTimers({ now: 1000 })
    const { hive, wallet } = await loadHive()
    wallet.login.mockResolvedValue({ success: true, result: 'PROOF-SIG' })
    await expect(hive.login('hiveauth', 'alice')).resolves.toEqual({
      request: {
        method: 'POST',
        url: '/v1/auth/login/singleton/hive',
        data: { proof_payload: { ts: 1000, account: 'alice' }, proof: 'PROOF-SIG' },
      },
      userId: 'alice',
    })
  })

  it('mints the server session while the wallet is unlocked', async () => {
    const { hive, wallet } = await loadHive()
    wallet.login.mockResolvedValue({ success: true, result: 'sig' })
    await hive.login('keychain', 'alice')
    expect(fake.establish).toHaveBeenCalledTimes(1)
  })

  it('a declined session signature still logs the user in', async () => {
    const { hive, wallet } = await loadHive()
    wallet.login.mockResolvedValue({ success: true, result: 'sig' })
    fake.establish.mockRejectedValue(new Error('declined'))
    await expect(hive.login('keychain', 'alice')).resolves.toMatchObject({ userId: 'alice' })
  })

  it('a refused login fails with the wallet\'s reason and mints nothing', async () => {
    const { hive, wallet } = await loadHive()
    wallet.login.mockResolvedValue({ success: false, error: 'User cancelled' })
    await expect(hive.login('keychain', 'alice')).rejects.toThrow('User cancelled')
    expect(fake.establish).not.toHaveBeenCalled()
  })

  it('logging out logs the wallet out', async () => {
    const { hive, wallet } = await loadHive()
    wallet.logout.mockResolvedValue(undefined)
    await hive.logout()
    expect(wallet.logout).toHaveBeenCalled()
  })
})

describe('the auth HTTP client', () => {
  const loadApi = async () => {
    vi.resetModules()
    return import('../../../src/hooks/auth/api.js')
  }

  it('sends JSON and picks up a stored access token as a bearer token', async () => {
    localStorage.setItem('access_token', 'tok-1')
    const { api } = await loadApi()
    expect(api.defaults.headers['Content-Type']).toBe('application/json')
    expect(api.defaults.headers.Authorization).toBe('Bearer tok-1')
  })

  it('has no authorization without a stored token', async () => {
    const { api } = await loadApi()
    expect(api.defaults.headers.Authorization).toBeNull()
  })

  it('can set and clear the token and the content type', async () => {
    const { api, setAuthorization, setContentType } = await loadApi()
    setAuthorization('tok-2')
    expect(api.defaults.headers.Authorization).toBe('Bearer tok-2')
    setAuthorization('')
    expect(api.defaults.headers.Authorization).toBeNull()
    setContentType('text/plain')
    expect(api.defaults.headers['Content-Type']).toBe('text/plain')
  })
})

// AuthActions is loaded with its own login helpers faked (vi.doMock, not hoisted).
const deps = { hive: null, request: null, setAuthorization: null }

describe('AuthActions', () => {
  const load = async () => {
    vi.doMock('../../../src/hooks/auth/hive', () => ({ hive: deps.hive }))
    vi.doMock('../../../src/hooks/auth/api', () => ({
      api: { request: (...a) => deps.request(...a) },
      setAuthorization: (...a) => deps.setAuthorization(...a),
    }))
    vi.resetModules()
    return (await import('../../../src/hooks/auth/index.js')).AuthActions
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    deps.hive = {
      login: vi.fn(async (provider, user) => ({ request: { method: 'POST', url: '/v1/login', data: { proof: 'p' } }, userId: user })),
      logout: vi.fn(),
    }
    deps.request = vi.fn(async () => ({ data: { access_token: 'tok-9' } }))
    deps.setAuthorization = vi.fn()
  })
  afterEach(() => {
    vi.doUnmock('../../../src/hooks/auth/hive')
    vi.doUnmock('../../../src/hooks/auth/api')
  })

  it('a Hive login sends the signed proof as JSON, then stores the token and the account', async () => {
    const AuthActions = await load()
    await AuthActions.login('Hive', 'keychain', 'alice')
    expect(deps.hive.login).toHaveBeenCalledWith('keychain', 'alice')
    expect(deps.request).toHaveBeenCalledWith({ method: 'POST', url: '/v1/login', data: JSON.stringify({ proof: 'p' }) })
    expect(deps.setAuthorization).toHaveBeenCalledWith('tok-9')
    expect(localStorage.getItem('access_token')).toBe('tok-9')
    expect(localStorage.getItem('user_id')).toBe('alice')
  })

  it('a failed wallet login stores nothing', async () => {
    deps.hive.login.mockRejectedValue(new Error('User cancelled'))
    const AuthActions = await load()
    await expect(AuthActions.login('Hive', 'keychain', 'alice')).rejects.toThrow('User cancelled')
    expect(deps.request).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('a refused token request stores nothing', async () => {
    deps.request.mockRejectedValue(new Error('401'))
    const AuthActions = await load()
    await expect(AuthActions.login('Hive', 'keychain', 'alice')).rejects.toThrow('401')
    expect(localStorage.getItem('user_id')).toBeNull()
  })

  it('logout forgets the token and the account and logs every wallet out', async () => {
    localStorage.setItem('access_token', 'tok-9')
    localStorage.setItem('user_id', 'alice')
    localStorage.setItem('unrelated', 'keep')
    const AuthActions = await load()
    AuthActions.logout()
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('user_id')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(deps.hive.logout).toHaveBeenCalled()
  })
})
