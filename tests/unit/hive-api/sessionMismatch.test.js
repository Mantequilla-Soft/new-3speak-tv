// The wallet sign-in behind /api/broadcast (src/hive-api/aioha.js): spotting a
// server session for another account (isSessionMismatch; the client then signs
// this wallet in too and retries, logging nobody out), waiting for Keychain to be
// injected, and never hanging on a signature (withTimeout).
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('@aioha/aioha', () => ({
  // Every method a no-op: the module only sets the client up when it loads.
  Aioha: class { constructor() { return new Proxy(this, { get: () => () => null }) } },
  Providers: { HiveSigner: 'hivesigner', Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', ViewOnly: 'viewonly' },
  KeyTypes: { Posting: 'posting', Active: 'active' },
  initAioha: () => ({}),
}))

const { isSessionMismatch, keychainReady, withTimeout } = await import('../../../src/hive-api/aioha.js')

describe('isSessionMismatch', () => {
  it('the server naming the logged-in account is a stale session from another login', () => {
    expect(isSessionMismatch(403, 'You do not hold posting authority over @badadib', 'badadib')).toBe(true)
    expect(isSessionMismatch(403, 'You do not hold posting authority over @BadAdib', 'badadib')).toBe(true)
  })

  it('the older wording still counts', () => {
    expect(isSessionMismatch(403, 'Operation not allowed', 'badadib')).toBe(true)
  })

  it('acting for ANOTHER account (a badge) is a real refusal, not a mismatch', () => {
    expect(isSessionMismatch(403, 'You do not hold posting authority over @somebadge', 'badadib')).toBe(false)
  })

  it('other refusals and statuses are not a mismatch', () => {
    expect(isSessionMismatch(403, 'Authorization required', 'badadib')).toBe(false)
    expect(isSessionMismatch(401, 'You do not hold posting authority over @badadib', 'badadib')).toBe(false)
    expect(isSessionMismatch(403, 'You do not hold posting authority over @badadib', null)).toBe(false)
  })
})

describe('keychainReady', () => {
  it('waits for the extension to inject window.hive_keychain', async () => {
    vi.useFakeTimers()
    delete window.hive_keychain
    const ready = keychainReady(5000)
    await vi.advanceTimersByTimeAsync(600)
    window.hive_keychain = {}
    await vi.advanceTimersByTimeAsync(400)
    await expect(ready).resolves.toBe(true)
    vi.useRealTimers()
    delete window.hive_keychain
  })

  it('gives up when there is no extension', async () => {
    vi.useFakeTimers()
    delete window.hive_keychain
    const ready = keychainReady(1000)
    await vi.advanceTimersByTimeAsync(1200)
    await expect(ready).resolves.toBe(false)
    vi.useRealTimers()
  })
})

describe('withTimeout', () => {
  it('a sign-in that never settles fails instead of hanging', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise(() => {}), 1000, 'Sign-in was not approved in time')
    const check = expect(p).rejects.toThrow('not approved in time')
    await vi.advanceTimersByTimeAsync(1000)
    await check
    vi.useRealTimers()
  })

  it('passes a result through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7)
  })
})
