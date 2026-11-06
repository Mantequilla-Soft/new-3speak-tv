// The server session behind a wallet login (src/hive-api/aioha.js): signing a
// server nonce once to get a session cookie ("Sign in with Hive"), HiveSigner
// trading its token instead, keeping that session in step with an account switch,
// parking the wallet when a Butter Auth login takes over, and the @threespeak proxy
// recovering from a missing or mismatched session by signing in and retrying once.
// The wallet and the API are fakes; nothing is signed or broadcast for real.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  wallet, resetWallet, signedInAs, fakeApi, ok, fail, requestsTo, urlsFetched, Providers,
} from './helpers/fakeAioha.js'

vi.mock('@aioha/aioha', async () => (await import('./helpers/fakeAioha.js')).aiohaModule)
vi.mock('../../../src/utils/config.js', () => ({ ENABLE_METAMASK_SNAP: false, EMBED_API_KEY: 'test-app-key' }))
vi.mock('../../../src/utils/vscContract.js', () => ({ IS_VSC_TESTNET: false, VSC_NET_ID: 'vsc-mainnet' }))
vi.mock('../../../src/utils/hiveNode.js', () => ({
  getHiveUrl: () => 'https://node.test',
  ensureHealthyNode: () => new Promise(() => {}),
}))

const {
  establishWalletSession, syncWalletSession, endWalletSession, broadcastViaThreespeak,
  setHiveAuthCallbacks, KeyTypes,
} = await import('../../../src/hive-api/aioha.js')

const URL = {
  broadcast: '/api/broadcast',
  challenge: '/api/auth/wallet/challenge',
  login: '/api/auth/wallet/login',
  logout: '/api/auth/wallet/logout',
  status: '/api/auth/wallet/status',
  hivesigner: '/api/auth/hivesigner/session',
}
const OPS = [['vote', { voter: 'alice', author: 'bob', permlink: 'p', weight: 10000 }]]

// A server that issues a nonce and accepts its signature.
const signInRoutes = {
  [URL.challenge]: ok({ challenge: 'nonce-1' }),
  [URL.login]: ok({ success: true }),
}

beforeEach(() => {
  localStorage.clear()
  resetWallet()
  setHiveAuthCallbacks(null, null)
  window.hive_keychain = {}
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  delete window.hive_keychain
  vi.useRealTimers()
})

