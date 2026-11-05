// Data for the Hive galaxy (src/lib/hiveGalaxy.js): follow lists from the
// checker with a Hive RPC fallback, the friends-of-friends scan, profile and
// 3Speak count enrichment, and the circles found on the scan graph. Axios is
// mocked; a small router answers each JSON-RPC method.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get, post: h.post } }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://hive.test' }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

import {
  SCAN_DEPTHS,
  DEFAULT_DEPTH,
  MODES,
  MAX_RING_STARS,
  fetchFollowing,
  fetchFollowers,
  fetchLinks,
  buildGalaxy,
  scanGraph,
  findCircles,
  ringOnMap,
} from '../../../src/lib/hiveGalaxy.js'

// The module caches follow lists for ten minutes, so every test uses its own names.
let seq = 0
const fresh = (base = 'acct') => `${base}${++seq}`

// graph: account -> { following: [...], followers: [...] }
function hiveGraph(graph, { profiles = {}, counts = {}, failProfiles, failCounts } = {}) {
  const rpcCalls = []
  h.post.mockImplementation(async (url, body) => {
    if (url === 'https://checker.test/users/counts') {
      if (failCounts) throw new Error('counts down')
      return { data: { counts: Object.fromEntries(body.usernames.filter((n) => counts[n]).map((n) => [n, counts[n]])) } }
    }
    rpcCalls.push(body)
    const { method, params } = body
    if (method === 'condenser_api.get_following' || method === 'condenser_api.get_followers') {
      const [account, start] = params
      const field = method.endsWith('following') ? 'following' : 'follower'
      const list = graph[account]?.[method.endsWith('following') ? 'following' : 'followers']
      if (list instanceof Error) throw list
      const all = list || []
      const from = start ? all.indexOf(start) : 0
      return { data: { result: all.slice(from, from + 1000).map((n) => ({ [field]: n })) } }
    }
    if (method === 'bridge.get_profiles') {
      if (failProfiles) return failProfiles(params.accounts)
      return { data: { result: params.accounts.filter((n) => profiles[n]).map((n) => ({ name: n, ...profiles[n] })) } }
    }
    throw new Error(`unexpected ${method}`)
  })
  return rpcCalls
}

beforeEach(() => {
  h.get.mockReset()
  h.post.mockReset()
  // Checker down by default: the RPC paths run.
  h.get.mockRejectedValue(new Error('checker down'))
})
afterEach(() => vi.useRealTimers())

describe('constants', () => {
  it('scans a few depths, defaulting to orbit, in three modes', () => {
    expect(Object.keys(SCAN_DEPTHS)).toEqual(['orbit', 'starsystem', 'nebula', 'deepspace'])
    expect(DEFAULT_DEPTH).toBe('orbit')
    expect(MODES).toEqual(['following', 'followers', 'mutuals'])
  })
})

