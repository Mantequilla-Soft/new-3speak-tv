// scheduledPostProof (src/utils/scheduledPostProof.js): the owner's signature for
// the checker's scheduled-post create/update/cancel. Our API signs for every login
// it can prove; a wallet login signs in once and asks again, then signs itself; a
// proof that cannot be had still lets the write through unsigned while the checker
// takes that. Our API (fetch) and the wallet are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  provider: null, user: null, butr: false,
  establishWalletSession: null, signMessageWithAioha: null,
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  establishWalletSession: (...a) => h.establishWalletSession(...a),
  signMessageWithAioha: (...a) => h.signMessageWithAioha(...a),
  getCurrentProvider: () => h.provider,
  getCurrentUser: () => h.user,
  isManteAuthLogin: () => h.butr,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))
vi.mock('../../../src/i18n', () => ({ t: (k, o) => (o ? `${k} ${JSON.stringify(o)}` : k) }))

const {
  scheduledPostMessage, scheduledPostProof, proveScheduledPost, scheduledPostWriteError,
  ScheduledPostProofError, SCHEDULED_POST_UNSIGNED_FALLBACK,
} = await import('../../../src/utils/scheduledPostProof.js')

const AT = '2026-12-01T10:00:00.000Z'
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const signed = (username = 'alice') => reply(200, { success: true, username, signature: 'SIG', timestamp: 1234 })
let fetchMock
const calls = () => fetchMock.mock.calls
const bodyOf = (i = 0) => JSON.parse(calls()[i][1].body)

beforeEach(() => {
  Object.assign(h, {
    provider: 'keychain', user: 'alice', butr: false,
    establishWalletSession: vi.fn(async () => true),
    signMessageWithAioha: vi.fn(async () => ({ success: true, result: 'WALLET-SIG' })),
  })
  fetchMock = vi.fn(async () => signed())
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
})

describe('the signed message', () => {
  it('matches the checker: create carries scheduledOn as sent, update and cancel do not', () => {
    expect(scheduledPostMessage({ action: 'create', owner: 'alice', permlink: 'p-1', scheduledOn: AT, timestamp: 5 }))
      .toBe(`scheduled-post|create|alice|p-1|${AT}|5`)
    expect(scheduledPostMessage({ action: 'update', owner: 'alice', permlink: 'p-1', scheduledOn: AT, timestamp: 5 }))
      .toBe('scheduled-post|update|alice|p-1|5')
    expect(scheduledPostMessage({ action: 'cancel', owner: 'alice', permlink: 'p-1', timestamp: 5 }))
      .toBe('scheduled-post|cancel|alice|p-1|5')
  })
})

describe('signed by our API', () => {
  it('asks for exactly the write, with the session cookies', async () => {
    expect(await scheduledPostProof({ action: 'create', owner: 'alice', permlink: 'p-1', scheduledOn: AT })).toEqual({ signature: 'SIG', timestamp: 1234 })
    const [url, init] = calls()[0]
    expect(url).toBe('/api/scheduled-posts/signature')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(init.headers.Authorization).toBeUndefined()
    expect(bodyOf()).toEqual({ action: 'create', owner: 'alice', permlink: 'p-1', scheduledOn: AT })
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('update and cancel send no scheduledOn', async () => {
    await scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1', scheduledOn: AT })
    expect(bodyOf()).toEqual({ action: 'cancel', owner: 'alice', permlink: 'p-1' })
  })

  it('HiveSigner sends its token as a Bearer', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'HS-TOKEN')
    await scheduledPostProof({ action: 'update', owner: 'alice', permlink: 'p-1' })
    expect(calls()[0][1].headers.Authorization).toBe('Bearer HS-TOKEN')
  })

  it('Butter Auth: the cookie only, even with a HiveSigner login parked in the wallet', async () => {
    h.butr = true
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'HS-TOKEN')
    await scheduledPostProof({ action: 'update', owner: 'alice', permlink: 'p-1' })
    expect(calls()[0][1].headers.Authorization).toBeUndefined()
  })

  it('a wallet with no session for the owner signs in once and asks again', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { reason: 'not_signed_in_as' }))
    expect(await scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).toEqual({ signature: 'SIG', timestamp: 1234 })
    expect(h.establishWalletSession).toHaveBeenCalledWith('alice')
    expect(calls()).toHaveLength(2)
  })

  it.each([[true, 'hivesigner'], [false, 'hivesigner']])('no wallet sign-in for Butter Auth or HiveSigner (butr %s)', async (butr, provider) => {
    Object.assign(h, { butr, provider: butr ? null : provider })
    fetchMock.mockResolvedValue(reply(401, { reason: 'not_signed_in_as' }))
    await expect(scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).rejects.toMatchObject({ reason: 'not_signed_in_as' })
    expect(h.establishWalletSession).not.toHaveBeenCalled()
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('never uses a proof made for another account', async () => {
    h.provider = 'hivesigner'
    fetchMock.mockResolvedValue(signed('bob'))
    const err = await scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' }).catch((e) => e)
    expect(err).toBeInstanceOf(ScheduledPostProofError)
    expect(err.reason).toBe('not_signed_in_as')
    expect(err.message).toBe('studio.scheduled.proof.notSignedIn {"owner":"alice"}')
  })

  it.each([
    [reply(403, { reason: 'no_grant' }), 'no_grant', 'studio.scheduled.proof.noGrant'],
    [reply(502, {}), 'unavailable', 'studio.scheduled.proof.unavailable'],
    [reply(200, { success: true }), 'unavailable', 'studio.scheduled.proof.unavailable'],
  ])('says why when it cannot sign (%#)', async (res, reason, message) => {
    h.provider = 'hivesigner'
    fetchMock.mockResolvedValue(res)
    await expect(scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).rejects.toMatchObject({ reason, message })
  })

  it('a network failure is "unavailable"', async () => {
    h.provider = 'hivesigner'
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).rejects.toMatchObject({ reason: 'unavailable' })
  })
})

