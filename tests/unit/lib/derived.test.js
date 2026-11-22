// "Made from this" (src/lib/derived.js): the source every derived post names in
// json_metadata['3speak'].source, registering it with the checker, the list.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { derivedSource, withSource, splitRef, registerDerived, fetchDerived, derivedHref, DERIVED_KINDS } from '../../../src/lib/derived'

describe('derivedSource', () => {
  it('cleans what it is given', () => {
    expect(derivedSource({ kind: 'clip', author: '@Alice', permlink: 'my-video', start: 12.34, end: 40 }))
      .toEqual({ kind: 'clip', author: 'alice', permlink: 'my-video', start: 12.3, end: 40 })
  })

  it('null for an unknown kind, a bad account or permlink', () => {
    expect(derivedSource({ kind: 'nope', author: 'alice', permlink: 'p' })).toBeNull()
    expect(derivedSource({ kind: 'clip', author: 'a', permlink: 'p' })).toBeNull()
    expect(derivedSource({ kind: 'clip', author: 'alice', permlink: 'Not OK' })).toBeNull()
    expect(derivedSource()).toBeNull()
  })

  it('never a snaps container (Shorts reply under it)', () => {
    expect(derivedSource({ kind: 'reaction', author: 'peak.snaps', permlink: 'snap-container-179' })).toBeNull()
    expect(derivedSource({ kind: 'reaction', author: 'threespeak', permlink: 'snap-container-1' })).toBeNull()
  })

  it('drops times out of range and an end before the start', () => {
    expect(derivedSource({ kind: 'clip', author: 'alice', permlink: 'p', start: 50, end: 20 })).toEqual({ kind: 'clip', author: 'alice', permlink: 'p', start: 50 })
    expect(derivedSource({ kind: 'clip', author: 'alice', permlink: 'p', start: -3, end: null })).toEqual({ kind: 'clip', author: 'alice', permlink: 'p' })
    expect(derivedSource({ kind: 'clip', author: 'alice', permlink: 'p', start: 0 })).toEqual({ kind: 'clip', author: 'alice', permlink: 'p', start: 0 })
  })

  it('knows the same kinds as the checker', () => {
    expect(DERIVED_KINDS).toEqual(['audiogram', 'stream_clip', 'clip', 'remix', 'reaction', 'narration', 'recap', 'audio_version', 'quote', 'teaser'])
  })
})

describe('withSource / splitRef', () => {
  it('adds the source next to the other 3speak keys, never touching the input', () => {
    const meta = { app: 'x', '3speak': { ads: false } }
    const out = withSource(meta, { kind: 'reaction', author: 'bob', permlink: 'v' })
    expect(out['3speak']).toEqual({ ads: false, source: { kind: 'reaction', author: 'bob', permlink: 'v' } })
    expect(meta['3speak']).toEqual({ ads: false })
    expect(withSource(meta, { kind: 'bad' })).toBe(meta)
    expect(withSource(meta, null)).toBe(meta)
  })

  it('splitRef', () => {
    expect(splitRef('alice/my-post')).toEqual({ author: 'alice', permlink: 'my-post' })
    expect(splitRef('@alice/my-post')).toEqual({ author: 'alice', permlink: 'my-post' })
    expect(splitRef('nope')).toBeNull()
    expect(splitRef(null)).toBeNull()
  })
})

describe('registerDerived', () => {
  it('true once the checker indexed it', async () => {
    const post = vi.fn(async () => ({ data: { success: true } }))
    expect(await registerDerived('alice', 'p', { post, delayMs: 0 })).toBe(true)
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/\/derived\/register$/), { author: 'alice', permlink: 'p' }, expect.anything())
  })

  it('retries while the post is not readable yet, stops on any other 4xx, never throws', async () => {
    const notYet = Object.assign(new Error('404'), { response: { status: 404, data: { retry: true } } })
    const post = vi.fn().mockRejectedValueOnce(notYet).mockResolvedValueOnce({ data: { success: true } })
    expect(await registerDerived('alice', 'p', { post, delayMs: 0 })).toBe(true)
    expect(post).toHaveBeenCalledTimes(2)

    const bad = Object.assign(new Error('400'), { response: { status: 400, data: {} } })
    const post2 = vi.fn().mockRejectedValue(bad)
    expect(await registerDerived('alice', 'p', { post: post2, delayMs: 0 })).toBe(false)
    expect(post2).toHaveBeenCalledTimes(1)

    const down = vi.fn().mockRejectedValue(new Error('network'))
    expect(await registerDerived('alice', 'p', { post: down, delayMs: 0, attempts: 3 })).toBe(false)
    expect(down).toHaveBeenCalledTimes(3)
    expect(await registerDerived('', 'p', { post: down })).toBe(false)
  })
})

describe('fetchDerived', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the list, unknown kinds dropped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ author: 'a', permlink: 'b', kind: 'clip' }, { author: 'a', permlink: 'c', kind: 'weird' }], counts: { clip: 1 }, total: 1 }) })))
    const d = await fetchDerived('bob', 'video')
    expect(d).toEqual({ items: [{ author: 'a', permlink: 'b', kind: 'clip' }], counts: { clip: 1 }, total: 1 })
    expect(fetch.mock.calls[0][0]).toMatch(/\/derived\/bob\/video\?limit=24$/)
  })

  it('empty when the checker is down or answers an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await fetchDerived('bob', 'v')).toEqual({ items: [], counts: {}, total: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await fetchDerived('bob', 'v')).toEqual({ items: [], counts: {}, total: 0 })
  })
})

describe('derivedHref', () => {
  it('opens each kind of post where it plays', () => {
    expect(derivedHref({ author: 'a', permlink: 'b', media: 'short' })).toBe('/shorts?v=a/b')
    expect(derivedHref({ author: 'a', permlink: 'b', media: 'audio' })).toBe('/audio/a/b')
    expect(derivedHref({ author: 'a', permlink: 'b', media: 'video' })).toMatch(/a.*b/)
    expect(derivedHref({ author: 'a', permlink: 'b', media: 'post' })).toBe('/post/a/b')
  })
})
