// @vitest-environment jsdom
// Snapie chat sign-in (src/lib/snapieChat.js): which logins can sign the chat
// challenge, the background @threespeak signer with its per-login auth, the
// wallet fallback, and ButrAuth sessions handed to the SDK (warm-up users and
// graduated accounts). The chat SDK and aioha are mocked; fetch is stubbed.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  instances: [],
  provider: vi.fn(),
  mante: vi.fn(),
  sign: vi.fn(),
}))

vi.mock('@snapie/chat-client', () => ({
  ChatClient: class FakeChatClient {
    constructor(opts) {
      this.opts = opts
      h.instances.push(this)
    }
  },
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  default: { name: 'aioha' },
  signMessageWithAioha: h.sign,
  getCurrentProvider: h.provider,
  isManteAuthLogin: h.mante,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))
vi.mock('../../../src/utils/config', () => ({ EMBED_API_KEY: 'public-app-key' }))

import {
  SNAPIE_CHAT_BASE_URL,
  getChatClient,
  canSignChatChallenge,
  chatAuthUnavailableReason,
  isWarmupChatId,
  authenticateWarmupChat,
  authenticateChat,
  aioha,
} from '../../../src/lib/snapieChat.js'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

// The one shared client gets fresh method mocks before every test.
let client
beforeEach(() => {
  client = getChatClient()
  client.isAuthenticated = vi.fn(() => false)
  client.getUsername = vi.fn(() => null)
  client.logout = vi.fn()
  // authenticate(username, signer): runs the signer like the SDK does.
  client.authenticate = vi.fn(async (username, signer) => signer('challenge-uuid'))
  client.useSession = vi.fn()
  delete client.service
  h.provider.mockReset().mockReturnValue('keychain')
  h.mante.mockReset().mockReturnValue(false)
  h.sign.mockReset()
  localStorage.clear()
})

describe('the shared client', () => {
  it('is created once, against the same-origin proxy', () => {
    expect(getChatClient()).toBe(client)
    expect(h.instances).toHaveLength(1)
    expect(client.opts).toEqual({ baseUrl: '/snapie-chat' })
    expect(SNAPIE_CHAT_BASE_URL).toBe('/snapie-chat')
    expect(aioha).toEqual({ name: 'aioha' })
  })
})

describe('canSignChatChallenge and chatAuthUnavailableReason', () => {
  it.each([
    ['keychain', false, true],
    ['hiveauth', false, true],
    ['peakvault', false, true],
    ['ledger', false, true],
    ['hivesigner', false, false],
    ['keychain', true, false],
    [null, false, false],
  ])('provider %s, ButrAuth %s -> %s', (provider, mante, expected) => {
    h.provider.mockReturnValue(provider)
    h.mante.mockReturnValue(mante)
    expect(canSignChatChallenge()).toBe(expected)
  })

  it.each([
    ['a ButrAuth session', 'keychain', true, /Butter Auth/],
    ['HiveSigner', 'hivesigner', false, /HiveSigner/],
    ['anything else', null, false, /^Chat requires a wallet/],
  ])('explains why %s cannot sign', (_, provider, mante, pattern) => {
    h.provider.mockReturnValue(provider)
    h.mante.mockReturnValue(mante)
    expect(chatAuthUnavailableReason()).toMatch(pattern)
  })
})

describe('isWarmupChatId', () => {
  it.each([
    ['~abc123', true],
    ['alice', false],
    ['', false],
    [null, false],
    [42, false],
  ])('%s -> %s', (id, expected) => {
    expect(isWarmupChatId(id)).toBe(expected)
  })
})

describe('authenticateChat with the background signer', () => {
  it('reuses a session that is already signed in as this user', async () => {
    client.isAuthenticated.mockReturnValue(true)
    client.getUsername.mockReturnValue('alice')
    vi.stubGlobal('fetch', vi.fn())
    expect(await authenticateChat('alice')).toBe(client)
    expect(client.authenticate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('signs for a wallet login with the public app key and the claimed username', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { signature: 'bg-sig' }))
    vi.stubGlobal('fetch', f)
    client.authenticate.mockImplementation(async (user, signer) => {
      expect(await signer('uuid-1')).toBe('bg-sig')
    })
    expect(await authenticateChat('alice')).toBe(client)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/snapie-chat/sign-challenge')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'public-app-key' })
    expect(JSON.parse(init.body)).toEqual({ challenge: 'uuid-1', username: 'alice' })
    expect(init.credentials).toBe('include')
  })

  it('signs for HiveSigner with the bearer token and no username', async () => {
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'tok')
    const f = vi.fn().mockResolvedValue(json(200, { signature: 's' }))
    vi.stubGlobal('fetch', f)
    await authenticateChat('alice')
    const init = f.mock.calls[0][1]
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers['X-API-Key']).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ challenge: 'challenge-uuid' })
  })

  it('asks HiveSigner users to reconnect when the token is gone', async () => {
    h.provider.mockReturnValue('hivesigner')
    vi.stubGlobal('fetch', vi.fn())
    await expect(authenticateChat('alice')).rejects.toThrow(/HiveSigner session expired/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to a wallet signature when the background signer fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(403, { error: 'no posting grant' })))
    h.sign.mockResolvedValue({ success: true, result: 'wallet-sig' })
    const results = []
    // The background signer throws inside the first authenticate; the second
    // runs with the wallet signer.
    client.authenticate.mockImplementation(async (user, signer) => { results.push(await signer('uuid')) })
    expect(await authenticateChat('alice')).toBe(client)
    expect(client.authenticate).toHaveBeenCalledTimes(2)
    expect(h.sign).toHaveBeenCalledWith('uuid', 'posting', 'Sign in to 3Speak Chat')
    expect(results).toEqual(['wallet-sig'])
  })

  it('surfaces the background error when fallback is off or the login cannot sign', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, {})))
    await expect(authenticateChat('alice', { allowClientFallback: false })).rejects.toThrow('Could not sign the chat challenge')
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 't')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html') } }))
    await expect(authenticateChat('alice')).rejects.toThrow('Could not sign the chat challenge')
    expect(h.sign).not.toHaveBeenCalled()
  })

  it('says so when the wallet rejects the fallback signature', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(403, { error: 'nope' })))
    h.sign.mockResolvedValue({ success: false })
    await expect(authenticateChat('alice')).rejects.toThrow('Chat login signature was rejected.')
  })
})