describe('fetchFollowing and fetchFollowers', () => {
  it('read both lists from the checker in one request and cap them', async () => {
    const a = fresh()
    h.get.mockResolvedValue({ data: { success: true, following: ['b', 'c', 'd'], followers: ['e'] } })
    expect(await fetchFollowing(a, 2)).toEqual(['b', 'c'])
    expect(await fetchFollowers(a)).toEqual(['e'])
    expect(h.get).toHaveBeenCalledTimes(1)
    expect(h.get).toHaveBeenCalledWith('https://checker.test/galaxy/lists', expect.objectContaining({ params: { account: a } }))
  })

  it('fall back to paging Hive RPC, dropping badge and excluded accounts', async () => {
    const a = fresh()
    const long = Array.from({ length: 1500 }, (_, i) => `u${String(i).padStart(4, '0')}`)
    long[3] = 'badge-gold'
    long[4] = 'dtube'
    const calls = hiveGraph({ [a]: { following: long } })
    const out = await fetchFollowing(a)
    expect(out).toHaveLength(1498)
    expect(out).not.toContain('badge-gold')
    expect(out).not.toContain('dtube')
    // The second page starts at (and repeats) the first page's last row.
    expect(calls.map((c) => c.params[1])).toEqual(['', long[999]])
  })

  it('treat a checker answer without success as a miss', async () => {
    const a = fresh()
    h.get.mockResolvedValue({ data: { success: false } })
    hiveGraph({ [a]: { followers: ['x', 'y'] } })
    expect(await fetchFollowers(a)).toEqual(['x', 'y'])
  })

  it('stop paging once the cap is reached', async () => {
    const a = fresh()
    const long = Array.from({ length: 3000 }, (_, i) => `n${i}`)
    const calls = hiveGraph({ [a]: { following: long } })
    expect(await fetchFollowing(a, 1000)).toHaveLength(1000)
    expect(calls).toHaveLength(1)
  })

  it('surface an RPC error after a 4xx without retrying', async () => {
    const a = fresh()
    const err = Object.assign(new Error('bad request'), { response: { status: 400 } })
    hiveGraph({ [a]: { following: err } })
    await expect(fetchFollowing(a)).rejects.toThrow('bad request')
  })

  it('retry a rate-limited read with backoff and succeed', async () => {
    vi.useFakeTimers()
    const a = fresh()
    let tries = 0
    h.post.mockImplementation(async () => {
      tries += 1
      if (tries < 3) throw Object.assign(new Error('slow down'), { response: { status: 429 } })
      return { data: { result: [{ following: 'z' }] } }
    })
    const pending = fetchFollowing(a)
    await vi.advanceTimersByTimeAsync(700)
    await vi.advanceTimersByTimeAsync(1400)
    expect(await pending).toEqual(['z'])
    expect(tries).toBe(3)
  })

  it('give up after three retries on a server error', async () => {
    vi.useFakeTimers()
    const a = fresh()
    h.post.mockRejectedValue(Object.assign(new Error('502'), { response: { status: 502 } }))
    const pending = fetchFollowing(a)
    const settled = expect(pending).rejects.toThrow('502')
    await vi.advanceTimersByTimeAsync(700 + 1400 + 2800)
    await settled
    expect(h.post).toHaveBeenCalledTimes(4)
  })

  it('surface a JSON-RPC error body and do not cache the failure', async () => {
    const a = fresh()
    h.post.mockResolvedValueOnce({ data: { error: { message: 'Assert Exception' } } })
    await expect(fetchFollowers(a)).rejects.toThrow('Assert Exception')
    h.post.mockResolvedValueOnce({ data: { result: [{ follower: 'ok' }] } })
    expect(await fetchFollowers(a)).toEqual(['ok'])
  })
})

describe('fetchLinks', () => {
  it('reads who an account follows and who follows it', async () => {
    const a = fresh()
    hiveGraph({ [a]: { following: ['b'], followers: ['c'] } })
    expect(await fetchLinks(a)).toEqual({ following: ['b'], followers: ['c'] })
  })

  it('answers no followers when that read fails', async () => {
    const a = fresh()
    hiveGraph({ [a]: { following: ['b'], followers: Object.assign(new Error('x'), { response: { status: 404 } }) } })
    expect(await fetchLinks(a)).toEqual({ following: ['b'], followers: [] })
  })
})

