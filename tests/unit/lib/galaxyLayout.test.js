// Layout maths for the Hive galaxy (src/lib/galaxyLayout.js): seeds, the even
// sphere shell, the force layout that pulls linked accounts together and the
// Louvain community detection that names the circles.
import { describe, it, expect } from 'vitest'
import { seedOf, shell, clusterDirections, louvain } from '../../../src/lib/galaxyLayout.js'

const dir = (p, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))

// Two tight cliques of `size` nodes, joined by a single bridge edge.
function twoCliques(size) {
  const edges = []
  for (const base of [0, size]) {
    for (let i = 0; i < size; i += 1) {
      for (let j = i + 1; j < size; j += 1) edges.push([base + i, base + j])
    }
  }
  edges.push([0, size])
  return edges
}

describe('seedOf', () => {
  it('is stable for the same text and differs for different text', () => {
    expect(seedOf('alice:following')).toBe(seedOf('alice:following'))
    expect(seedOf('alice:following')).not.toBe(seedOf('alice:followers'))
  })

  it('reads non-strings as text and stays an unsigned 32 bit number', () => {
    expect(seedOf(123)).toBe(seedOf('123'))
    expect(seedOf('')).toBe(0)
    const big = seedOf('x'.repeat(500))
    expect(big).toBeGreaterThanOrEqual(0)
    expect(big).toBeLessThan(2 ** 32)
  })
})

describe('shell', () => {
  it('places n points within the jittered radius with squashed poles', () => {
    const pts = shell(50, 10, 0.2, 42)
    expect(pts).toHaveLength(50)
    pts.forEach(([x, y, z]) => {
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(11 + 1e-9)
      expect(Math.abs(y)).toBeLessThanOrEqual(11 * 0.8 + 1e-9)
    })
  })

  it('puts every point exactly on the radius when there is no jitter', () => {
    shell(20, 5, 0, 1).forEach(([x, y, z]) => {
      // Undo the 0.8 pole squash to get back to the sphere.
      expect(Math.hypot(x, y / 0.8, z)).toBeCloseTo(5, 9)
    })
  })

  it('is deterministic for a seed and changes with it', () => {
    expect(shell(10, 3, 0.5, 9)).toEqual(shell(10, 3, 0.5, 9))
    expect(shell(10, 3, 0.5, 9)).not.toEqual(shell(10, 3, 0.5, 10))
  })

  it('answers an empty list for zero points', () => {
    expect(shell(0, 1, 0, 1)).toEqual([])
  })
})

describe('clusterDirections', () => {
  it('answers an empty array for no nodes', () => {
    const p = clusterDirections(0, [])
    expect(p).toBeInstanceOf(Float32Array)
    expect(p).toHaveLength(0)
  })

  it('returns one unit vector per node', () => {
    const p = clusterDirections(12, [[0, 1], [1, 2]], { iterations: 30 })
    expect(p).toHaveLength(36)
    for (let i = 0; i < 12; i += 1) expect(Math.hypot(...dir(p, i))).toBeCloseTo(1, 4)
  })

  it('is deterministic for a seed', () => {
    const edges = twoCliques(4)
    expect(clusterDirections(8, edges, { seed: 3, iterations: 40 }))
      .toEqual(clusterDirections(8, edges, { seed: 3, iterations: 40 }))
    expect(clusterDirections(8, edges, { seed: 3, iterations: 40 }))
      .not.toEqual(clusterDirections(8, edges, { seed: 4, iterations: 40 }))
  })

  it('pulls a clique into one patch, closer together than to the other clique', () => {
    const size = 6
    const p = clusterDirections(size * 2, twoCliques(size), { seed: 5, iterations: 200 })
    const inside = angle(dir(p, 1), dir(p, 2))
    const across = angle(dir(p, 1), dir(p, size + 1))
    expect(inside).toBeLessThan(across)
  })

  it('pulls a group together even without links when groups are given', () => {
    const groups = [0, 0, 0, 0, 1, 1, 1, 1]
    const loose = clusterDirections(8, [], { seed: 2, iterations: 120 })
    const grouped = clusterDirections(8, [], { seed: 2, iterations: 120, groups })
    const spread = (p) => angle(dir(p, 0), dir(p, 1)) + angle(dir(p, 2), dir(p, 3))
    expect(spread(grouped)).toBeLessThan(spread(loose))
  })

  it('leaves groups of fewer than three members to the plain forces', () => {
    const groups = [0, 0, 1, 2]
    expect(clusterDirections(4, [], { seed: 2, iterations: 20, groups }))
      .toEqual(clusterDirections(4, [], { seed: 2, iterations: 20 }))
  })
})

describe('louvain', () => {
  it('splits two cliques joined by one bridge into two groups', () => {
    const g = louvain(10, twoCliques(5))
    expect(new Set(g.slice(0, 5)).size).toBe(1)
    expect(new Set(g.slice(5)).size).toBe(1)
    expect(g[0]).not.toBe(g[5])
  })

  it('keeps every node in its own group when there are no edges', () => {
    expect(louvain(4, [])).toEqual([0, 1, 2, 3])
  })

  it('ignores self loops', () => {
    expect(louvain(3, [[0, 0], [1, 1]])).toEqual([0, 1, 2])
  })

  it('is deterministic for a seed and numbers groups from zero', () => {
    const edges = twoCliques(4)
    const a = louvain(8, edges, { seed: 11 })
    expect(louvain(8, edges, { seed: 11 })).toEqual(a)
    expect([...new Set(a)].sort()).toEqual([0, 1])
  })

  it('merges a single connected pair into one group', () => {
    const g = louvain(3, [[0, 1]])
    expect(g[0]).toBe(g[1])
    expect(g[2]).not.toBe(g[0])
  })
})