describe('signed by the wallet when our API cannot', () => {
  beforeEach(() => { fetchMock.mockResolvedValue(reply(503, {})) })

  it.each(['keychain', 'hiveauth', 'peakvault', 'ledger'])('%s signs the exact message with the posting key', async (provider) => {
    h.provider = provider
    vi.spyOn(Date, 'now').mockReturnValue(777)
    expect(await scheduledPostProof({ action: 'create', owner: 'alice', permlink: 'p-1', scheduledOn: AT })).toEqual({ signature: 'WALLET-SIG', timestamp: 777 })
    expect(h.signMessageWithAioha).toHaveBeenCalledWith(`scheduled-post|create|alice|p-1|${AT}|777`, 'posting', 'studio.scheduled.proof.walletPrompt')
  })

  it('not when the wallet holds another account', async () => {
    h.user = 'bob'
    await expect(scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).rejects.toMatchObject({ reason: 'unavailable' })
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('a declined prompt keeps our API\'s reason', async () => {
    fetchMock.mockResolvedValue(reply(403, { reason: 'no_grant' }))
    h.signMessageWithAioha = vi.fn(async () => ({ success: false, error: 'declined' }))
    await expect(scheduledPostProof({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).rejects.toMatchObject({ reason: 'no_grant' })
  })
})

describe('proveScheduledPost: the write never waits on a proof while the checker does not', () => {
  it('is on until the checker enforces signatures', () => {
    expect(SCHEDULED_POST_UNSIGNED_FALLBACK).toBe(true)
  })

  it('gives the proof to spread into the body', async () => {
    expect(await proveScheduledPost({ action: 'update', owner: 'alice', permlink: 'p-1' })).toEqual({ signature: 'SIG', timestamp: 1234 })
  })

  it('without one: nothing to add, and a console warning', async () => {
    h.provider = 'hivesigner'
    fetchMock.mockResolvedValue(reply(401, {}))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await proveScheduledPost({ action: 'cancel', owner: 'alice', permlink: 'p-1' })).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no owner signature for the cancel of @alice\/p-1 \(not_signed_in_as\).*unsigned/))
  })
})

describe('scheduledPostWriteError', () => {
  it('turns a failed write into something to show', () => {
    expect(scheduledPostWriteError(new ScheduledPostProofError('no_grant', 'alice'), 'x')).toBe('studio.scheduled.proof.noGrant')
    expect(scheduledPostWriteError({ response: { status: 401, data: { error: 'Signature required' } } }, 'x')).toBe('studio.scheduled.proof.refused')
    expect(scheduledPostWriteError({ response: { status: 422, data: { error: 'too soon' } } }, 'x')).toBe('too soon')
    expect(scheduledPostWriteError(new Error('boom'), 'x')).toBe('boom')
    expect(scheduledPostWriteError(null, 'fallback')).toBe('fallback')
  })
})
