// Social account verification (src/utils/socialVerifier.js): reading links and
// platforms, signing check and unlink requests with the posting key or, for
// HiveSigner and Butter Auth logins, through the 3Speak API, the warm-up user
// variant, and the per-platform profile links. HTTP and signing are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const instances = {}
  return {
    instances,
    create: vi.fn((cfg) => {
      const inst = { cfg, get: vi.fn(), post: vi.fn() }
      instances[cfg.baseURL] = inst
      return inst
    }),
    signMessage: vi.fn(),
    provider: vi.fn(),
    mante: vi.fn(),
  }
})
vi.mock('axios', () => ({ default: { create: h.create } }))
vi.mock('../../../src/hive-api/aioha', () => ({
  default: { signMessage: h.signMessage },
  KeyTypes: { Posting: 'posting' },
  Providers: { HiveSigner: 'hivesigner', Keychain: 'keychain' },
  getCurrentProvider: h.provider,
  isManteAuthLogin: h.mante,
}))
vi.mock('../../../src/utils/config', () => ({ SOCIAL_VERIFIER_URL: 'https://verifier.example' }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))

import {
  warmupSocial, getHash, getLinks, listPlatforms, checkLink, unlinkLink,
  PLATFORMS, platformProfileUrl, platformLabel,
} from '../../../src/utils/socialVerifier.js'

const verifier = () => h.instances['https://verifier.example']
const warmup = () => h.instances['/api']
const NOW = 1762300000000

let fetchMock
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const inst of Object.values(h.instances)) { inst.get.mockReset(); inst.post.mockReset() }
  h.signMessage.mockReset().mockResolvedValue({ result: 'SIG' })
  h.provider.mockReset().mockReturnValue('keychain')
  h.mante.mockReset().mockReturnValue(false)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'HS-TOKEN') })
})

describe('clients', () => {
  it('talks to the verifier, and to the 3Speak API with cookies for warm-up users', () => {
    expect(verifier().cfg).toEqual({ baseURL: 'https://verifier.example' })
    expect(warmup().cfg).toEqual({ baseURL: '/api', withCredentials: true })
  })
})

describe('reads', () => {
  it('getHash encodes the username', async () => {
    verifier().get.mockResolvedValue({ data: { hash: 'abc' } })
    expect(await getHash('a/b')).toEqual({ hash: 'abc' })
    expect(verifier().get).toHaveBeenCalledWith('/verify/hash/a%2Fb')
  })

  it('getLinks asks for pending links only when told to, and defaults to none', async () => {
    verifier().get.mockResolvedValueOnce({ data: { links: [{ platform: 'youtube' }] } }).mockResolvedValueOnce({ data: {} })
    expect(await getLinks('alice', { includePending: true })).toEqual([{ platform: 'youtube' }])
    expect(await getLinks('alice')).toEqual([])
    expect(verifier().get.mock.calls).toEqual([
      ['/verify/links/alice', { params: { include_pending: 'true' } }],
      ['/verify/links/alice', { params: undefined }],
    ])
  })

  it('listPlatforms defaults to an empty list', async () => {
    verifier().get.mockResolvedValueOnce({ data: { platforms: ['youtube'] } }).mockResolvedValueOnce({ data: null })
    expect(await listPlatforms()).toEqual(['youtube'])
    expect(await listPlatforms()).toEqual([])
  })
})

