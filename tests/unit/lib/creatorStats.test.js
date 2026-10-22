// Creator stats data layer and its formatting helpers (src/lib/creatorStats.js).
import { describe, it, expect, vi } from 'vitest'
import {
  fetchCreatorOverview,
  fetchCreatorTimeseries,
  fetchVideoAnalytics,
  fetchVideoHasStats,
  fetchCreatorDemographics,
  fmtDuration,
  timeAgo,
  fmtCount,
  countryFlag,
  countryLatLng,
  countryName,
} from '../../../src/lib/creatorStats.js'

const C = 'https://checker.3speak.tv'

describe('requests', () => {
  it('builds the query from username, days and content (all = no filter)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', f)
    await fetchCreatorOverview('a b', { days: 30, content: 'shorts' })
    await fetchCreatorTimeseries('alice', { content: 'all' })
    await fetchCreatorDemographics('alice')
    await fetchVideoAnalytics('alice', 'p/1')
    await fetchVideoHasStats('alice', 'p')
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${C}/creator-stats/overview?username=a%20b&days=30&content=shorts`,
      `${C}/creator-stats/timeseries?username=alice`,
      `${C}/creator-stats/demographics?username=alice`,
      `${C}/creator-stats/video?username=alice&permlink=p%2F1`,
      `${C}/creator-stats/has-data?username=alice&permlink=p`,
    ])
  })

  it('throws on an HTTP error or success:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(fetchCreatorOverview('alice')).rejects.toThrow('500')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, error: 'no data' }) }))
    await expect(fetchCreatorOverview('alice')).rejects.toThrow('no data')
  })
})

describe('fmtDuration', () => {
  it('shows hours+minutes, minutes+seconds or seconds', () => {
    expect(fmtDuration(3725)).toBe('1h 2m')
    expect(fmtDuration(125)).toBe('2m 5s')
    expect(fmtDuration(59.6)).toBe('1m 0s')
    expect(fmtDuration(7)).toBe('7s')
  })

  it('treats junk and negatives as zero', () => {
    expect(fmtDuration(-5)).toBe('0s')
    expect(fmtDuration('abc')).toBe('0s')
    expect(fmtDuration(undefined)).toBe('0s')
  })
})

describe('timeAgo', () => {
  it('reads a Hive timestamp without a zone as UTC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12))
    try {
      expect(timeAgo('2026-10-22T09:00:00')).toBe(timeAgo('2026-10-22T09:00:00Z'))
      expect(timeAgo('2026-10-22T09:00:00+02:00')).not.toBe(timeAgo('2026-10-22T09:00:00Z'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('is empty without a date', () => {
    expect(timeAgo('')).toBe('')
    expect(timeAgo(null)).toBe('')
  })
})

describe('country helpers', () => {
  it('turns a 2-letter code into a flag, anything else into a globe', () => {
    expect(countryFlag('de')).toBe('🇩🇪')
    expect(countryFlag('US')).toBe('🇺🇸')
    expect(countryFlag('')).toBe('🌐')
    expect(countryFlag('USA')).toBe('🌐')
  })

  it('looks up a centroid case-insensitively', () => {
    expect(countryLatLng('de')).toEqual([51.2, 10.4])
    expect(countryLatLng('XX')).toBeNull()
    expect(countryLatLng(null)).toBeNull()
  })

  it('names countries in English and falls back to the code', () => {
    expect(countryName('de')).toBe('Germany')
    expect(countryName('')).toBe('Unknown')
    expect(countryName('not-a-code')).toBe('not-a-code')
  })
})

it('fmtCount formats compactly', () => {
  expect(typeof fmtCount(12345)).toBe('string')
  expect(fmtCount(12345)).not.toBe('12345')
})