describe('buildGalaxy with the RPC scan', () => {
  it('ranks accounts the ring follows that the centre does not, with enrichment', async () => {
    const c = fresh('centre')
    const [b1, b2, b3] = [fresh('b'), fresh('b'), fresh('b')]
    hiveGraph({
      [c]: { following: [b1, b2, b3], followers: [b1] },
      [b1]: { following: [c, b2, 'star', 'solo'] },
      [b2]: { following: ['star', b1] },
      [b3]: { following: Object.assign(new Error('gone'), { response: { status: 404 } }) },
    }, {
      profiles: {
        star: { reputation: '65', active: '2026-05-01T00:00:00', stats: { followers: 900 }, metadata: { profile: { name: 'Star' } } },
        solo: { reputation: 'oops' },
      },
      counts: { star: { videos: 4, shorts: 1 } },
    })
    const progress = []
    const g = await buildGalaxy(c, { onProgress: (d, t) => progress.push([d, t]) })

    expect(g.center).toBe(c)
    expect(g.mode).toBe('following')
    expect(g.ring).toEqual([b1, b2, b3])
    expect(g.followersKnown).toBe(true)
    expect(g.sampled.slice().sort()).toEqual([b1, b2, b3].sort())
    expect(progress[0]).toEqual([0, 3])
    expect(progress.at(-1)).toEqual([3, 3])
    expect(g.suggestions.map((s) => [s.name, s.count])).toEqual([['star', 2], ['solo', 1]])
    expect(g.suggestions[0]).toMatchObject({
      rep: 65, active: Date.parse('2026-05-01T00:00:00Z'), followers: 900, displayName: 'Star', videos: 4, shorts: 1,
    })
    expect(g.suggestions[1]).toMatchObject({ rep: 0, active: null, followers: null, displayName: '', videos: 0, shorts: 0 })
    expect(g.leads[b1].sort()).toEqual(['solo', 'star'])
    expect(g.ringLinks[b1]).toEqual([b2])
    expect(g.ringLinks[b2]).toEqual([b1])
    expect(g.defaultMinCount).toBe(1)
    expect(g.enriched).toEqual({ profiles: true, creators: true })
    expect(g.truncated).toEqual({ following: false, followers: false })
    expect(g.mapRing).toBeNull()
  })

  it('maps the same account to the same sample on every visit', async () => {
    const c = fresh('centre')
    const ring = Array.from({ length: 300 }, (_, i) => `${c}r${i}`)
    hiveGraph({ [c]: { following: ring, followers: [] } })
    const one = await buildGalaxy(c)
    const two = await buildGalaxy(c)
    expect(one.sampled).toHaveLength(SCAN_DEPTHS.orbit)
    expect(two.sampled).toEqual(one.sampled)
    expect(one.sampled).not.toEqual(ring.slice(0, SCAN_DEPTHS.orbit))
  })

  it('caps the RPC sample at 250 even for the deepest scan', async () => {
    const c = fresh('centre')
    const ring = Array.from({ length: 400 }, (_, i) => `${c}r${i}`)
    hiveGraph({ [c]: { following: ring, followers: [] } })
    const g = await buildGalaxy(c, { depth: 'deepspace' })
    expect(g.sampled).toHaveLength(250)
  })

  it('builds the ring from followers or mutuals in those modes', async () => {
    const c = fresh('centre')
    hiveGraph({ [c]: { following: ['m1', 'f1'], followers: ['m1', 'x1'] } })
    expect((await buildGalaxy(c, { mode: 'followers' })).ring).toEqual(['m1', 'x1'])
    expect((await buildGalaxy(c, { mode: 'mutuals' })).ring).toEqual(['m1'])
  })

  it('carries on without followers in following mode, but fails in followers mode', async () => {
    const c = fresh('centre')
    hiveGraph({ [c]: { following: ['b'], followers: Object.assign(new Error('nope'), { response: { status: 400 } }) } })
    const g = await buildGalaxy(c)
    expect(g.followersKnown).toBe(false)
    expect(g.followers).toEqual([])
    await expect(buildGalaxy(c, { mode: 'followers' })).rejects.toThrow('nope')
  })

  it('drops suggestions whose account does not exist and asks again for the rest', async () => {
    const c = fresh('centre')
    const b = fresh('b')
    hiveGraph({
      [c]: { following: [b], followers: [] },
      [b]: { following: ['ghost', 'real'] },
    }, {
      failProfiles: (accounts) => (accounts.includes('ghost')
        ? { data: { error: { message: 'assert', data: { extension: { assertion_expression: '"ghost": "account does not exist"' } } } } }
        : { data: { result: [{ name: 'real', reputation: 50 }] } }),
    })
    const g = await buildGalaxy(c)
    expect(g.suggestions.map((s) => s.name)).toEqual(['real'])
    expect(g.suggestions[0].rep).toBe(50)
  })

  it('marks enrichment as missing when profiles and counts both fail', async () => {
    const c = fresh('centre')
    const b = fresh('b')
    hiveGraph({ [c]: { following: [b], followers: [] }, [b]: { following: ['s'] } }, {
      failProfiles: () => ({ data: { error: { message: 'other failure' } } }),
      failCounts: true,
    })
    const g = await buildGalaxy(c)
    expect(g.enriched).toEqual({ profiles: false, creators: false })
    expect(g.suggestions[0]).toMatchObject({ name: 's', rep: null, videos: null, shorts: null })
  })

  it('raises the default minimum count once a dozen suggestions have two leads', async () => {
    const c = fresh('centre')
    const [b1, b2] = [fresh('b'), fresh('b')]
    const shared = Array.from({ length: 12 }, (_, i) => `s${i}`)
    hiveGraph({ [c]: { following: [b1, b2], followers: [] }, [b1]: { following: shared }, [b2]: { following: shared } })
    expect((await buildGalaxy(c)).defaultMinCount).toBe(2)
  })
})