describe('signed requests with a key in the browser', () => {
  const link = { hive_username: 'Alice', platform: 'youtube', platform_username: 'UC123' }

  it.each([
    ['check', checkLink, '/verify/check'],
    ['unlink', unlinkLink, '/verify/unlink'],
  ])('%s signs action|user|platform|handle|time with the posting key', async (action, fn, path) => {
    verifier().get.mockResolvedValue({ data: { ok: true } })
    expect(await fn(link)).toEqual({ ok: true })
    expect(h.signMessage).toHaveBeenCalledWith(`3speak-social-verifier|${action}|alice|youtube|UC123|${NOW}`, 'posting')
    expect(verifier().get).toHaveBeenCalledWith(path, {
      params: { hive_username: 'Alice', platform: 'youtube', platform_username: 'UC123', timestamp: NOW, signature: 'SIG' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a wallet error', { error: 'Locked' }, 'Locked'],
    ['an empty answer', null, 'misc.social.signingCancelled'],
    ['no signature', { result: '' }, 'misc.social.signingCancelled'],
  ])('stops on %s and never calls the verifier', async (_name, answer, message) => {
    h.signMessage.mockResolvedValue(answer)
    await expect(checkLink(link)).rejects.toThrow(message)
    expect(verifier().get).not.toHaveBeenCalled()
  })

  it('handles missing fields when building the message', async () => {
    verifier().get.mockResolvedValue({ data: {} })
    await checkLink({})
    expect(h.signMessage.mock.calls[0][0]).toBe(`3speak-social-verifier|check||||${NOW}`)
  })
})

describe('signed requests through the 3Speak API', () => {
  const link = { hive_username: 'alice', platform: 'tiktok', platform_username: '@me' }
  const okSign = { ok: true, json: async () => ({ signature: 'SRV', timestamp: 42 }) }

  it('HiveSigner sends its token and uses the server signature', async () => {
    h.provider.mockReturnValue('hivesigner')
    fetchMock.mockResolvedValue(okSign)
    verifier().get.mockResolvedValue({ data: { ok: 1 } })
    await checkLink(link)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/verify/sign')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer HS-TOKEN', 'Content-Type': 'application/json' } })
    expect(JSON.parse(init.body)).toEqual({ action: 'check', platform: 'tiktok', platform_username: '@me' })
    expect(verifier().get.mock.calls[0][1].params).toMatchObject({ signature: 'SRV', timestamp: 42 })
    expect(h.signMessage).not.toHaveBeenCalled()
  })

  it('HiveSigner without a stored token still asks, without the header', async () => {
    h.provider.mockReturnValue('hivesigner')
    localStorage.getItem.mockReturnValue(null)
    fetchMock.mockResolvedValue(okSign)
    verifier().get.mockResolvedValue({ data: {} })
    await unlinkLink(link)
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('Butter Auth uses the server signature without a bearer token', async () => {
    h.mante.mockReturnValue(true)
    fetchMock.mockResolvedValue(okSign)
    verifier().get.mockResolvedValue({ data: {} })
    await unlinkLink(link)
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe('unlink')
  })

  it.each([
    ['the API error', { ok: false, json: async () => ({ error: 'No posting authority' }) }, 'No posting authority'],
    ['a generic message for unreadable JSON', { ok: false, json: async () => { throw new Error('html') } }, 'misc.social.signingCancelled'],
    ['a generic message for a missing signature', { ok: true, json: async () => ({}) }, 'misc.social.signingCancelled'],
  ])('a failed server signature surfaces %s', async (_name, res, message) => {
    h.mante.mockReturnValue(true)
    fetchMock.mockResolvedValue(res)
    await expect(checkLink(link)).rejects.toThrow(message)
    expect(verifier().get).not.toHaveBeenCalled()
  })
})

describe('warm-up users', () => {
  it('loads and checks through the 3Speak API', async () => {
    warmup().get.mockResolvedValue({ data: { code: 'X1', platforms: [], links: [] } })
    warmup().post.mockResolvedValue({ data: { status: 'verified' } })
    expect(await warmupSocial.load()).toEqual({ code: 'X1', platforms: [], links: [] })
    expect(await warmupSocial.check({ platform: 'youtube', platform_username: 'UC1', extra: 'dropped' })).toEqual({ status: 'verified' })
    expect(warmup().get).toHaveBeenCalledWith('/warmup/social')
    expect(warmup().post).toHaveBeenCalledWith('/warmup/social/verify', { platform: 'youtube', platform_username: 'UC1' })
  })

  it('unlink reports deleted, still present (409), or rethrows anything else', async () => {
    warmup().post.mockResolvedValueOnce({})
    expect(await warmupSocial.unlink({ platform: 'youtube', platform_username: 'UC1' })).toEqual({ deleted: true })

    warmup().post.mockRejectedValueOnce({ response: { status: 409, data: { status: 'still_present' } } })
    expect(await warmupSocial.unlink({ platform: 'youtube', platform_username: 'UC1' })).toEqual({ still_present: true })

    const other = { response: { status: 409, data: { status: 'conflict' } } }
    warmup().post.mockRejectedValueOnce(other)
    await expect(warmupSocial.unlink({})).rejects.toBe(other)
  })
})

describe('platforms', () => {
  it.each([
    ['youtube', 'UC123', 'https://www.youtube.com/channel/UC123', 'YouTube'],
    ['soundcloud', 'me', 'https://soundcloud.com/me', 'SoundCloud'],
    ['tiktok', 'me', 'https://www.tiktok.com/@me', 'TikTok'],
    ['instagram', 'me', 'https://www.instagram.com/me/', 'Instagram'],
    ['bitchute', 'ch1', 'https://www.bitchute.com/channel/ch1/', 'BitChute'],
    ['rumble', 'c/me', 'https://rumble.com/c/me', 'Rumble'],
  ])('%s links %s to %s and is called %s', (platform, canonical, url, label) => {
    expect(platformProfileUrl(platform, canonical)).toBe(url)
    expect(platformLabel(platform)).toBe(label)
    expect(PLATFORMS[platform].inputPlaceholderKey).toBe(`misc.social.${platform}.placeholder`)
  })

  it('an unknown platform has no link and keeps its own name', () => {
    expect(platformProfileUrl('myspace', 'x')).toBeNull()
    expect(platformLabel('myspace')).toBe('myspace')
  })
})
