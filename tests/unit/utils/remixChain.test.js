// Remix chains (src/utils/remixChain.js): who a remix of a remix pays, when the
// remix button refuses, and the earlier-video links in the post body.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const posts = new Map()
vi.mock('../../../src/hive-api/hiveApi', () => ({
  getPostDetails: vi.fn(async (author, permlink) => {
    const post = posts.get(`${author}/${permlink}`)
    if (!post) throw new Error('not found')
    return post
  }),
}))

const {
  resolveRemixChain, remixChainAuthors, remixBlockReason, remixChainMarkdown, checkRemix, REMIX_CHAIN_MAX,
} = await import('../../../src/utils/remixChain.js')

const remixOf = (author, permlink) => ({ json_metadata: { video: { originalAuthor: author, originalPermlink: permlink } } })

beforeEach(() => posts.clear())

describe('resolveRemixChain', () => {
  it('walks older remixes post by post, the video itself first', async () => {
    posts.set('carol/v3', remixOf('bob1', 'v2'))
    posts.set('bob1/v2', remixOf('alice', 'v1'))
    posts.set('alice/v1', { json_metadata: { video: {} } })
    expect(await resolveRemixChain('carol', 'v3')).toEqual([
      { author: 'carol', permlink: 'v3' }, { author: 'bob1', permlink: 'v2' }, { author: 'alice', permlink: 'v1' },
    ])
  })

  it('takes a saved chain as it is, keeping short ids for links', async () => {
    posts.set('carol/v3', { json_metadata: JSON.stringify({ video: { remixChain: [{ author: 'bob1', permlink: 'v2', short: 'abcd1234' }, { author: 'alice', permlink: 'v1' }] } }) })
    expect(await resolveRemixChain('carol', 'v3', 'xyz98765')).toEqual([
      { author: 'carol', permlink: 'v3', short: 'xyz98765' },
      { author: 'bob1', permlink: 'v2', short: 'abcd1234' },
      { author: 'alice', permlink: 'v1' },
    ])
  })

  it('ends at a post it cannot read (a short with no Hive post) and on loops', async () => {
    posts.set('carol/v3', remixOf('bob1', 'gone'))
    expect(await resolveRemixChain('carol', 'v3')).toHaveLength(2)
    posts.set('xena/p1', remixOf('yuri', 'p2'))
    posts.set('yuri/p2', remixOf('xena', 'p1'))
    expect(await resolveRemixChain('xena', 'p1')).toHaveLength(2)
  })

  it('stops one past the limit, so a full chain shows', async () => {
    for (let i = 1; i <= 10; i++) posts.set(`user${i}/p`, remixOf(`user${i + 1}`, 'p'))
    expect(await resolveRemixChain('user1', 'p')).toHaveLength(REMIX_CHAIN_MAX + 1)
  })

  it('refuses names that are not Hive accounts', async () => {
    posts.set('carol/v3', remixOf('Not A Name', 'v2'))
    expect(await resolveRemixChain('carol', 'v3')).toHaveLength(1)
  })
})

describe('remixBlockReason', () => {
  const chainOf = (n) => Array.from({ length: n }, (_, i) => ({ author: `user${i}`, permlink: 'p' }))

  it('refuses a video that already builds on the maximum', () => {
    expect(remixBlockReason(chainOf(REMIX_CHAIN_MAX + 1), { user: 'me', isPremium: true })).toBe('full')
  })

  it('keeps a beneficiary slot free: fund + encoder + 6 authors blocks a free user, not Pro', () => {
    expect(remixBlockReason(chainOf(6), { user: 'me', isPremium: false })).toBe('slots')
    expect(remixBlockReason(chainOf(5), { user: 'me', isPremium: false })).toBe(null)
    expect(remixBlockReason(chainOf(6), { user: 'me', isPremium: true })).toBe(null)
  })

  it('does not count the remixer or a repeated author', () => {
    const chain = [...chainOf(5), { author: 'me', permlink: 'q' }, { author: 'user1', permlink: 'r' }]
    expect(remixChainAuthors(chain, 'ME')).toEqual(['user0', 'user1', 'user2', 'user3', 'user4'])
    expect(remixBlockReason(chain.slice(0, 6), { user: 'me', isPremium: false })).toBe(null)
  })

  it('checkRemix resolves and judges in one go', async () => {
    posts.set('carol/v3', remixOf('bob1', 'v2'))
    const r = await checkRemix({ author: 'carol', permlink: 'v3' }, { user: 'me', isPremium: false })
    expect(r.blocked).toBe(null)
    expect(r.chain.map(c => c.author)).toEqual(['carol', 'bob1'])
  })
})

describe('remixChainMarkdown', () => {
  it('links every video before the direct source, shorts on /shorts', () => {
    const md = remixChainMarkdown([
      { author: 'c', permlink: 'v3' },
      { author: 'b', permlink: 'v2', short: 'abcd1234' },
      { author: 'a', permlink: 'v1' },
    ], 'https://3speak.tv')
    expect(md).toBe('\n*Earlier in this remix chain: [@b](https://3speak.tv/shorts?v=b/abcd1234) · [@a](https://3speak.tv/@a/v1)*')
  })

  it('adds nothing for a plain remix', () => {
    expect(remixChainMarkdown([{ author: 'a', permlink: 'v1' }], 'https://3speak.tv')).toBe('')
  })
})
