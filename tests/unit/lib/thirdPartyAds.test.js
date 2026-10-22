// The one door for third-party ad scripts: our banner AND (when present) the
// TCF CMP must both say yes (src/lib/thirdPartyAds.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const consent = vi.hoisted(() => ({ advertising: false }))
vi.mock('../../../src/lib/consent', () => ({ hasConsent: (c) => (c === 'advertising' ? consent.advertising : false) }))

async function load({ adsFlag = true } = {}) {
  vi.resetModules()
  if (adsFlag) vi.stubEnv('VITE_ENABLE_THIRDPARTY_ADS', 'true')
  return import('../../../src/lib/thirdPartyAds.js')
}

let cmpCallback
function installCmp() {
  window.__tcfapi = vi.fn((cmd, ver, cb) => { cmpCallback = cb })
}

beforeEach(() => {
  consent.advertising = false
  delete window.__tcfapi
  cmpCallback = null
  document.head.innerHTML = ''
})

describe('adConsentState', () => {
  it('is denied whenever the feature flag is off, whatever the user said', async () => {
    consent.advertising = true
    const m = await load({ adsFlag: false })
    expect(m.adConsentState()).toBe('denied')
    expect(m.canLoadAdScripts()).toBe(false)
  })

  it('is denied without our banner\'s advertising consent', async () => {
    const m = await load()
    expect(m.adConsentState()).toBe('denied')
  })

  it('is granted on our banner alone when there is no CMP', async () => {
    consent.advertising = true
    const m = await load()
    expect(m.adConsentState()).toBe('granted')
    expect(m.canLoadAdScripts()).toBe(true)
  })

  it('is pending while a CMP has not answered (not the same as denied)', async () => {
    consent.advertising = true
    installCmp()
    const m = await load()
    m.subscribeToCmp()
    expect(m.adConsentState()).toBe('pending')
    expect(m.canLoadAdScripts()).toBe(false)
  })

  it('follows the CMP\'s purpose 1 consent once it settles', async () => {
    consent.advertising = true
    installCmp()
    const m = await load()
    m.subscribeToCmp()
    expect(window.__tcfapi).toHaveBeenCalledWith('addEventListener', 2, expect.any(Function))

    cmpCallback({ eventStatus: 'cmpuishown', purpose: { consents: { 1: true } } }, true)
    expect(m.adConsentState()).toBe('pending')

    cmpCallback({ eventStatus: 'useractioncomplete', purpose: { consents: { 1: false } } }, true)
    expect(m.adConsentState()).toBe('denied')

    cmpCallback({ eventStatus: 'tcloaded', purpose: { consents: { 1: true } } }, true)
    expect(m.adConsentState()).toBe('granted')
  })

  it('treats gdprApplies false as a yes from the CMP', async () => {
    consent.advertising = true
    installCmp()
    const m = await load()
    m.subscribeToCmp()
    cmpCallback({ eventStatus: 'tcloaded', gdprApplies: false }, true)
    expect(m.adConsentState()).toBe('granted')
  })

  it('a CMP yes never overrides our own banner\'s no', async () => {
    installCmp()
    const m = await load()
    m.subscribeToCmp()
    cmpCallback({ eventStatus: 'tcloaded', purpose: { consents: { 1: true } } }, true)
    expect(m.adConsentState()).toBe('denied')
  })

  it('ignores an unsuccessful CMP callback and a CMP that throws', async () => {
    consent.advertising = true
    installCmp()
    let m = await load()
    m.subscribeToCmp()
    cmpCallback({ eventStatus: 'tcloaded', purpose: { consents: { 1: true } } }, false)
    expect(m.adConsentState()).toBe('pending')

    window.__tcfapi = () => { throw new Error('broken cmp') }
    m = await load()
    expect(() => m.subscribeToCmp()).not.toThrow()
    expect(m.adConsentState()).toBe('pending')
  })

  it('subscribes to the CMP only once', async () => {
    installCmp()
    const m = await load()
    m.subscribeToCmp()
    m.subscribeToCmp()
    expect(window.__tcfapi).toHaveBeenCalledTimes(1)
  })
})

describe('change notification', () => {
  it('tells listeners the new state, survives a throwing listener, and unsubscribes', async () => {
    consent.advertising = true
    installCmp()
    const m = await load()
    const seen = []
    m.onAdConsentChange(() => { throw new Error('bad listener') })
    const off = m.onAdConsentChange((s) => seen.push(s))
    m.subscribeToCmp()
    cmpCallback({ eventStatus: 'tcloaded', purpose: { consents: { 1: true } } }, true)
    expect(seen).toEqual(['granted'])
    consent.advertising = false
    m.notifyAdConsentChanged()
    expect(seen).toEqual(['granted', 'denied'])
    off()
    m.notifyAdConsentChanged()
    expect(seen).toHaveLength(2)
  })
})

describe('loadAdScript', () => {
  it('refuses with reason "consent" and injects nothing without consent', async () => {
    const m = await load()
    await expect(m.loadAdScript('https://ads.test/sdk.js')).rejects.toMatchObject({ reason: 'consent', state: 'denied' })
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('injects one async script per src with the given attributes', async () => {
    consent.advertising = true
    const m = await load()
    const p1 = m.loadAdScript('https://ads.test/sdk.js', { attrs: { 'data-zone': '42' } })
    const p2 = m.loadAdScript('https://ads.test/sdk.js')
    expect(p2).toBe(p1)
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe('https://ads.test/sdk.js')
    expect(scripts[0].async).toBe(true)
    expect(scripts[0].getAttribute('data-zone')).toBe('42')
    scripts[0].onload()
    await expect(p1).resolves.toBeUndefined()
  })

  it('a failed load rejects with reason "network" and can be retried', async () => {
    consent.advertising = true
    const m = await load()
    const p = m.loadAdScript('https://ads.test/x.js')
    document.head.querySelector('script').onerror()
    await expect(p).rejects.toMatchObject({ reason: 'network' })
    const again = m.loadAdScript('https://ads.test/x.js')
    expect(again).not.toBe(p)
    expect(document.head.querySelectorAll('script')).toHaveLength(2)
  })
})
