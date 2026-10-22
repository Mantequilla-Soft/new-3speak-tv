// Off-chain replies and likes merged into a Hive comment thread
// (src/utils/offChainReplies.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ replies: vi.fn(), likes: vi.fn() }))
vi.mock('../../../src/lib/incubation', () => ({
  fetchIncubationRepliesFor: h.replies,
  fetchIncubationLikesFor: h.likes,
  handleAvatar: (name) => `/handle-avatar/${name}`,
}))

import { mergeOffChainReplies, applyOffChainLikes } from '../../../src/utils/offChainReplies.js'

const hive = (permlink, created, children = []) => ({ author: { username: `u-${permlink}` }, permlink, created_at: created, children })
const off = (permlink, parentPermlink, created, extra = {}) => ({ permlink, parentPermlink, created, body: `body ${permlink}`, handle: `h-${permlink}`, ...extra })

beforeEach(() => {
  h.replies.mockReset()
  h.likes.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('mergeOffChainReplies', () => {
  it('asks about every permlink in the thread, not only the post', async () => {
    h.replies.mockResolvedValue({ items: [] })
    const tree = [hive('c1', '2026-01-01', [hive('c2', '2026-01-02')])]
    expect(await mergeOffChainReplies('post', tree)).toBe(tree)
    expect(h.replies).toHaveBeenCalledWith(['post', 'c1', 'c2'])
  })

  it('puts replies to the post at the top level, newest first', async () => {
    h.replies.mockResolvedValueOnce({ items: [off('o1', 'post', '2026-01-03')] }).mockResolvedValue({ items: [] })
    const out = await mergeOffChainReplies('post', [hive('c1', '2026-01-01'), hive('c2', '2026-01-05')])
    expect(out.map((c) => c.permlink)).toEqual(['c2', 'o1', 'c1'])
    expect(out[1]).toMatchObject({
      author: { username: 'h-o1', profile: { images: { avatar: '/handle-avatar/h-o1' } } },
      body: 'body o1', onChain: false, has_voted: false, children: [],
      stats: { num_likes: 0, num_dislikes: 0, total_hive_reward: 0 },
    })
  })

  it('nests a reply under the comment it answered, including off-chain parents', async () => {
    h.replies
      .mockResolvedValueOnce({ items: [off('o1', 'c1', '2026-01-02')] })
      .mockResolvedValueOnce({ items: [off('o2', 'o1', '2026-01-03')] })
      .mockResolvedValue({ items: [] })
    const out = await mergeOffChainReplies('post', [hive('c1', '2026-01-01')])
    expect(out).toHaveLength(1)
    expect(out[0].children.map((c) => c.permlink)).toEqual(['o1'])
    expect(out[0].children[0].children.map((c) => c.permlink)).toEqual(['o2'])
    expect(h.replies.mock.calls[1][0]).toEqual(['o1'])
  })

  it('a Hive user\'s off-chain post shows their real account avatar', async () => {
    h.replies.mockResolvedValueOnce({ items: [off('o1', 'post', '2026-01-02', { hiveAuthor: 'alice', jsonMetadata: { parentTimestamp: 42 } })] })
      .mockResolvedValue({ items: [] })
    const [reply] = await mergeOffChainReplies('post', [])
    expect(reply.author).toEqual({ username: 'alice', profile: { images: { avatar: '/img/u/alice/avatar/small' } } })
    expect(reply.parentTimestamp).toBe(42)
  })

  it('a reply whose parent is not in the thread still shows, at the top level', async () => {
    h.replies.mockResolvedValueOnce({ items: [off('o1', 'deleted-comment', '2026-01-02')] }).mockResolvedValue({ items: [] })
    const out = await mergeOffChainReplies('post', [hive('c1', '2026-01-01')])
    expect(out.map((c) => c.permlink)).toEqual(['o1', 'c1'])
  })

  it('stops after four rounds and never repeats a reply it already has', async () => {
    let n = 0
    h.replies.mockImplementation(async () => {
      n += 1
      const fresh = off(`o${n}`, n === 1 ? 'post' : `o${n - 1}`, `2026-01-0${n}`)
      return { items: n === 1 ? [fresh] : [fresh, off('o1', 'post', '2026-01-01')] }
    })
    const out = await mergeOffChainReplies('post', [])
    expect(h.replies).toHaveBeenCalledTimes(4)
    expect(out.map((c) => c.permlink)).toEqual(['o1'])
    expect(out[0].children[0].children[0].children[0].permlink).toBe('o4')
  })

  it('returns the Hive thread untouched when the store is unreachable', async () => {
    h.replies.mockRejectedValue(new Error('timeout'))
    const tree = [hive('c1', '2026-01-01')]
    expect(await mergeOffChainReplies('post', tree)).toBe(tree)
    expect(await mergeOffChainReplies('post', null)).toEqual([])
  })
})

describe('applyOffChainLikes', () => {
  it('adds off-chain likes to the Hive counts in one request for the whole tree', async () => {
    h.likes.mockResolvedValue({
      'a/p1': { count: 2, liked: false },
      'b/p2': { count: 1, liked: true },
    })
    const tree = [{ author: 'a', permlink: 'p1', stats: { num_likes: 3 }, has_voted: false,
      children: [{ author: { username: 'b' }, permlink: 'p2', children: [] }] }]
    const out = await applyOffChainLikes(tree, 'viewer')
    expect(h.likes).toHaveBeenCalledTimes(1)
    expect(h.likes).toHaveBeenCalledWith([{ author: 'a', permlink: 'p1' }, { author: 'b', permlink: 'p2' }], 'viewer')
    expect(out[0].stats.num_likes).toBe(5)
    expect(out[0].has_voted).toBe(false)
    expect(out[0].children[0].stats.num_likes).toBe(1)
    expect(out[0].children[0].has_voted).toBe(true)
    expect(tree[0].stats.num_likes).toBe(3)
  })

  it('a Hive vote by the viewer stays counted as voted', async () => {
    h.likes.mockResolvedValue({ 'a/p': { count: 1, liked: false } })
    const [c] = await applyOffChainLikes([{ author: 'a', permlink: 'p', has_voted: true }], 'v')
    expect(c.has_voted).toBe(true)
    expect(c.stats.num_likes).toBe(1)
  })

  it('leaves the tree alone when there is nothing to count or the store fails', async () => {
    const tree = [{ author: 'a', permlink: 'p', stats: { num_likes: 1 } }]
    expect(await applyOffChainLikes([], 'v')).toEqual([])
    expect(h.likes).not.toHaveBeenCalled()
    h.likes.mockResolvedValueOnce({})
    expect(await applyOffChainLikes(tree, 'v')).toBe(tree)
    h.likes.mockResolvedValueOnce(null)
    expect(await applyOffChainLikes(tree, 'v')).toBe(tree)
    h.likes.mockRejectedValueOnce(new Error('down'))
    expect(await applyOffChainLikes(tree, 'v')).toBe(tree)
  })
})
