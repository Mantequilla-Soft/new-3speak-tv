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

// The global comment mutelist (checker utils/commentMutes.js), in the same answer.
const replyingFlags = (hidden, muted) => vi.fn(async () => ({ json: async () => ({ hidden, muted }) }))

describe('muted authors (the comment mutelist)', () => {
  it('batchCheckFlags reads hidden and muted from one request, cached together', async () => {
    const fetch = replyingFlags(['spammer'], ['AI-Agent-Hunter'])
    vi.stubGlobal('fetch', fetch)
    const m = await load()
    const out = await m.batchCheckFlags(['fan', 'spammer', 'ai-agent-hunter'])
    expect([...out.hidden]).toEqual(['spammer'])
    expect([...out.muted]).toEqual(['ai-agent-hunter'])
    expect([...(await m.batchCheckHidden(['ai-agent-hunter', 'spammer']))]).toEqual(['spammer'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('an older checker without `muted` mutes nobody; an error mutes nobody', async () => {
    vi.stubGlobal('fetch', replying(['spammer']))
    let m = await load()
    expect((await m.batchCheckFlags(['ai-agent-hunter'])).muted.size).toBe(0)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    m = await load()
    const tree = [{ author: 'ai-agent-hunter', children: [{ author: 'fan' }] }]
    expect(m.dropMuted(await m.markByHidden(tree))).toEqual(tree)
  })

  it('markByHidden sets isMuted at every depth, never on the viewer\'s own comments', async () => {
    vi.stubGlobal('fetch', replyingFlags([], ['ai-agent-hunter', 'badadib']))
    const m = await load()
    const tree = [
      { author: 'fan', children: [{ author: { username: 'AI-Agent-Hunter' } }] },
      { author: 'badadib', replies: [{ author: 'ai-agent-hunter' }] },
    ]
    const out = await m.markByHidden(tree, { viewer: 'BadAdib' })
    expect(out[0].isMuted).toBeUndefined()
    expect(out[0].children[0].isMuted).toBe(true)
    expect(out[1].isMuted).toBeUndefined()
    expect(out[1].replies[0].isMuted).toBe(true)
    expect(out[0].isHidden).toBe(false)
  })

  it('dropMuted removes a muted comment with every reply under it, in both nestings', async () => {
    vi.stubGlobal('fetch', replyingFlags([], ['ai-agent-hunter']))
    const m = await load()
    const tree = [
      { author: 'fan', children: [{ author: 'ai-agent-hunter', children: [{ author: 'fan2' }] }, { author: 'fan3' }] },
      { author: 'ai-agent-hunter', children: [{ author: 'fan4' }] },
      { author: 'fan5', replies: [{ author: 'ai-agent-hunter' }] },
    ]
    const out = await m.markAndDropMuted(tree)
    expect(out.map((c) => c.author)).toEqual(['fan', 'fan5'])
    expect(out[0].children.map((c) => c.author)).toEqual(['fan3'])
    expect(out[1].replies).toEqual([])
    expect(tree).toHaveLength(3) // input untouched
    expect(m.dropMuted(null)).toEqual([])
  })
})
