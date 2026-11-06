// @vitest-environment jsdom
// avatarCache (src/utils/avatarCache.js): which picture to show for an account.
// The image we just uploaded wins, then the profile_image the chain says
// (fetched lazily and in batches), then Hive's day-cached proxy. Accounts Hive
// does not know get the 3Speak mark. Every test loads a fresh copy of the module
// over a clean localStorage, and the Hive node is a stubbed fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import bs58 from 'bs58'

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.example' }))

const DAY = 24 * 60 * 60 * 1000
let mod
let fetchMock
let accounts // what get_accounts answers: [{ name, posting_json_metadata, json_metadata }]

beforeEach(async () => {
  localStorage.clear()
  accounts = []
  fetchMock = vi.fn(async () => ({ json: async () => ({ result: accounts }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  mod = await import('../../../src/utils/avatarCache.js')
})

afterEach(() => vi.useRealTimers())

const withPicture = (name, url, field = 'posting_json_metadata') => ({ name, [field]: JSON.stringify({ profile: { profile_image: url } }) })
const proxied = (url) => {
  const m = url.match(/^\/img\/h\/p\/(\w+)\?format=jpeg&mode=cover&width=(\d+)&height=(\d+)$/)
  return m && { source: Buffer.from(bs58.decode(m[1])).toString(), w: +m[2], h: +m[3] }
}

describe('hiveAvatarUrl', () => {
  it.each([
    ['alice', undefined, '/img/u/alice/avatar/small'],
    ['@Alice ', 'medium', '/img/u/alice/avatar/medium'],
    ['alice', null, '/img/u/alice/avatar'],
    ['a/b', 'small', '/img/u/a%2Fb/avatar/small'],
  ])('%j at size %j is %s', (name, size, url) => {
    expect(mod.hiveAvatarUrl(name, size)).toBe(url)
  })
})

describe('cachedProfileImage', () => {
  it('serves art on any other host through our /img/u/ avatar cache', () => {
    expect(mod.cachedProfileImage('hive-1', 'https://files.peakd.com/art.png')).toBe('/img/u/hive-1/avatar/small')
  })

  it.each([
    ['small', 64],
    ['medium', 128],
    ['large', 512],
    ['huge', 128], // unknown sizes use the 128 px crop
  ])('square-crops our own images.3speak.tv art at the %s size (%i px)', (size, px) => {
    expect(mod.cachedProfileImage('alice', 'https://images.3speak.tv/u/a.png?v=2', size)).toBe(`/img/a/u/a.png?px=${px}`)
  })

  // BUG: cachedProfileImage trims the URL it hands to viaHiveProxy, so padded
  // metadata values are expected, but the own-host test (hiveProxyRefuses) runs
  // on the UNtrimmed value. Art on images.3speak.tv stored as " https://..."
  // (hand-edited json_metadata) goes to /img/u/<account>/avatar instead, which
  // is exactly the grey default face the module warns about.
  // src/utils/avatarCache.js:123
  it.skip('BUG: square-crops our own art even when the stored URL has surrounding spaces', () => {
    expect(mod.cachedProfileImage('alice', ' https://images.3speak.tv/u/a.png ')).toBe('/img/a/u/a.png?px=64')
  })
})

describe('avatar overrides', () => {
  it('remembers the uploaded image per account, case and @ insensitive, across reloads', async () => {
    mod.setAvatarOverride('@Alice', 'https://images.3speak.tv/new.png')
    expect(mod.getAvatarOverride('alice')).toBe('https://images.3speak.tv/new.png')

    vi.resetModules()
    const reloaded = await import('../../../src/utils/avatarCache.js')
    expect(reloaded.getAvatarOverride('ALICE')).toBe('https://images.3speak.tv/new.png')
  })

  it('ignores calls without a username', () => {
    mod.setAvatarOverride('', 'x')
    expect(mod.getAvatarOverride('')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('clears an override', () => {
    mod.setAvatarOverride('alice', 'x')
    mod.clearAvatarOverride('alice')
    expect(mod.getAvatarOverride('alice')).toBeNull()
  })

  it('forgets an override after a week, when the proxy has long caught up', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mod.setAvatarOverride('alice', 'x')
    vi.setSystemTime(Date.now() + 7 * DAY)
    expect(mod.getAvatarOverride('alice')).toBe('x')
    vi.setSystemTime(Date.now() + 1)
    expect(mod.getAvatarOverride('alice')).toBeNull()
    expect(JSON.parse(localStorage.getItem('3speak_avatar_override'))).toEqual({})
  })

  it('starts empty when the stored overrides are corrupt', async () => {
    localStorage.setItem('3speak_avatar_override', '{not json')
    vi.resetModules()
    const fresh = await import('../../../src/utils/avatarCache.js')
    expect(fresh.getAvatarOverride('alice')).toBeNull()
  })

  it('keeps working in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    mod.setAvatarOverride('alice', 'x')
    expect(mod.getAvatarOverride('alice')).toBe('x')
  })
})

describe('reconcileAvatarOverride', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mod.setAvatarOverride('alice', 'https://new.png')
  })

  it('does not judge within two minutes of the write, before the chain reads it back', () => {
    vi.setSystemTime(Date.now() + 119 * 1000)
    mod.reconcileAvatarOverride('alice', 'https://old.png')
    expect(mod.getAvatarOverride('alice')).toBe('https://new.png')
  })

  it('keeps the override when the chain agrees', () => {
    vi.setSystemTime(Date.now() + 5 * 60 * 1000)
    mod.reconcileAvatarOverride('alice', 'https://new.png')
    expect(mod.getAvatarOverride('alice')).toBe('https://new.png')
  })

  it.each([['https://elsewhere.png'], [''], [undefined]])('drops the override when the chain says %j', (chain) => {
    vi.setSystemTime(Date.now() + 5 * 60 * 1000)
    mod.reconcileAvatarOverride('alice', chain)
    expect(mod.getAvatarOverride('alice')).toBeNull()
  })

  it('ignores accounts without an override and empty names', () => {
    expect(() => {
      mod.reconcileAvatarOverride('bob', 'x')
      mod.reconcileAvatarOverride('', 'x')
    }).not.toThrow()
  })
})

describe('resolved avatars', () => {
  it('stores what the chain says, including "no picture", and survives a reload', async () => {
    mod.setResolvedAvatar('Alice', 'https://pic.png')
    mod.setResolvedAvatar('bob', '')
    expect(mod.getResolvedAvatar('alice')).toBe('https://pic.png')
    expect(mod.getResolvedAvatar('bob')).toBeNull()
    expect(mod.getResolvedAvatar('')).toBeNull()

    vi.resetModules()
    const reloaded = await import('../../../src/utils/avatarCache.js')
    expect(reloaded.getResolvedAvatar('alice')).toBe('https://pic.png')
  })

  it('does not rewrite storage when nothing changed', () => {
    mod.setResolvedAvatar('alice', 'https://pic.png')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    mod.setResolvedAvatar('alice', 'https://pic.png')
    mod.setResolvedAvatar('', 'x')
    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('useAvatarUrl', () => {
  it('shows the 3Speak mark when there is no account', () => {
    const { result } = renderHook(() => mod.useAvatarUrl(null))
    expect(result.current).toBe(mod.NO_ACCOUNT_AVATAR)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the image just uploaded before anything else', () => {
    mod.setResolvedAvatar('alice', 'https://old.png')
    mod.setAvatarOverride('alice', 'https://images.3speak.tv/fresh.png')
    const { result } = renderHook(() => mod.useAvatarUrl('alice'))
    expect(result.current).toBe('https://images.3speak.tv/fresh.png')
  })

  it.each([
    ['a raw upload on images.hive.blog, resized by the proxy', 'https://images.hive.blog/DQmAbc/me.jpg', 'proxy'],
    ['an already resized Hive URL, only cached', 'https://images.hive.blog/p/xyz?format=jpeg', '/img/h/p/xyz?format=jpeg'],
    ['a Hive avatar URL, only cached', 'https://images.hive.blog/u/alice/avatar', '/img/h/u/alice/avatar'],
    ['our own host, square-cropped', 'https://images.3speak.tv/a/b.png', '/img/a/a/b.png?px=64'],
    ['a relative path, as it is', '/local/me.png', '/local/me.png'],
  ])('serves a known picture on %s', (_label, picture, expected) => {
    mod.setResolvedAvatar('alice', picture)
    const { result } = renderHook(() => mod.useAvatarUrl('alice'))
    if (expected === 'proxy') expect(proxied(result.current)).toEqual({ source: picture, w: 64, h: 64 })
    else expect(result.current).toBe(expected)
  })

  it('resizes a picture on another host through Hive\'s proxy at the asked size', () => {
    mod.setResolvedAvatar('alice', 'https://ipfs.io/ipfs/Qm1')
    const { result } = renderHook(() => mod.useAvatarUrl('alice', 'large'))
    expect(proxied(result.current)).toEqual({ source: 'https://ipfs.io/ipfs/Qm1', w: 512, h: 512 })
  })

  it('shows the proxy now, then switches to the real picture once the batch lookup answers', async () => {
    accounts = [withPicture('alice', 'https://images.3speak.tv/me.png')]
    const { result } = renderHook(() => mod.useAvatarUrl('alice'))
    expect(result.current).toBe('/img/u/alice/avatar/small')
    await waitFor(() => expect(result.current).toBe('/img/a/me.png?px=64'))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://hive.example')
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [['alice']],
    })
  })

  it('asks about every account on screen in one request, once each', async () => {
    accounts = [withPicture('alice', 'https://a.png'), withPicture('bob', 'https://b.png')]
    renderHook(() => [mod.useAvatarUrl('alice'), mod.useAvatarUrl('Bob'), mod.useAvatarUrl('alice')])
    await waitFor(() => expect(mod.getResolvedAvatar('bob')).toBe('https://b.png'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).params).toEqual([['alice', 'bob']])
  })

  it('falls back to json_metadata when posting_json_metadata is not readable', async () => {
    accounts = [{ name: 'alice', posting_json_metadata: '{broken', json_metadata: JSON.stringify({ profile: { profile_image: ' https://j.png ' } }) }]
    renderHook(() => mod.useAvatarUrl('alice'))
    await waitFor(() => expect(mod.getResolvedAvatar('alice')).toBe('https://j.png'))
  })

  it('remembers an account with no picture, so it is not asked about again', async () => {
    accounts = [{ name: 'alice', posting_json_metadata: '{}' }]
    const first = renderHook(() => mod.useAvatarUrl('alice'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('3speak_avatar_resolved'))).toEqual({ alice: '' }))
    first.unmount()

    const { result } = renderHook(() => mod.useAvatarUrl('alice'))
    await act(() => new Promise((r) => setTimeout(r, 100)))
    expect(result.current).toBe('/img/u/alice/avatar/small')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the 3Speak mark for a name Hive does not know (a warm-up creator)', async () => {
    accounts = []
    const { result } = renderHook(() => mod.useAvatarUrl('warmup-creator'))
    await waitFor(() => expect(result.current).toBe(mod.NO_ACCOUNT_AVATAR))
    expect(Object.keys(JSON.parse(localStorage.getItem('3speak_avatar_nohive')))).toEqual(['warmup-creator'])
  })

  it('gives a missing account another chance after a day', async () => {
    localStorage.setItem('3speak_avatar_nohive', JSON.stringify({ fresh: Date.now() - 1000, stale: Date.now() - DAY - 1 }))
    vi.resetModules()
    const fresh = await import('../../../src/utils/avatarCache.js')
    accounts = [withPicture('stale', 'https://back.png')]
    const { result } = renderHook(() => [fresh.useAvatarUrl('fresh'), fresh.useAvatarUrl('stale')])
    expect(result.current[0]).toBe(fresh.NO_ACCOUNT_AVATAR)
    await waitFor(() => expect(fresh.getResolvedAvatar('stale')).toBe('https://back.png'))
  })

  it.each([
    ['the node is unreachable', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
    ['the node answers with an error', () => fetchMock.mockResolvedValueOnce({ json: async () => ({ error: { code: -32000 } }) })],
  ])('keeps the proxy URL and marks nobody missing when %s', async (_label, arrange) => {
    arrange()
    const { result } = renderHook(() => mod.useAvatarUrl('alice'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(result.current).toBe('/img/u/alice/avatar/small')
    expect(localStorage.getItem('3speak_avatar_nohive')).toBeNull()
  })
})
