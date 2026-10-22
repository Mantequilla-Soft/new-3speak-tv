// Feed date filters and relative dates (src/utils/dateFilters.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const i18n = vi.hoisted(() => ({
  t: vi.fn((k) => `T(${k})`),
  formatTimeAgo: vi.fn(() => 'AGO'),
  formatDate: vi.fn(() => 'DATE'),
}))
vi.mock('../../../src/i18n', () => i18n)

const { DATE_FILTERS, getSinceTimestamp, formatRelativeDate } = await import('../../../src/utils/dateFilters.js')

// Wednesday 2026-10-21 15:30 local time.
const NOW = new Date(2026, 9, 21, 15, 30, 0)
const sec = (d) => Math.floor(d.getTime() / 1000)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => vi.useRealTimers())

describe('getSinceTimestamp', () => {
  it('offers all, today, week and month', () => {
    expect(DATE_FILTERS.map((f) => f.key)).toEqual(['all', 'today', 'week', 'month'])
  })

  it('all and unknown keys mean no limit', () => {
    expect(getSinceTimestamp('all')).toBe(0)
    expect(getSinceTimestamp('year')).toBe(0)
    expect(getSinceTimestamp(undefined)).toBe(0)
  })

  it('today starts at local midnight', () => {
    expect(getSinceTimestamp('today')).toBe(sec(new Date(2026, 9, 21)))
  })

  it('week is the past seven days, not the calendar week', () => {
    expect(getSinceTimestamp('week')).toBe(sec(NOW) - 7 * 86400)
  })

  it('month starts on the first of the month', () => {
    expect(getSinceTimestamp('month')).toBe(sec(new Date(2026, 9, 1)))
  })

  it('on the first day of a month, month and today agree', () => {
    vi.setSystemTime(new Date(2026, 10, 1, 0, 5))
    expect(getSinceTimestamp('month')).toBe(getSinceTimestamp('today'))
  })
})

describe('formatRelativeDate', () => {
  it('is empty without a date', () => {
    expect(formatRelativeDate(0)).toBe('')
    expect(formatRelativeDate(null)).toBe('')
  })

  it('says just now for under a minute, and for a time slightly in the future', () => {
    expect(formatRelativeDate(NOW.getTime() - 30000)).toBe('T(feeds.dateFilters.justNow)')
    expect(formatRelativeDate(NOW.getTime() + 60000)).toBe('T(feeds.dateFilters.justNow)')
  })

  it('uses a narrow time-ago under a week and a short date after', () => {
    expect(formatRelativeDate(NOW.getTime() - 3 * 3600 * 1000)).toBe('AGO')
    expect(i18n.formatTimeAgo).toHaveBeenLastCalledWith(new Date(NOW.getTime() - 3 * 3600 * 1000), { style: 'narrow' })
    expect(formatRelativeDate(NOW.getTime() - 8 * 86400 * 1000)).toBe('DATE')
    expect(i18n.formatDate).toHaveBeenLastCalledWith(new Date(NOW.getTime() - 8 * 86400 * 1000), { month: 'short', day: 'numeric' })
  })

  it('reads unix seconds, milliseconds and date strings alike', () => {
    const twoHours = NOW.getTime() - 2 * 3600 * 1000
    formatRelativeDate(Math.floor(twoHours / 1000))
    expect(i18n.formatTimeAgo.mock.lastCall[0].getTime()).toBe(Math.floor(twoHours / 1000) * 1000)
    formatRelativeDate(twoHours)
    expect(i18n.formatTimeAgo.mock.lastCall[0].getTime()).toBe(twoHours)
    formatRelativeDate(new Date(twoHours).toISOString())
    expect(i18n.formatTimeAgo.mock.lastCall[0].getTime()).toBe(twoHours)
  })
})
