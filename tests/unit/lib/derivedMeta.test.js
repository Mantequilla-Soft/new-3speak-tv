// What a post was made from, read on the client (src/lib/derived.js madeFromMeta).
import { describe, it, expect } from 'vitest'
import { madeFromMeta } from '../../../src/lib/derived.js'

describe('madeFromMeta', () => {
  it('the 3speak.source of any derived post', () => {
    expect(madeFromMeta({ '3speak': { source: { kind: 'teaser', author: 'Bob', permlink: 'p' } } })).toEqual({ kind: 'teaser', author: 'bob', permlink: 'p' })
    expect(madeFromMeta(JSON.stringify({ '3speak': { source: { kind: 'clip', author: 'bob', permlink: 'p', start: 5 } } }))).toEqual({ kind: 'clip', author: 'bob', permlink: 'p', start: 5 })
  })

  it('an older stream clip from its own block; a recap as a recap', () => {
    expect(madeFromMeta({ video: { streamClip: { room: 'bob-r1', host: 'bob', offset: 30 } } })).toEqual({ kind: 'stream_clip', author: 'bob', permlink: 'bob-r1', start: 30 })
    expect(madeFromMeta({ video: { streamClip: { room: 'bob-r1', host: 'bob', recap: true } } })).toEqual({ kind: 'recap', author: 'bob', permlink: 'bob-r1' })
  })

  it('null for nothing, junk or a bad source', () => {
    expect(madeFromMeta({})).toBeNull()
    expect(madeFromMeta('{oops')).toBeNull()
    expect(madeFromMeta(null)).toBeNull()
    expect(madeFromMeta({ '3speak': { source: { kind: 'nope', author: 'bob', permlink: 'p' } } })).toBeNull()
  })
})