describe('signing in to the server with a wallet', () => {
  it('signs the server nonce with the POSTING key and sends the signature back', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi(signInRoutes)
    await expect(establishWalletSession()).resolves.toBe(true)
    expect(requestsTo(api, URL.challenge)[0]).toMatchObject({ method: 'POST', credentials: 'include', body: { username: 'alice' } })
    expect(wallet.signMessage).toHaveBeenCalledWith('nonce-1', KeyTypes.Posting)
    expect(requestsTo(api, URL.login)[0].body).toEqual({ username: 'alice', challenge: 'nonce-1', signature: 'SIG' })
  })

  it('shows the HiveAuth approval prompt while the phone signs', async () => {
    signedInAs(Providers.HiveAuth, 'alice')
    const onWaiting = vi.fn()
    const onComplete = vi.fn()
    setHiveAuthCallbacks(onWaiting, onComplete)
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    fakeApi(signInRoutes)
    await establishWalletSession()
    expect(onWaiting).toHaveBeenCalledWith('Approve sign-in on HiveAuth...')
    expect(onComplete).toHaveBeenCalled()
  })

  it('two callers at once share ONE sign-in (one prompt, one nonce)', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi(signInRoutes)
    const [a, b] = await Promise.all([establishWalletSession(), establishWalletSession()])
    expect([a, b]).toEqual([true, true])
    expect(requestsTo(api, URL.challenge)).toHaveLength(1)
    expect(wallet.signMessage).toHaveBeenCalledTimes(1)
  })

  it('a later call signs in again once the first one finished', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi(signInRoutes)
    await establishWalletSession()
    await establishWalletSession()
    expect(requestsTo(api, URL.challenge)).toHaveLength(2)
  })

  it.each([
    ['the server gives no nonce', { [URL.challenge]: fail(429, { error: 'Too many' }), [URL.login]: ok({ success: true }) }, { success: true, result: 'SIG' }],
    ['the nonce reply is not JSON', { [URL.challenge]: { status: 200, body: new SyntaxError('Unexpected token <') }, [URL.login]: ok({ success: true }) }, { success: true, result: 'SIG' }],
    ['the user declines the signature', signInRoutes, { success: false, error: 'User rejected' }],
    ['the wallet returns no signature', signInRoutes, { success: true, result: '' }],
    ['the server refuses the signature', { ...signInRoutes, [URL.login]: fail(401, { error: 'Bad signature' }) }, { success: true, result: 'SIG' }],
  ])('fails quietly (false) when %s', async (_, routes, signature) => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue(signature)
    fakeApi(routes)
    await expect(establishWalletSession()).resolves.toBe(false)
  })

  it('waits for the Keychain extension, and gives up without it instead of hanging', async () => {
    vi.useFakeTimers()
    delete window.hive_keychain
    signedInAs(Providers.Keychain, 'alice')
    fakeApi(signInRoutes)
    const done = establishWalletSession()
    await vi.advanceTimersByTimeAsync(5200)
    await expect(done).resolves.toBe(false)
    expect(wallet.signMessage).not.toHaveBeenCalled()
  })

  it('a signature request nobody answers times out after two minutes', async () => {
    vi.useFakeTimers()
    signedInAs(Providers.PeakVault, 'alice')
    wallet.signMessage.mockReturnValue(new Promise(() => {}))
    const api = fakeApi(signInRoutes)
    const done = establishWalletSession()
    await vi.advanceTimersByTimeAsync(119000)
    let settled = false
    done.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(done).resolves.toBe(false)
    expect(requestsTo(api, URL.login)).toHaveLength(0)
  })

  it('does nothing for a Butter Auth session, which has its own cookie', async () => {
    localStorage.setItem('manteauth_login', 'true')
    const api = fakeApi({})
    await expect(establishWalletSession()).resolves.toBe(false)
    expect(api).not.toHaveBeenCalled()
  })

  it('re-reads the saved login when nobody is loaded here, and stops if there is still nobody', async () => {
    const api = fakeApi({})
    await expect(establishWalletSession()).resolves.toBe(false)
    expect(wallet.loadAuth).toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it('re-reads the saved login when it holds a DIFFERENT account than the one acted for', async () => {
    signedInAs(Providers.Keychain, 'old-account')
    wallet.loadAuth.mockImplementation(() => signedInAs(Providers.Keychain, 'new-account'))
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi(signInRoutes)
    await establishWalletSession('New-Account')
    expect(wallet.loadAuth).toHaveBeenCalled()
    expect(requestsTo(api, URL.challenge)[0].body).toEqual({ username: 'new-account' })
  })

  it('leaves the loaded login alone when it is the account acted for (any case)', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    fakeApi(signInRoutes)
    await establishWalletSession('ALICE')
    expect(wallet.loadAuth).not.toHaveBeenCalled()
  })

  it('a provider with no account name gives up', async () => {
    wallet.getCurrentProvider.mockReturnValue(Providers.Keychain)
    wallet.getCurrentUser.mockReturnValueOnce('alice').mockReturnValue(null)
    const api = fakeApi({})
    await expect(establishWalletSession()).resolves.toBe(false)
    expect(api).not.toHaveBeenCalled()
  })
})

