// Community snaps (src/lib/snaps.js): checker reads, hides, and publishing or
// editing a written post with its tags, rewards and indexing retry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  axios: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  comment: vi.fn(),
  container: vi.fn(),
}))
vi.mock('axios', () => ({ default: h.axios }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.example' }))
vi.mock('../../../src/utils/snapsContainer', () => ({ resolveSnapsContainer: h.container }))
vi.mock('../../../src/hive-api/aioha', () => ({ commentWithAioha: h.comment }))

import {
  fetchSnaps, fetchCommunitySnaps, fetchCommunityFeed, recordSnapInteraction, hideSnap, unhideSnap,
  hideSnapCreator, unhideSnapCreator, publishSnap, updateSnap, SNAP_TAG, MAX_USER_TAGS,
} from '../../../src/lib/snaps.js'

const NOW = 1760000012345
let indexAnswers
let hivePost

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  Object.values(h.axios).forEach((f) => f.mockReset())
  h.comment.mockReset().mockResolvedValue({ success: true })
  h.container.mockReset().mockResolvedValue({ author: 'peak.snaps', permlink: 'container-1' })
  indexAnswers = [{ data: { success: true, snap: { body: 'Hello there' } } }]
  hivePost = null
  h.axios.post.mockImplementation(async (url) => {
    if (url === 'https://hive.example') return { data: { result: hivePost } }
    const next = indexAnswers.length > 1 ? indexAnswers.shift() : indexAnswers[0]
    if (next instanceof Error) throw next
    return next
  })
  h.axios.get.mockResolvedValue({ data: { success: true } })
  h.axios.delete.mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers() })

const lastMeta = () => h.comment.mock.calls.at(-1)[5]
const lastOptions = () => h.comment.mock.calls.at(-1)[6]
// Lets the indexing retries run, then puts the clock back so permlinks stay predictable.
const run = async (promise) => {
  const settled = promise.then((v) => ({ v }), (e) => ({ e }))
  await vi.advanceTimersByTimeAsync(10000)
  const r = await settled
  vi.setSystemTime(NOW)
  if (r.e) throw r.e
  return r.v
}

describe('reads and hides', () => {
  it('reads an owner\'s and a community\'s snaps', async () => {
    await fetchSnaps('al ice', 2, 5)
    await fetchCommunitySnaps('hive-1')
    expect(h.axios.get.mock.calls.map((c) => c[0])).toEqual([
      'https://checker.example/snaps/al%20ice?page=2&limit=5',
      'https://checker.example/snaps/community/hive-1?page=1&limit=20',
    ])
  })

  it('the home feed only adds the viewer and age window when given', async () => {
    await fetchCommunityFeed()
    await fetchCommunityFeed({ scope: 'following', currentuser: 'me', maxAgeHours: 24 })
    expect(h.axios.get.mock.calls.map((c) => c[0])).toEqual([
      'https://checker.example/snaps-feed?scope=all&page=1&limit=10',
      'https://checker.example/snaps-feed?scope=following&page=1&limit=10&currentuser=me&maxAgeHours=24',
    ])
  })

  it('records an interaction quietly and only with all three values', async () => {
    h.axios.post.mockRejectedValueOnce(new Error('down'))
    expect(() => recordSnapInteraction('me', 'a', 'p')).not.toThrow()
    recordSnapInteraction('me', '', 'p')
    expect(h.axios.post).toHaveBeenCalledTimes(1)
    expect(h.axios.post).toHaveBeenCalledWith('https://checker.example/snaps/interaction', { user: 'me', author: 'a', permlink: 'p' })
  })

  it('hides and unhides snaps and creators', async () => {
    await hideSnap('me', 'a', 'p')
    await unhideSnap('me', 'a', 'p')
    await hideSnapCreator('me', 'a')
    await unhideSnapCreator('me', 'a')
    expect(h.axios.post).toHaveBeenCalledWith('https://checker.example/snaps/hide', { user: 'me', author: 'a', permlink: 'p' })
    expect(h.axios.delete).toHaveBeenCalledWith('https://checker.example/snaps/hide', { data: { user: 'me', author: 'a', permlink: 'p' } })
    expect(h.axios.post).toHaveBeenCalledWith('https://checker.example/snaps/hide-creator', { user: 'me', author: 'a' })
    expect(h.axios.delete).toHaveBeenCalledWith('https://checker.example/snaps/hide-creator', { data: { user: 'me', author: 'a' } })
  })
})

