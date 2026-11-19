// Series of Shorts on playlists (src/lib/series.js): the mark, the parts in
// order, a Short's place, and whose series counts.
import { describe, it, expect } from 'vitest'
import { isSeries, seriesParts, seriesPosition, seriesOf, SERIES_META } from '../../../src/lib/series'

const series = (extra = {}) => ({
  id: 'pl-1', owner: 'badadib', name: 'Garden diary', type: 'video',
  json_metadata: JSON.stringify(SERIES_META),
  items: [
    { author: 'badadib', permlink: 'two', position: 1 },
    { author: 'badadib', permlink: 'three', position: 2 },
    { author: 'badadib', permlink: 'one', position: 0 },
  ],
  ...extra,
})

describe('series', () => {
  it('is a video playlist marked series in json_metadata (string, twice encoded or object)', () => {
    expect(isSeries(series())).toBe(true)
    expect(isSeries(series({ json_metadata: JSON.stringify(JSON.stringify(SERIES_META)) }))).toBe(true)
    expect(isSeries(series({ json_metadata: { series: true } }))).toBe(true)
    expect(isSeries(series({ json_metadata: JSON.stringify({ type: 'video' }) }))).toBe(false)
    expect(isSeries(series({ type: 'audio', json_metadata: JSON.stringify({ type: 'audio', series: true }) }))).toBe(false)
    expect(isSeries(null)).toBe(false)
  })

  it('numbers the parts by position, with the next and previous part', () => {
    expect(seriesParts(series()).map((p) => p.permlink)).toEqual(['one', 'two', 'three'])
    const at = seriesPosition(series(), 'badadib', 'two')
    expect(at).toMatchObject({ part: 2, total: 3 })
    expect(at.next.permlink).toBe('three')
    expect(at.prev.permlink).toBe('one')
    expect(seriesPosition(series(), 'badadib', 'three').next).toBeNull()
    expect(seriesPosition(series(), 'badadib', 'other')).toBeNull()
  })

  it('a Short belongs to its creator\'s own series, never to someone else\'s', () => {
    const theirs = series({ id: 'pl-2', owner: 'fan' })
    const plain = series({ id: 'pl-3', json_metadata: '{}' })
    expect(seriesOf([theirs, plain, series()], 'badadib').id).toBe('pl-1')
    expect(seriesOf([theirs, plain], 'badadib')).toBeNull()
    expect(seriesOf(undefined, 'badadib')).toBeNull()
  })
})