describe('authenticateChat for a ButrAuth login', () => {
  beforeEach(() => h.mante.mockReturnValue(true))

  it('uses the ButrAuth session when it is for the same name', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { token: 'T', username: 'alice' }))
    vi.stubGlobal('fetch', f)
    expect(await authenticateChat('alice')).toBe(client)
    expect(f.mock.calls[0][0]).toBe('/api/snapie-chat/butrauth-session')
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' })
    expect(client.useSession).toHaveBeenCalledWith('T', 'alice')
    expect(client.authenticate).not.toHaveBeenCalled()
  })

  it('logs out of a session for another name and signs the challenge through the cookie', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { token: 'T', username: '~warm' }))
      .mockResolvedValueOnce(json(200, { signature: 'bg' }))
    vi.stubGlobal('fetch', f)
    await authenticateChat('alice')
    expect(client.logout).toHaveBeenCalled()
    // ButrAuth: no app key, no username; the cookie identifies the caller.
    const init = f.mock.calls[1][1]
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ challenge: 'challenge-uuid' })
  })

  it('falls through to the challenge when Snapie has no ButrAuth sign-in yet', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(404, {}))
      .mockResolvedValueOnce(json(200, { signature: 'bg' }))
    vi.stubGlobal('fetch', f)
    await authenticateChat('alice')
    expect(client.logout).not.toHaveBeenCalled()
    expect(client.authenticate).toHaveBeenCalledTimes(1)
  })
})

describe('authenticateWarmupChat', () => {
  it('reuses a stored warm-up session', async () => {
    client.isAuthenticated.mockReturnValue(true)
    client.getUsername.mockReturnValue('~u1')
    vi.stubGlobal('fetch', vi.fn())
    expect(await authenticateWarmupChat()).toBe(client)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stores the token for an older SDK without useSession', async () => {
    delete client.useSession
    client.service = {}
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { token: 'T', username: '~u1' })))
    await authenticateWarmupChat()
    expect(localStorage.getItem('snapie-chat-token')).toBe('T')
    expect(localStorage.getItem('snapie-chat-token-user')).toBe('~u1')
    expect(client.service).toEqual({ token: 'T', tokenUsername: '~u1' })
  })

  it('still adopts the session when storage is blocked', async () => {
    delete client.useSession
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { token: 'T', username: '~u1' })))
    await expect(authenticateWarmupChat()).resolves.toBe(client)
  })

  it('throws with the status when sign-in fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { error: 'not enabled' })))
    await expect(authenticateWarmupChat()).rejects.toMatchObject({ message: 'not enabled', status: 404 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('x') } }))
    await expect(authenticateWarmupChat()).rejects.toMatchObject({ message: 'Chat sign-in failed', status: 200 })
  })
})