describe('buildGalaxy with the checker scan', () => {
  it('uses the checker scan and its profile fields, asking only for counts', async () => {
    const c = fresh('centre')
    h.get.mockImplementation(async (url) => {
      if (url.endsWith('/galaxy/scan')) {
        return {
          data: {
            success: true,
            following: ['b1', 'b2'],
            followers: ['b1'],
            sampled: ['b1', 'b2'],
            candidates: [{ name: 's', via: ['b1'], count: 7, rep: 60, active: 5, followers: 10, displayName: 'S' }],
            ringLinks: { b1: ['b2'] },
            mapRing: ['b1', 'b2'],
          },
        }
      }
      throw new Error('unexpected')
    })
    const calls = hiveGraph({}, { counts: { s: { videos: 2 } } })
    const g = await buildGalaxy(c, { mode: 'mutuals', depth: 'nebula' })
    expect(h.get).toHaveBeenCalledWith('https://checker.test/galaxy/scan', expect.objectContaining({
      params: { center: c, mode: 'mutuals', depth: 'nebula' },
    }))
    expect(calls).toHaveLength(0)
    expect(g.ring).toEqual(['b1'])
    expect(g.mapRing).toEqual(['b1', 'b2'])
    expect(g.suggestions).toEqual([{
      name: 's', count: 7, via: ['b1'], rep: 60, active: 5, followers: 10, displayName: 'S', videos: 2, shorts: 0,
    }])
    expect(g.enriched.profiles).toBe(true)
  })

  it('works out profiles itself for an older checker that sends no map ring', async () => {
    const c = fresh('centre')
    h.get.mockResolvedValue({
      data: {
        success: true, following: ['b1'], followers: [], sampled: ['b1'],
        candidates: [{ name: 's', via: ['b1'], rep: 99 }],
      },
    })
    hiveGraph({}, { profiles: { s: { reputation: 42 } } })
    const g = await buildGalaxy(c)
    expect(g.mapRing).toBeNull()
    expect(g.ringLinks).toEqual({})
    expect(g.suggestions[0]).toMatchObject({ name: 's', count: 1, rep: 42 })
  })
})

describe('ringOnMap', () => {
  it('draws the scanned members first, then the rest up to the cap', () => {
    const data = { sampled: ['c', 'a'], ring: ['a', 'b', 'c', 'd', 'e'] }
    expect(ringOnMap(data, 4)).toEqual(['c', 'a', 'b', 'd'])
    expect(ringOnMap({ sampled: ['a', 'b', 'c'], ring: ['a', 'b', 'c', 'd'] }, 2)).toEqual(['a', 'b', 'c'])
  })

  it('uses the checker map ring when there is one', () => {
    expect(ringOnMap({ mapRing: ['x', 'y', 'z'], sampled: [], ring: [] }, 2)).toEqual(['x', 'y'])
  })

  it('caps at 700 stars by default', () => {
    const ring = Array.from({ length: 900 }, (_, i) => `r${i}`)
    expect(ringOnMap({ sampled: [], ring })).toHaveLength(MAX_RING_STARS)
  })
})

describe('scanGraph and findCircles', () => {
  // Two groups of scanned ring members, each leading to its own suggestions.
  function twoCircleScan() {
    const groupA = ['a1', 'a2', 'a3']
    const groupB = ['b1', 'b2', 'b3']
    const sugA = ['sa1', 'sa2']
    const sugB = ['sb1', 'sb2']
    return {
      center: 'me',
      mode: 'following',
      sampled: [...groupA, ...groupB],
      ring: [...groupA, ...groupB, 'loner'],
      ringLinks: { a1: ['a2', 'a3'], a2: ['a1', 'a3'], a3: ['a1'], b1: ['b2', 'b3'], b2: ['b1', 'b3'], b3: ['b1'] },
      suggestions: [
        ...sugA.map((name) => ({ name, via: groupA })),
        ...sugB.map((name) => ({ name, via: groupB })),
      ],
    }
  }

  it('keeps unlinked ring members off the graph and memoises per scan', () => {
    const data = twoCircleScan()
    const g = scanGraph(data)
    expect(g.nodes).not.toContain('loner')
    expect(g.ringCount).toBe(6)
    expect(g.n).toBe(10)
    expect(g.index.get('sa1')).toBe(6)
    expect(scanGraph(data)).toBe(g)
  })

  it('finds each circle with its ring members and suggestions, led by the most followed', () => {
    const circles = findCircles(twoCircleScan())
    expect(circles).toHaveLength(2)
    circles.forEach((c, i) => expect(c.id).toBe(`c${i}`))
    const a = circles.find((c) => c.ring.includes('a1'))
    const b = circles.find((c) => c.ring.includes('b1'))
    expect(a.ring.sort()).toEqual(['a1', 'a2', 'a3'])
    expect(a.suggestions.sort()).toEqual(['sa1', 'sa2'])
    expect(b.suggestions.sort()).toEqual(['sb1', 'sb2'])
    // sa1 and sa2 are each followed by all three scanned members; the tie goes
    // to the earlier node. Ring members follow within the ranking.
    expect(a.lead).toBe('sa1')
    expect(b.lead).toBe('sb1')
  })

  it('leaves out groups smaller than three', () => {
    const data = {
      center: 'me', mode: 'following', sampled: ['x'], ring: ['x'], ringLinks: {},
      suggestions: [{ name: 'y', via: ['x'] }],
    }
    expect(findCircles(data)).toEqual([])
  })
})
