// sessionVouch (src/lib/sessionVouch.js): our API's "we verified a session for @x"
// for the checker (listening progress, listener rewards, push choices). The API
// (fetch) and the wallet provider are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ provider: null }))
vi.mock('../../../src/hive-api/aioha', () => ({ getCurrentProvider: () => h.provider, Providers: { HiveSigner: 'hivesigner' } }))

const { fetchSessionVouch } = await import('../../../src/lib/sessionVouch.js')

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
let fetchMock

beforeEach(() => {
  h.provider = 'keychain'
  localStorage.clear()
  fetchMock = vi.fn(async () => reply(200, { username: 'alice', signature: 'SIG', timestamp: 42 }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('fetchSessionVouch', () => {
  it('asks for the action\'s session vouch with the session cookies', async () => {
    expect(await fetchSessionVouch('progress', 'alice')).toEqual({ user: 'alice', signature: 'SIG', timestamp: 42 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/podcasts/signature')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init.body)).toEqual({ action: 'progress', payload: 'session' })
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('named: tells the API which account it is for', async () => {
    await fetchSessionVouch('push', 'alice', { named: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'push', payload: 'session', username: 'alice' })
  })

  it('HiveSigner adds its token', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'TOK')
    await fetchSessionVouch('push', 'alice')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer TOK')
  })

  it.each([
    ['for another account', reply(200, { username: 'bob', signature: 'SIG', timestamp: 1 })],
    ['refused', reply(401, { reason: 'not_signed_in_as' })],
    ['without a signature', reply(200, { username: 'alice' })],
  ])('null when the answer is %s', async (_l, res) => {
    fetchMock.mockResolvedValueOnce(res)
    expect(await fetchSessionVouch('push', 'alice')).toBeNull()
  })

  it('null when the API is unreachable, and never asks for nobody', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await fetchSessionVouch('push', 'alice')).toBeNull()
    expect(await fetchSessionVouch('push', '')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
