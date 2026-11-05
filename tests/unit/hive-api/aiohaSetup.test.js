// How src/hive-api/aioha.js sets the wallet client up when it loads: which wallets
// are offered (MetaMask Snap only behind its switch, since probing window.ethereum
// pops up other wallet extensions), the Hive node and chain it signs for, moving to
// the health-checked node once that is known, and NOT restoring a saved wallet
// login inside the Butter Auth popup (it would sign as the account being left).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { METHODS } from './helpers/fakeAioha.js'

const env = vi.hoisted(() => ({ snap: false, healthy: null }))
// Each load gets a fresh wallet, so one load's calls never show in the next.
const fake = vi.hoisted(() => ({ wallet: null, constructedWith: [] }))

vi.mock('@aioha/aioha', async () => {
  const { KeyTypes, Providers } = await import('./helpers/fakeAioha.js')
  class Aioha {
    constructor(api) {
      fake.constructedWith.push(api)
      return fake.wallet
    }
  }
  return { Aioha, Asset: {}, KeyTypes, Providers }
})
vi.mock('../../../src/utils/config.js', () => ({
  get ENABLE_METAMASK_SNAP() { return env.snap },
  EMBED_API_KEY: 'test-app-key',
}))
vi.mock('../../../src/utils/vscContract.js', () => ({ IS_VSC_TESTNET: false, VSC_NET_ID: 'vsc-mainnet' }))
vi.mock('../../../src/utils/hiveNode.js', () => ({
  getHiveUrl: () => 'https://node.test',
  ensureHealthyNode: () => env.healthy,
}))

// A fresh load of the module, as on a page load at `path`.
async function load(path = '/') {
  window.history.replaceState(null, '', path)
  fake.wallet = Object.fromEntries(METHODS.map((m) => [m, vi.fn()]))
  fake.constructedWith = []
  vi.resetModules()
  const mod = await import('../../../src/hive-api/aioha.js')
  return { mod, wallet: fake.wallet, constructedWith: fake.constructedWith }
}

beforeEach(() => {
  env.snap = false
  env.healthy = new Promise(() => {})
})
afterEach(() => window.history.replaceState(null, '', '/'))

describe('loading the wallet client', () => {
  it('connects to the session node and offers the usual wallets', async () => {
    const { wallet, constructedWith } = await load()
    expect(constructedWith).toEqual(['https://node.test'])
    for (const m of ['registerKeychain', 'registerLedger', 'registerPeakVault']) expect(wallet[m]).toHaveBeenCalled()
    expect(wallet.registerHiveAuth).toHaveBeenCalledWith({ name: '3Speak', description: '3Speak - Decentralized Video Platform' })
    expect(wallet.registerHiveSigner).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: `${window.location.origin}/hivesigner.html`,
      scope: ['login', 'vote', 'comment', 'follow', 'transfer'],
    }))
    expect(wallet.setApi).toHaveBeenCalledWith('https://node.test')
  })

  it('signs for Hive mainnet and the VSC mainnet', async () => {
    const { wallet } = await load()
    expect(wallet.setChainId).toHaveBeenCalledWith('beeab0de00000000000000000000000000000000000000000000000000000000')
    expect(wallet.vscSetNetId).toHaveBeenCalledWith('vsc-mainnet')
  })

  it('leaves MetaMask Snap out unless it is switched on', async () => {
    expect((await load()).wallet.registerMetaMaskSnap).not.toHaveBeenCalled()
    env.snap = true
    expect((await load()).wallet.registerMetaMaskSnap).toHaveBeenCalled()
  })

  it('moves to the health-checked node once the probe answers', async () => {
    let answer
    env.healthy = new Promise((r) => { answer = r })
    const { wallet } = await load()
    expect(wallet.setApi).toHaveBeenLastCalledWith('https://node.test')
    answer('https://healthy.test')
    await vi.waitFor(() => expect(wallet.setApi).toHaveBeenLastCalledWith('https://healthy.test'))
  })

  it('restores the saved wallet login on an ordinary page', async () => {
    expect((await load('/watch?v=bob/p')).wallet.loadAuth).toHaveBeenCalled()
  })

  it('stays logged out inside the Butter Auth login popup', async () => {
    expect((await load('/callback?state=popup')).wallet.loadAuth).not.toHaveBeenCalled()
  })

  it('a normal Butter Auth callback (not the popup) still restores it', async () => {
    expect((await load('/callback?state=redirect')).wallet.loadAuth).toHaveBeenCalled()
  })

  it('re-exports the key types and providers for callers', async () => {
    const { mod } = await load()
    expect(mod.KeyTypes.Posting).toBe('posting')
    expect(mod.Providers.HiveSigner).toBe('hivesigner')
    expect(mod.default).toBe(fake.wallet)
  })
})
