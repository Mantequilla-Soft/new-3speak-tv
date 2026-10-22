// Cookie / storage consent: categories, the resume-position purge on decline,
// and the write-guard that drops 3speak_pos_* keys without functional consent
// (src/lib/consent.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const ORIGINAL_SET_ITEM = Storage.prototype.setItem

async function load({ ads = false } = {}) {
  vi.resetModules()
  if (ads) vi.stubEnv('VITE_ENABLE_THIRDPARTY_ADS', 'true')
  return import('../../../src/lib/consent.js')
}

beforeEach(() => {
  Storage.prototype.setItem = ORIGINAL_SET_ITEM
  delete Storage.prototype.__consentGuarded
  localStorage.clear()
  sessionStorage.clear()
})

describe('before the banner is answered', () => {
  it('nothing is decided, essential is on, functional and advertising are off', async () => {
    const c = await load()
    expect(c.hasDecided()).toBe(false)
    expect(c.hasConsent('essential')).toBe(true)
    expect(c.hasConsent('functional')).toBe(false)
    expect(c.hasConsent('advertising')).toBe(false)
    expect(c.hasConsent('made-up')).toBe(false)
  })
})

describe('setConsent', () => {
  it('records the choice with a version and timestamp', async () => {
    const c = await load()
    c.setConsent({ functional: true })
    const stored = JSON.parse(localStorage.getItem('3speak_cookie_consent'))
    expect(stored).toMatchObject({ version: 1, essential: true, functional: true, advertising: false })
    expect(typeof stored.decidedAt).toBe('string')
    expect(c.hasDecided()).toBe(true)
    expect(c.hasConsent('functional')).toBe(true)
  })

  it('declining functional purges every saved resume position and nothing else', async () => {
    const c = await load()
    localStorage.setItem('3speak_pos_alice/a', '12')
    localStorage.setItem('3speak_pos_bob/b', '40')
    localStorage.setItem('user-store', '{}')
    c.setConsent({ functional: false })
    expect(localStorage.getItem('3speak_pos_alice/a')).toBeNull()
    expect(localStorage.getItem('3speak_pos_bob/b')).toBeNull()
    expect(localStorage.getItem('user-store')).toBe('{}')
  })

  it('advertising consent is pinned to false while third-party ads are off', async () => {
    const c = await load()
    c.setConsent({ functional: true, advertising: true })
    expect(JSON.parse(localStorage.getItem('3speak_cookie_consent')).advertising).toBe(false)
    expect(c.hasConsent('advertising')).toBe(false)
  })

  it('a stored advertising yes from an ads-enabled build is ignored once the flag is off', async () => {
    localStorage.setItem('3speak_cookie_consent', JSON.stringify({ version: 1, essential: true, functional: true, advertising: true }))
    const c = await load()
    expect(c.hasConsent('advertising')).toBe(false)
  })

  it('with third-party ads on, advertising is its own opt-in', async () => {
    const c = await load({ ads: true })
    c.setConsent({ functional: false, advertising: true })
    expect(c.hasConsent('advertising')).toBe(true)
    c.setConsent({ functional: false, advertising: false })
    expect(c.hasConsent('advertising')).toBe(false)
  })
})

describe('schema version', () => {
  it('switching third-party ads on re-asks everyone (an old Accept does not carry over)', async () => {
    const off = await load()
    off.setConsent({ functional: true })
    const on = await load({ ads: true })
    expect(on.hasDecided()).toBe(false)
    expect(on.hasConsent('functional')).toBe(false)
  })

  it('treats corrupt storage as undecided', async () => {
    localStorage.setItem('3speak_cookie_consent', '{nope')
    const c = await load()
    expect(c.hasDecided()).toBe(false)
  })
})

describe('purgeFunctionalStorage', () => {
  it('returns how many keys it removed', async () => {
    const c = await load()
    localStorage.setItem('3speak_pos_a/1', '1')
    localStorage.setItem('3speak_pos_a/2', '1')
    localStorage.setItem('3speak_vote_weight_post', '50')
    expect(c.purgeFunctionalStorage()).toBe(2)
    expect(localStorage.length).toBe(1)
  })
})

describe('installStorageGuard', () => {
  it('drops resume-position writes without functional consent and lets everything else through', async () => {
    const c = await load()
    c.installStorageGuard()
    localStorage.setItem('3speak_pos_alice/a', '12')
    localStorage.setItem('theme', 'dark')
    expect(localStorage.getItem('3speak_pos_alice/a')).toBeNull()
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('lifts the block as soon as functional consent is given, with no reload', async () => {
    const c = await load()
    c.installStorageGuard()
    c.setConsent({ functional: true })
    localStorage.setItem('3speak_pos_alice/a', '12')
    expect(localStorage.getItem('3speak_pos_alice/a')).toBe('12')
    c.setConsent({ functional: false })
    expect(localStorage.getItem('3speak_pos_alice/a')).toBeNull()
    localStorage.setItem('3speak_pos_alice/a', '13')
    expect(localStorage.getItem('3speak_pos_alice/a')).toBeNull()
  })

  it('patches the prototype only once', async () => {
    const c = await load()
    c.installStorageGuard()
    const patched = Storage.prototype.setItem
    c.installStorageGuard()
    const again = await load()
    again.installStorageGuard()
    expect(Storage.prototype.setItem).toBe(patched)
  })
})

describe('enforceConsentOnStart', () => {
  it('purges leftovers when the user declined earlier', async () => {
    localStorage.setItem('3speak_cookie_consent', JSON.stringify({ version: 1, essential: true, functional: false }))
    localStorage.setItem('3speak_pos_x/y', '5')
    const c = await load()
    c.enforceConsentOnStart()
    expect(localStorage.getItem('3speak_pos_x/y')).toBeNull()
  })

  it('keeps positions for someone who accepted', async () => {
    localStorage.setItem('3speak_cookie_consent', JSON.stringify({ version: 1, essential: true, functional: true }))
    localStorage.setItem('3speak_pos_x/y', '5')
    const c = await load()
    c.enforceConsentOnStart()
    expect(localStorage.getItem('3speak_pos_x/y')).toBe('5')
  })
})
