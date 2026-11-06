// Drafts sessions for the embedded editors (src/utils/editorDraftSession.js):
// a token only for a verified session of the same account, a silent sign-in for
// HiveSigner, a wallet sign-in only when the person asked, and a reason the
// caller can show when there is no session. fetch and the wallet are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ establish: vi.fn(), provider: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({
  establishWalletSession: h.establish,
  getCurrentProvider: h.provider,
  Providers: { HiveSigner: 'hivesigner' },
}))

import { mintDraftSession } from '../../../src/utils/editorDraftSession.js'

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  h.establish.mockReset().mockResolvedValue(true)
  h.provider.mockReset().mockReturnValue('keychain')
})

describe('mintDraftSession', () => {
  it('is logged-out without a user, asking nothing', async () => {
    expect(await mintDraftSession('', true)).toEqual({ session: null, reason: 'logged-out' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks our server for a token for the lower-cased account, with cookies', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: 'alice', token: 'T' }))
    expect(await mintDraftSession('Alice', false)).toEqual({ session: { user: 'alice', token: 'T' }, reason: null })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/editor-token')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init.body)).toEqual({ user: 'alice' })
  })

  it('never opens another account\'s drafts with a stale cookie', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: 'mallory', token: 'T' }))
    expect(await mintDraftSession('alice', false)).toEqual({ session: null, reason: 'sign-in-needed' })
  })

  it('signs in with the wallet and retries only when the person asked', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { user: 'alice' }))
    expect(await mintDraftSession('alice', true)).toEqual({ session: { user: 'alice' }, reason: null })
    expect(h.establish).toHaveBeenCalledWith('alice')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never pops the wallet up uninvited, and says a sign-in is needed', async () => {
    fetchMock.mockResolvedValue(reply(401, {}))
    expect(await mintDraftSession('alice', false)).toEqual({ session: null, reason: 'sign-in-needed' })
    expect(h.establish).not.toHaveBeenCalled()
  })

  it('HiveSigner gets its session silently', async () => {
    h.provider.mockReturnValue('hivesigner')
    fetchMock.mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { user: 'alice' }))
    expect((await mintDraftSession('alice', false)).session).toEqual({ user: 'alice' })
  })

  it('reports a declined or failed sign-in', async () => {
    h.establish.mockRejectedValue(new Error('declined'))
    fetchMock.mockResolvedValue(reply(401, {}))
    expect(await mintDraftSession('alice', true)).toEqual({ session: null, reason: 'sign-in-failed' })
  })

  it.each([
    ['the server is unreachable', () => fetchMock.mockRejectedValue(new TypeError('offline'))],
    ['the server errors', () => fetchMock.mockResolvedValue(reply(500, {}))],
  ])('is unavailable when %s', async (_name, arrange) => {
    arrange()
    expect(await mintDraftSession('alice', true)).toEqual({ session: null, reason: 'unavailable' })
  })

  it('treats an unreadable token answer as no session', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('html') } })
    expect(await mintDraftSession('alice', true)).toEqual({ session: null, reason: 'sign-in-failed' })
  })
})