describe('publishSnap', () => {
  it('replies under the latest container with a permlink made from the text', async () => {
    const out = await run(publishSnap({ user: 'alice', body: '  Hello there  ' }))
    expect(out).toEqual({ author: 'alice', permlink: 'hello-there-12345', indexed: { body: 'Hello there' } })
    const [pa, pp, permlink, title, body] = h.comment.mock.calls[0]
    expect([pa, pp, permlink, title, body]).toEqual(['peak.snaps', 'container-1', 'hello-there-12345', '', 'Hello there'])
    expect(lastMeta()).toEqual({ app: '3speak/snap', format: 'markdown', tags: ['community'], type: 'snap' })
  })

  it('a permlink from punctuation, accents or emoji stays valid', async () => {
    await run(publishSnap({ user: 'a', body: 'Ünïcode!!  rocks?' }))
    expect(h.comment.mock.calls[0][2]).toBe('ncode-rocks-12345')
    await run(publishSnap({ user: 'a', body: '🎉🎉' }))
    expect(h.comment.mock.calls[1][2]).toBe('snap-12345')
    await run(publishSnap({ user: 'a', body: `${'word '.repeat(20)}` }))
    const p = h.comment.mock.calls[2][2]
    expect(p).toMatch(/^[a-z0-9-]+-12345$/)
    expect(p.replace('-12345', '').length).toBeLessThanOrEqual(27)
    expect(p).not.toMatch(/--/)
  })

  it('refuses without a user or text', async () => {
    await expect(publishSnap({ user: '', body: 'x' })).rejects.toThrow('Please log in first')
    await expect(publishSnap({ user: 'a', body: '   ' })).rejects.toThrow('Write something first')
    expect(h.comment).not.toHaveBeenCalled()
  })

  it('cleans tags: lowercase, no #, no duplicates, built-in tag first, at most 9 of the user\'s', async () => {
    const tags = ['#Music', 'music', 'COMMUNITY', ' ', ...Array.from({ length: 12 }, (_, i) => `t${i}`)]
    await run(publishSnap({ user: 'a', body: 'x', tags }))
    const t = lastMeta().tags
    expect(t[0]).toBe(SNAP_TAG)
    expect(t.slice(1)).toEqual(['music', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(t.length).toBe(1 + MAX_USER_TAGS)
  })

  it('adds nsfw and a valid community id', async () => {
    await run(publishSnap({ user: 'a', body: 'x', tags: ['art'], nsfw: true, community: 'hive-123' }))
    expect(lastMeta()).toMatchObject({ tags: ['community', 'art', 'nsfw'], community: 'hive-123' })
    await run(publishSnap({ user: 'a', body: 'x', community: 'not-a-community' }))
    expect(lastMeta().community).toBeUndefined()
  })

  // src/lib/snaps.js:135-138 (and 196-210 in updateSnap): nsfw is pushed after
  // community + 9 user tags and then cut by slice(0, 10), so it silently disappears.
  it.skip('BUG: an NSFW snap keeps its nsfw tag even with the maximum number of user tags', async () => {
    const tags = Array.from({ length: 9 }, (_, i) => `t${i}`)
    await run(publishSnap({ user: 'a', body: 'x', tags, nsfw: true }))
    expect(lastMeta().tags).toContain('nsfw')
    expect(lastMeta().tags.length).toBeLessThanOrEqual(10)
  })

  it('builds comment options from the rewards choice and beneficiaries', async () => {
    await run(publishSnap({
      user: 'a', body: 'x', rewards: 'powerup',
      beneficiaries: [{ account: '@Zed ', weight: 500.4 }, { account: 'amy', weight: '1000' }, { account: 'nil', weight: 0 }, null],
    }))
    expect(lastOptions()).toEqual({
      author: 'a', permlink: 'x-12345', max_accepted_payout: '1000000.000 HBD', percent_hbd: 0,
      allow_votes: true, allow_curation_rewards: true,
      extensions: [[0, { beneficiaries: [{ account: 'amy', weight: 1000 }, { account: 'zed', weight: 500 }] }]],
    })
    await run(publishSnap({ user: 'a', body: 'x', rewards: 'decline' }))
    expect(lastOptions()).toMatchObject({ max_accepted_payout: '0.000 HBD', percent_hbd: 10000, extensions: [] })
  })

  it('a rejected broadcast throws and is not indexed', async () => {
    h.comment.mockResolvedValue({ success: false })
    await expect(publishSnap({ user: 'a', body: 'x' })).rejects.toThrow('Publishing the snap was rejected')
    expect(h.axios.post).not.toHaveBeenCalled()
  })

  it('retries indexing across block time and still succeeds when the checker never confirms', async () => {
    indexAnswers = [new Error('not yet'), { data: { success: false } }, { data: { success: true, snap: { id: 1 } } }]
    expect((await run(publishSnap({ user: 'a', body: 'x' }))).indexed).toEqual({ id: 1 })
    h.axios.post.mockClear()
    indexAnswers = [new Error('never')]
    expect((await run(publishSnap({ user: 'a', body: 'x' }))).indexed).toBeNull()
    expect(h.axios.post).toHaveBeenCalledTimes(4)
  })
})

describe('updateSnap', () => {
  it('re-broadcasts under the original container and keeps its community, without options', async () => {
    hivePost = { author: 'alice', parent_author: 'peak.snaps', parent_permlink: 'old-container', json_metadata: '{"community":"hive-7","tags":["x"]}' }
    indexAnswers = [{ data: { success: true, snap: { body: 'stale' } } }, { data: { success: true, snap: { body: 'New text' } } }]
    const out = await run(updateSnap({ user: 'alice', permlink: 'p', body: ' New text ', tags: ['#Y'] }))
    expect(h.axios.post.mock.calls[0]).toEqual(['https://hive.example', { jsonrpc: '2.0', method: 'condenser_api.get_content', params: ['alice', 'p'], id: 1 }])
    const [pa, pp, permlink, , body, meta, options] = h.comment.mock.calls[0]
    expect([pa, pp, permlink, body]).toEqual(['peak.snaps', 'old-container', 'p', 'New text'])
    expect(meta).toEqual({ app: '3speak/snap', format: 'markdown', tags: ['community', 'y'], type: 'snap', community: 'hive-7' })
    expect(options).toBeNull()
    expect(out.indexed).toEqual({ body: 'New text' })
  })

  it('drops an invalid or unreadable community', async () => {
    hivePost = { author: 'alice', parent_author: 'p', parent_permlink: 'c', json_metadata: '{broken' }
    await run(updateSnap({ user: 'alice', permlink: 'p', body: 'x' }))
    expect(lastMeta().community).toBeUndefined()
    hivePost = { author: 'alice', parent_author: 'p', parent_permlink: 'c', json_metadata: { community: 'tag' } }
    await run(updateSnap({ user: 'alice', permlink: 'p', body: 'x' }))
    expect(lastMeta().community).toBeUndefined()
  })

  it('refuses to edit someone else\'s or a missing snap', async () => {
    hivePost = { author: 'bob' }
    await expect(updateSnap({ user: 'alice', permlink: 'p', body: 'x' })).rejects.toThrow('Could not load the snap to edit')
    hivePost = null
    await expect(updateSnap({ user: 'alice', permlink: 'p', body: 'x' })).rejects.toThrow('Could not load the snap to edit')
    await expect(updateSnap({ user: '', permlink: 'p', body: 'x' })).rejects.toThrow('Please log in first')
    await expect(updateSnap({ user: 'a', permlink: 'p', body: '' })).rejects.toThrow('Write something first')
    expect(h.comment).not.toHaveBeenCalled()
  })

  it('a rejected edit throws', async () => {
    hivePost = { author: 'alice', parent_author: 'p', parent_permlink: 'c' }
    h.comment.mockResolvedValue({ success: false })
    await expect(updateSnap({ user: 'alice', permlink: 'p', body: 'x' })).rejects.toThrow('Updating the snap was rejected')
  })
})
