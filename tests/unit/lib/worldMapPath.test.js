// The land silhouette for the viewer map (src/lib/worldMapPath.js): the real
// atlas projects into the 360 by 180 viewBox, rings that cross the
// antimeridian are split instead of streaking across, and a decode failure
// leaves an empty path rather than breaking the page.
import { describe, it, expect, afterEach, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('topojson-client')
  vi.resetModules()
})

async function withLand(land) {
  vi.resetModules()
  vi.doMock('topojson-client', () => ({ feature: () => land }))
  return (await import('../../../src/lib/worldMapPath.js')).WORLD_LAND_PATH
}

describe('WORLD_LAND_PATH from the real atlas', () => {
  it('is a closed path of move and line commands inside the viewBox', async () => {
    const { WORLD_LAND_PATH } = await import('../../../src/lib/worldMapPath.js')
    expect(WORLD_LAND_PATH.length).toBeGreaterThan(1000)
    expect(WORLD_LAND_PATH.startsWith('M')).toBe(true)
    expect(WORLD_LAND_PATH.endsWith('Z')).toBe(true)
    const points = [...WORLD_LAND_PATH.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)]
    points.forEach(([, x, y]) => {
      expect(+x).toBeGreaterThanOrEqual(0)
      expect(+x).toBeLessThanOrEqual(360)
      expect(+y).toBeGreaterThanOrEqual(0)
      expect(+y).toBeLessThanOrEqual(180)
    })
  })
})

describe('WORLD_LAND_PATH projection', () => {
  it('maps lng/lat to x = lng + 180, y = 90 - lat with one decimal', async () => {
    const d = await withLand({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10.04, 20], [10, -30]]] },
    })
    expect(d).toBe('M180.0,90.0L190.0,70.0L190.0,120.0Z')
  })

  it('starts a new subpath when a ring jumps across the antimeridian', async () => {
    const d = await withLand({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[179, 60], [-179, 60], [-178, 61]]] },
    })
    expect(d).toBe('M359.0,30.0ZM1.0,30.0L2.0,29.0Z')
  })

  it('reads feature collections and multipolygons and skips empty geometries', async () => {
    const d = await withLand({
      type: 'FeatureCollection',
      features: [
        { geometry: null },
        { geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0]]], [[[2, 0], [3, 0]], []]] } },
      ],
    })
    expect(d).toBe('M180.0,90.0L181.0,90.0ZM182.0,90.0L183.0,90.0Z')
  })

  it('is an empty string when the atlas cannot be decoded', async () => {
    vi.resetModules()
    vi.doMock('topojson-client', () => ({ feature: () => { throw new Error('bad topology') } }))
    const { WORLD_LAND_PATH } = await import('../../../src/lib/worldMapPath.js')
    expect(WORLD_LAND_PATH).toBe('')
  })
})
