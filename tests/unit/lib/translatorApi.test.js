// @vitest-environment jsdom
// The translation editor's API calls (src/lib/translatorApi.js): cookies on
// every call, a HiveSigner bearer token when there is one, a single wallet
// sign-in and retry when a write comes back 401, and reads that never throw.
// fetch and the login helpers are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ provider: vi.fn(), establish: vi.fn(), user: vi.fn(), mante: vi.fn() }))
vi.mock('@aioha/aioha', () => ({ Providers: { HiveSigner: 'hivesigner' } }))
vi.mock('../../../src/hive-api/aioha', () => ({
  getCurrentProvider: h.provider,
  establishWalletSession: h.establish,
  getOperationUser: h.user,
  isManteAuthLogin: h.mante,
}))

import {
  fetchTranslatorStatus, isTranslatorName, verifyAccount, saveStrings, addLanguage, fetchProofread, saveProofread,
} from '../../../src/lib/translatorApi.js'

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })

let fetchMock
beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => reply(200, {}))
  vi.stubGlobal('fetch', fetchMock)
  h.provider.mockReset().mockReturnValue('keychain')
  h.establish.mockReset().mockResolvedValue(true)
  h.user.mockReset().mockReturnValue('alice')
  h.mante.mockReset().mockReturnValue(false)
})

describe('requests', () => {
  it('reads send cookies, skip the cache and carry no body', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: 'alice', translator: true }))
    await fetchTranslatorStatus()
    expect(fetchMock).toHaveBeenCalledWith('/api/i18n/me', {
      method: 'GET', credentials: 'include', cache: 'no-store', headers: {}, body: undefined,
    })
  })

  it('writes send JSON, and HiveSigner logins add their token', async () => {
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'TOK')
    await saveStrings('pt-BR', { 'a.b': 'x' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/i18n/strings/pt-BR')
    expect(init).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer TOK' } })
    expect(JSON.parse(init.body)).toEqual({ changes: { 'a.b': 'x' } })
  })

  it('a HiveSigner login without a token, or blocked storage, sends no auth header', async () => {
    h.provider.mockReturnValue('hivesigner')
    await addLanguage({ code: 'xq' })
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    await addLanguage({ code: 'xq' })
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json' })
  })
})

describe('writes and the wallet session', () => {
  it('a 401 establishes a wallet session once and retries', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'unauthenticated' })).mockResolvedValueOnce(reply(200, { marks: {} }))
    expect(await saveProofread('de', { 'a.b': { checked: true } })).toEqual({ ok: true, status: 200, data: { marks: {} } })
    expect(h.establish).toHaveBeenCalledWith('alice')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/i18n/proofread/de')
  })

  it('does not retry when the user declines the sign-in', async () => {
    h.establish.mockResolvedValue(false)
    fetchMock.mockResolvedValue(reply(401, {}))
    expect(await addLanguage({ code: 'xq' })).toEqual({ ok: false, status: 401, data: {} })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Butter Auth sessions never get a wallet prompt', async () => {
    h.mante.mockReturnValue(true)
    fetchMock.mockResolvedValue(reply(401, {}))
    await saveStrings('de', {})
    expect(h.establish).not.toHaveBeenCalled()
  })

  it('other errors come back as they are, with unreadable bodies as {}', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => { throw new Error('x') } })
    expect(await saveStrings('de', {})).toEqual({ ok: false, status: 400, data: {} })
    expect(h.establish).not.toHaveBeenCalled()
  })
})

describe('reads never throw', () => {
  it.each([
    ['a translator', reply(200, { user: 'alice', translator: true }), { user: 'alice', translator: true }],
    ['a signed-in non-translator', reply(200, { user: 'bob', translator: 'yes' }), { user: 'bob', translator: false }],
    ['signed out', reply(401, {}), { user: null, translator: false }],
    ['an empty answer', reply(200, null), { user: null, translator: false }],
  ])('status for %s', async (_name, res, out) => {
    fetchMock.mockResolvedValue(res)
    expect(await fetchTranslatorStatus()).toEqual(out)
  })

  it('status with the API down', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    expect(await fetchTranslatorStatus()).toEqual({ user: null, translator: false })
  })

  it('isTranslatorName asks about one name and is false on any doubt', async () => {
    expect(await isTranslatorName('')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(reply(200, { translator: true }))
    expect(await isTranslatorName('a b')).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/i18n/translator/a%20b')
    fetchMock.mockResolvedValueOnce(reply(404, { translator: true }))
    expect(await isTranslatorName('x')).toBe(false)
    fetchMock.mockRejectedValueOnce(new Error('down'))
    expect(await isTranslatorName('x')).toBe(false)
  })

  it('fetchProofread returns the marks, or an empty failure', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { marks: { 'a.b': {} } }))
    expect(await fetchProofread('de')).toEqual({ ok: true, status: 200, data: { marks: { 'a.b': {} } } })
    fetchMock.mockRejectedValueOnce(new Error('down'))
    expect(await fetchProofread('de')).toEqual({ ok: false, status: 0, data: {} })
  })
})

describe('verifyAccount', () => {
  it('signs in the wallet account', async () => {
    expect(await verifyAccount()).toBe(true)
    expect(h.establish).toHaveBeenCalledWith('alice')
  })

  it('is false for Butter Auth and when the wallet fails', async () => {
    h.mante.mockReturnValueOnce(true)
    expect(await verifyAccount()).toBe(false)
    h.establish.mockRejectedValueOnce(new Error('rejected'))
    expect(await verifyAccount()).toBe(false)
  })
})
