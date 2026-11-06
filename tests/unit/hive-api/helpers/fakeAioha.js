// Test doubles shared by the hive-api tests: a stand-in for the @aioha/aioha wallet
// (every method a vi.fn, so a test can say what the "signed-in wallet" answers and
// read back exactly what it was asked to sign), and a tiny fake of the 3Speak API
// behind fetch. Nothing here signs or broadcasts anything.
import { vi } from 'vitest'

export const KeyTypes = { Posting: 'posting', Active: 'active', Memo: 'memo' }
export const Providers = {
  HiveSigner: 'hivesigner', Keychain: 'keychain', HiveAuth: 'hiveauth',
  PeakVault: 'peakvault', Ledger: 'ledger', MetaMaskSnap: 'metamasksnap',
}

export const METHODS = [
  'registerKeychain', 'registerLedger', 'registerPeakVault', 'registerMetaMaskSnap',
  'registerHiveAuth', 'registerHiveSigner', 'setApi', 'loadAuth', 'vscSetNetId', 'setChainId',
  'getCurrentProvider', 'getCurrentUser', 'isLoggedIn', 'login', 'logout', 'vote',
  'signAndBroadcastTx', 'transfer', 'follow', 'customJSON', 'comment', 'signMessage',
  'getPI', 'addOtherLogin', 'handleLogout',
]

// One wallet object; every `new Aioha()` hands it back, so the module under test
// and the test talk to the same thing.
export const wallet = Object.fromEntries(METHODS.map((m) => [m, vi.fn()]))
export const constructedWith = []

export const aiohaModule = {
  Aioha: class {
    constructor(api) {
      constructedWith.push(api)
      return wallet
    }
  },
  Asset: { name: 'Asset' },
  KeyTypes,
  Providers,
}

export function resetWallet() {
  for (const fn of Object.values(wallet)) fn.mockReset()
  signedInAs(null, null)
}

// Who the wallet says is signed in, and with which provider.
export function signedInAs(provider, user) {
  wallet.getCurrentProvider.mockReturnValue(provider)
  wallet.getCurrentUser.mockReturnValue(user)
  wallet.isLoggedIn.mockReturnValue(!!user)
}

/**
 * Stub fetch with a fake API. `routes` maps a URL to a response, a list of
 * responses (served in order, the last one repeating) or a function of the
 * request options. A response is { status, body }; an Error as the body is a reply
 * that is not JSON, an Error as the response is a request that never got through. An unknown URL fails the test
 * loudly instead of reaching the network.
 */
export function fakeApi(routes = {}) {
  const queues = Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]))
  const fetchMock = vi.fn(async (url, opts = {}) => {
    const route = queues[url]
    if (route === undefined) throw new Error(`unexpected fetch ${url}`)
    let res = route
    if (Array.isArray(route)) res = route.length > 1 ? route.shift() : route[0]
    if (typeof res === 'function') res = await res(opts)
    if (res instanceof Error) throw res
    const json = async () => {
      if (res.body instanceof Error) throw res.body // a reply that is not JSON
      return res.body
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const ok = (body = { success: true, result: { id: 'tx1' } }) => ({ status: 200, body })
export const fail = (status, body = {}) => ({ status, body })

// The requests sent to one URL, with their headers and parsed JSON bodies.
export const requestsTo = (fetchMock, url) => fetchMock.mock.calls
  .filter(([u]) => u === url)
  .map(([, o = {}]) => ({ ...o, body: o.body ? JSON.parse(o.body) : undefined }))

export const urlsFetched = (fetchMock) => fetchMock.mock.calls.map(([u]) => u)
