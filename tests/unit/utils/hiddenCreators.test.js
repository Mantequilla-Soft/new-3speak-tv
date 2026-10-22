// Comments by hidden creators (src/utils/hiddenCreators.js): one bulk lookup,
// cached per name, fail-open, and every node in the tree tagged.
import { describe, it, expect, vi } from 'vitest'

const load = async () => {
  vi.resetModules()
  vi.doMock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))
  return import('../../../src/utils/hiddenCreators.js')
}

const replying = (hidden) => vi.fn(async () => ({ json: async () => ({ hidden }) }))

describe('batchCheckHidden', () => {
  it('asks once for the unique lowercased names and returns the hidden ones', async () => {
    const fetch = replying(['Spammer'])
    vi.stubGlobal('fetch', fetch)
    const m = await load()
    const out = await m.batchCheckHidden(['Alice', 'spammer', { username: 'SPAMMER' }, null, ''])
    expect([...out]).toEqual(['spammer'])
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://checker.test/check-hidden')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ usernames: ['alice', 'spammer'] })
  })

  it('caches answers, hidden or not, for five minutes', async () => {
    vi.useFakeTimers()
    try {
      const fetch = replying(['spammer'])
      vi.stubGlobal('fetch', fetch)
      const m = await load()
      await m.batchCheckHidden(['alice', 'spammer'])
      const again = await m.batchCheckHidden(['alice', 'spammer'])
      expect([...again]).toEqual(['spammer'])
      expect(fetch).toHaveBeenCalledTimes(1)
      await m.batchCheckHidden(['alice', 'bob'])
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ usernames: ['bob'] })
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      await m.batchCheckHidden(['alice'])
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open: a network error or a broken reply hides nobody', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    let m = await load()
    expect((await m.batchCheckHidden(['alice'])).size).toBe(0)

    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => { throw new SyntaxError('bad') } })))
    m = await load()
    expect((await m.batchCheckHidden(['alice'])).size).toBe(0)
  })

  it('does not call the network for an empty list', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const m = await load()
    expect((await m.batchCheckHidden([])).size).toBe(0)
    expect((await m.batchCheckHidden(undefined)).size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('markByHidden', () => {
  it('tags every comment in the tree, children and replies alike', async () => {
    vi.stubGlobal('fetch', replying(['spammer']))
    const m = await load()
    const tree = [
      { author: 'alice', children: [{ author: 'Spammer' }, { author: { username: 'bob' }, replies: [{ author: { username: 'spammer' } }] }] },
      { author: 'spammer' },
    ]
    const out = await m.markByHidden(tree)
    expect(out[0].isHidden).toBe(false)
    expect(out[0].children[0].isHidden).toBe(true)
    expect(out[0].children[1].isHidden).toBe(false)
    expect(out[0].children[1].replies[0].isHidden).toBe(true)
    expect(out[1].isHidden).toBe(true)
    expect(tree[1].isHidden).toBeUndefined()
  })

  it('returns the thread untouched when nobody on it is hidden', async () => {
    vi.stubGlobal('fetch', replying([]))
    const m = await load()
    const tree = [{ author: 'alice' }]
    expect(await m.markByHidden(tree)).toBe(tree)
    expect(await m.markByHidden([])).toEqual([])
    expect(await m.markByHidden(null)).toEqual([])
  })
})

describe('isCreatorHidden', () => {
  it('answers for one name, case-insensitively', async () => {
    vi.stubGlobal('fetch', replying(['spammer']))
    const m = await load()
    expect(await m.isCreatorHidden('SpAmMeR')).toBe(true)
    expect(await m.isCreatorHidden('alice')).toBe(false)
    expect(await m.isCreatorHidden('')).toBe(false)
  })
})