describe('signing in to the server with HiveSigner', () => {
  it('trades the HiveSigner token for the session cookie', async () => {
    signedInAs(Providers.HiveSigner, 'alice')
    localStorage.setItem('hivesignerToken', 'hs-token')
    const api = fakeApi({ [URL.hivesigner]: ok({}) })
    await expect(establishWalletSession()).resolves.toBe(true)
    expect(requestsTo(api, URL.hivesigner)[0]).toMatchObject({
      method: 'POST', credentials: 'include', body: {},
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer hs-token' },
    })
    expect(wallet.signMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['no token is stored', null, {}],
    ['the server rejects the token', 'hs-token', { [URL.hivesigner]: fail(401) }],
    ['the request fails', 'hs-token', { [URL.hivesigner]: new Error('offline') }],
  ])('is false when %s', async (_, token, routes) => {
    signedInAs(Providers.HiveSigner, 'alice')
    if (token) localStorage.setItem('hivesignerToken', token)
    fakeApi(routes)
    await expect(establishWalletSession()).resolves.toBe(false)
  })
})

describe('keeping the server session on the account signed in now', () => {
  it('an already matching session is left alone', async () => {
    signedInAs(Providers.Keychain, 'alice')
    const api = fakeApi({ [URL.status]: ok({ user: 'alice' }) })
    await expect(syncWalletSession()).resolves.toBe(true)
    expect(urlsFetched(api)).toEqual([URL.status])
  })

  it('a session for the PREVIOUS account is cleared first, then one is made for the new one', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi({ [URL.status]: ok({ user: 'bob' }), [URL.logout]: ok({}), ...signInRoutes })
    await expect(syncWalletSession()).resolves.toBe(true)
    expect(urlsFetched(api)).toEqual([URL.status, URL.logout, URL.challenge, URL.login])
    expect(requestsTo(api, URL.logout)[0]).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it('logged out here: the leftover server session is cleared and nothing new is made', async () => {
    const api = fakeApi({ [URL.status]: ok({ user: 'bob' }), [URL.logout]: ok({}) })
    await expect(syncWalletSession()).resolves.toBe(false)
    expect(urlsFetched(api)).toEqual([URL.status, URL.logout])
  })

  it('a logout that fails does not stop the new sign-in', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    fakeApi({ [URL.status]: ok({ user: 'bob' }), [URL.logout]: new Error('offline'), ...signInRoutes })
    await expect(syncWalletSession()).resolves.toBe(true)
  })

  it('nobody signed in on either side: nothing is cleared and nothing is minted', async () => {
    const api = fakeApi({ [URL.status]: ok({ user: null }) })
    await syncWalletSession()
    expect(urlsFetched(api)).toEqual([URL.status])
    expect(wallet.signMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['the server names nobody and nobody is signed in here', { [URL.status]: ok({}) }],
    ['the status check fails', { [URL.status]: fail(500) }],
    ['the status check cannot be reached', { [URL.status]: new Error('offline') }],
  ])('is false when %s', async (_, routes) => {
    const api = fakeApi(routes)
    await expect(syncWalletSession()).resolves.toBe(false)
    expect(urlsFetched(api)).toEqual([URL.status])
  })
})

describe('ending the wallet session when Butter Auth takes over', () => {
  it('parks the wallet login (so Change account can switch back) instead of logging it out', async () => {
    signedInAs(Providers.HiveAuth, 'alice')
    const info = { provider: 'hiveauth', token: 't' }
    wallet.getPI.mockReturnValue({ getLoginInfo: () => info })
    const api = fakeApi({ [URL.logout]: ok({}) })
    await endWalletSession()
    expect(wallet.addOtherLogin).toHaveBeenCalledWith('alice', info)
    expect(wallet.handleLogout).toHaveBeenCalled()
    expect(wallet.logout).not.toHaveBeenCalled()
    expect(requestsTo(api, URL.logout)).toHaveLength(1)
  })

  it.each([
    ['the provider has no login info', () => wallet.getPI.mockReturnValue({ getLoginInfo: () => null })],
    ['parking throws', () => {
      wallet.getPI.mockReturnValue({ getLoginInfo: () => ({}) })
      wallet.addOtherLogin.mockImplementation(() => { throw new Error('private') })
    }],
  ])('logs the wallet out when %s', async (_, arrange) => {
    signedInAs(Providers.Keychain, 'alice')
    arrange()
    wallet.logout.mockRejectedValue(new Error('already gone'))
    fakeApi({ [URL.logout]: ok({}) })
    await expect(endWalletSession()).resolves.toBeUndefined()
    expect(wallet.logout).toHaveBeenCalled()
  })

  it('with no wallet login, only the server cookie is cleared, and a failure there is ignored', async () => {
    const api = fakeApi({ [URL.logout]: new Error('offline') })
    await expect(endWalletSession()).resolves.toBeUndefined()
    expect(wallet.logout).not.toHaveBeenCalled()
    expect(wallet.addOtherLogin).not.toHaveBeenCalled()
    expect(urlsFetched(api)).toEqual([URL.logout])
  })
})

describe('the @threespeak proxy', () => {
  it('a HiveSigner login sends its token and does not claim a username', async () => {
    signedInAs(Providers.HiveSigner, 'alice')
    localStorage.setItem('hivesignerToken', 'hs-token')
    const api = fakeApi({ [URL.broadcast]: ok({ success: true, result: 'r' }) })
    await expect(broadcastViaThreespeak(OPS)).resolves.toEqual({ success: true, result: 'r' })
    const [req] = requestsTo(api, URL.broadcast)
    expect(req.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer hs-token' })
    expect(req.body).toEqual({ operations: OPS })
    expect(req.credentials).toBe('include')
  })

  it('a HiveSigner login without a token is told to reconnect, before anything is sent', async () => {
    signedInAs(Providers.HiveSigner, 'alice')
    const api = fakeApi({})
    await expect(broadcastViaThreespeak(OPS)).rejects.toThrow('HiveSigner session expired')
    expect(api).not.toHaveBeenCalled()
  })

  it('a HiveSigner 401 says the HiveSigner session expired, with no wallet sign-in attempt', async () => {
    signedInAs(Providers.HiveSigner, 'alice')
    localStorage.setItem('hivesignerToken', 'hs-token')
    const api = fakeApi({ [URL.broadcast]: fail(401, { error: 'Unauthorized' }) })
    await expect(broadcastViaThreespeak(OPS)).rejects.toThrow('Your HiveSigner session has expired')
    expect(urlsFetched(api)).toEqual([URL.broadcast])
  })

  it('a wallet with no server session yet (401) signs in and retries ONCE', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi({
      [URL.broadcast]: [fail(401, { error: 'Unauthorized' }), ok({ success: true, result: 'after-retry' })],
      ...signInRoutes,
    })
    await expect(broadcastViaThreespeak(OPS)).resolves.toEqual({ success: true, result: 'after-retry' })
    expect(urlsFetched(api)).toEqual([URL.broadcast, URL.challenge, URL.login, URL.broadcast])
    // The same operations, both times.
    expect(requestsTo(api, URL.broadcast).map((r) => r.body)).toEqual([
      { operations: OPS, username: 'alice' }, { operations: OPS, username: 'alice' },
    ])
  })

  it('a 401 that sign-in cannot fix says how to recover, in words', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: false, error: 'User rejected' })
    const api = fakeApi({ [URL.broadcast]: fail(401, { error: 'Unauthorized' }), ...signInRoutes })
    await expect(broadcastViaThreespeak(OPS)).rejects.toThrow('Could not verify your Hive account')
    expect(requestsTo(api, URL.broadcast)).toHaveLength(1)
  })

  it('a session held for ANOTHER account (403 mismatch) signs this wallet in too and retries, logging nobody out', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: true, result: 'SIG' })
    const api = fakeApi({
      [URL.broadcast]: [
        fail(403, { error: 'You do not hold posting authority over @alice' }),
        ok({ success: true, result: 'ok-now' }),
      ],
      ...signInRoutes,
    })
    await expect(broadcastViaThreespeak(OPS)).resolves.toEqual({ success: true, result: 'ok-now' })
    expect(urlsFetched(api)).not.toContain(URL.logout)
    expect(requestsTo(api, URL.broadcast)).toHaveLength(2)
  })

  it('a mismatch that sign-in cannot fix surfaces the server refusal', async () => {
    signedInAs(Providers.Keychain, 'alice')
    wallet.signMessage.mockResolvedValue({ success: false })
    fakeApi({ [URL.broadcast]: fail(403, { error: 'Operation not allowed' }), ...signInRoutes })
    await expect(broadcastViaThreespeak(OPS)).rejects.toThrow('Operation not allowed')
  })

  it('a missing @threespeak grant is not retried: the caller signs client-side instead', async () => {
    signedInAs(Providers.Keychain, 'alice')
    const api = fakeApi({ [URL.broadcast]: fail(403, { error: 'Authorization required' }) })
    await expect(broadcastViaThreespeak(OPS)).rejects.toThrow('Authorization required')
    expect(urlsFetched(api)).toEqual([URL.broadcast])
  })

  it('a reply that is not JSON still fails cleanly', async () => {
    signedInAs(Providers.Keychain, 'alice')
    fakeApi({ [URL.broadcast]: () => ({ status: 502, body: new SyntaxError('Unexpected token <') }) })
    await expect(broadcastViaThreespeak(OPS)).rejects.toThrow('Broadcast via @threespeak failed')
  })
})
