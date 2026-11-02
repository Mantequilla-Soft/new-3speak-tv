// /api/broadcast refusing because its session cookie belongs to another account
// (src/hive-api/aioha.js isSessionMismatch): the client then clears the stale
// session and retries as the logged-in user. A playlist add as @badadib failed
// with "You do not hold posting authority over @badadib" because only the older
// "Operation not allowed" wording was recognised.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('@aioha/aioha', () => ({
  // Every method a no-op: the module only sets the client up when it loads.
  Aioha: class { constructor() { return new Proxy(this, { get: () => () => null }) } },
  Providers: { HiveSigner: 'hivesigner', Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', ViewOnly: 'viewonly' },
  KeyTypes: { Posting: 'posting', Active: 'active' },
  initAioha: () => ({}),
}))

const { isSessionMismatch } = await import('../../../src/hive-api/aioha.js')

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
