// The @peak.snaps container lookup (src/utils/snapsContainer.js): which posts
// are containers, and resolving the newest container across every Hive node and
// both hivemind APIs, with backoff, a deadline, cancelling and a short memo.
// Hive RPC is mocked and the clock is fake.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post: h.post } }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://pinned.example' }))
vi.mock('../../../src/utils/config', () => ({
  HIVE_API_NODES: ['https://a.example', 'https://pinned.example', '', 'https://b.example'],
}))
vi.mock('../../../src/i18n', () => ({ t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }))

import { isSnapsContainer, resolveSnapsContainer, clearSnapsContainerCache } from '../../../src/utils/snapsContainer.js'

const CONTAINER = { author: 'peak.snaps', permlink: 'snaps-2026-11-05', depth: 0 }
const ok = (result) => ({ data: { result } })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T10:00:00.123Z'))
  clearSnapsContainerCache()
  h.post.mockReset()
})
afterEach(() => vi.useRealTimers())

// Runs a lookup while letting fake time pass, and returns {value} or {error}.
async function run(promise, ms = 60000) {
  const settled = promise.then((value) => ({ value }), (error) => ({ error }))
  await vi.advanceTimersByTimeAsync(ms)
  return settled
}
const calls = () => h.post.mock.calls.map(([node, body]) => `${node} ${body.method}`)

describe('isSnapsContainer', () => {
  it.each([
    [{ author: 'peak.snaps' }, true],
    [{ author: ' Ecency.Waves ' }, true],
    [{ author: 'alice' }, false],
    [{}, false],
    [null, false],
  ])('%j -> %s', (post, yes) => {
    expect(isSnapsContainer(post)).toBe(yes)
  })
})

describe('resolveSnapsContainer', () => {
  it('asks the pinned node first through the bridge API, with a per-call timeout', async () => {
    h.post.mockResolvedValue(ok([CONTAINER]))
    expect(await resolveSnapsContainer()).toEqual({ author: 'peak.snaps', permlink: 'snaps-2026-11-05' })
    const [node, body, opts] = h.post.mock.calls[0]
    expect(node).toBe('https://pinned.example')
    expect(body).toEqual({
      jsonrpc: '2.0', id: 1, method: 'bridge.get_account_posts',
      params: { sort: 'posts', account: 'peak.snaps', start_author: '', start_permlink: '', limit: 1 },
    })
    expect(opts.timeout).toBe(6000)
  })

  it('falls back to the condenser API on the same node when the node has no hivemind bridge', async () => {
    h.post
      .mockResolvedValueOnce({ data: { error: { message: 'Unable to parse endpoint data.' } } })
      .mockResolvedValueOnce(ok([CONTAINER]))
    await resolveSnapsContainer()
    expect(calls()).toEqual([
      'https://pinned.example bridge.get_account_posts',
      'https://pinned.example condenser_api.get_discussions_by_author_before_date',
    ])
    expect(h.post.mock.calls[1][1].params).toEqual(['peak.snaps', '', '2026-11-05T10:00:00', 1])
  })

  it('then tries every other configured node once, in order', async () => {
    h.post.mockImplementation(async (node) => (node === 'https://b.example' ? ok([CONTAINER]) : ok([])))
    await resolveSnapsContainer()
    expect(calls().map((c) => c.split(' ')[0])).toEqual([
      'https://pinned.example', 'https://pinned.example',
      'https://a.example', 'https://a.example',
      'https://b.example',
    ])
  })

  it.each([
    ['a reply instead of a top-level post', { ...CONTAINER, depth: 1 }],
    ['a post without a permlink', { author: 'peak.snaps' }],
  ])('never answers with %s', async (_name, post) => {
    h.post.mockResolvedValueOnce(ok([post])).mockResolvedValue(ok([CONTAINER]))
    expect((await resolveSnapsContainer()).permlink).toBe('snaps-2026-11-05')
    expect(h.post).toHaveBeenCalledTimes(2)
  })

  it('fills in the author when the API leaves it out', async () => {
    h.post.mockResolvedValue(ok([{ permlink: 'p1' }]))
    expect(await resolveSnapsContainer()).toEqual({ author: 'peak.snaps', permlink: 'p1' })
  })

  it('remembers the answer for five minutes unless forced', async () => {
    h.post.mockResolvedValue(ok([CONTAINER]))
    await resolveSnapsContainer()
    await resolveSnapsContainer()
    expect(h.post).toHaveBeenCalledTimes(1)
    await resolveSnapsContainer({ force: true })
    expect(h.post).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5 * 60 * 1000)
    await resolveSnapsContainer()
    expect(h.post).toHaveBeenCalledTimes(3)
    clearSnapsContainerCache()
    await resolveSnapsContainer()
    expect(h.post).toHaveBeenCalledTimes(4)
  })

  it('retries whole rounds with growing backoff, telling the user, until a node answers', async () => {
    const onProgress = vi.fn()
    let round = 0
    h.post.mockImplementation(async (node, body) => {
      if (node === 'https://pinned.example' && body.method.startsWith('bridge')) round += 1
      if (round === 3) return ok([CONTAINER])
      throw new Error('timeout')
    })
    const res = await run(resolveSnapsContainer({ onProgress }))
    expect(res.value).toEqual({ author: 'peak.snaps', permlink: 'snaps-2026-11-05' })
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      'misc.snaps.retrying {"attempt":2}',
      'misc.snaps.retrying {"attempt":3}',
    ])
  })

  it('a progress callback that throws does not break the lookup', async () => {
    h.post.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(ok([CONTAINER]))
    const res = await run(resolveSnapsContainer({ onProgress: () => { throw new Error('ui gone') } }))
    expect(res.value.permlink).toBe('snaps-2026-11-05')
  })

  it('gives up at the deadline with the last node error in the message', async () => {
    h.post.mockImplementation(async (node) => {
      await new Promise((r) => setTimeout(r, 1000))
      throw new Error(`down ${node}`)
    })
    const res = await run(resolveSnapsContainer({ deadlineMs: 5000 }), 20000)
    expect(res.error.message).toMatch(/^misc\.snaps\.unreachableWithError /)
    expect(res.error.message).toContain('down')
  })

  it('reports a node that answered with no posts', async () => {
    h.post.mockResolvedValue(ok(null))
    const res = await run(resolveSnapsContainer({ deadlineMs: 100 }))
    expect(res.error.message).toContain('returned no @peak.snaps posts')
  })

  it('with no time at all it says the service is unreachable', async () => {
    const res = await run(resolveSnapsContainer({ deadlineMs: 0 }))
    expect(res.error.message).toBe('misc.snaps.unreachable')
    expect(h.post).not.toHaveBeenCalled()
  })

  it('stops when cancelled, before or during a round', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(resolveSnapsContainer({ signal: ctrl.signal })).rejects.toThrow('Cancelled')

    const later = new AbortController()
    h.post.mockImplementation(async () => { later.abort(); throw new Error('aborted') })
    await expect(resolveSnapsContainer({ signal: later.signal })).rejects.toThrow('Cancelled')
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post.mock.calls[0][2].signal).toBe(later.signal)
  })

  it('uses the RPC error code text when there is no message', async () => {
    h.post.mockResolvedValue({ data: { error: { error: 'rate_limited' } } })
    const res = await run(resolveSnapsContainer({ deadlineMs: 100 }))
    expect(res.error.message).toContain('rate_limited')
  })
})
