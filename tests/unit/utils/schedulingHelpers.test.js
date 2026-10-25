// Scheduling a video post (src/utils/schedulingHelpers.js): the datetime-local
// format, the allowed window, and turning the picked time into API parameters.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatDateTimeLocal, getMinMaxDates, getSchedulingParams, formatScheduledDateDisplay,
} from '../../../src/utils/schedulingHelpers.js'

const NOW = new Date(2026, 9, 22, 12, 0, 0) // local time

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers() })

describe('formatDateTimeLocal', () => {
  it('formats local time as YYYY-MM-DDTHH:MM with zero padding', () => {
    expect(formatDateTimeLocal(new Date(2026, 0, 5, 9, 7, 59))).toBe('2026-01-05T09:07')
    expect(formatDateTimeLocal(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31T23:59')
  })
})

describe('getMinMaxDates', () => {
  it('allows from 15 minutes to 90 days ahead', () => {
    const { minDate, maxDate, minFormatted, maxFormatted } = getMinMaxDates()
    expect(minDate.getTime() - NOW.getTime()).toBe(15 * 60 * 1000)
    expect(maxDate.getTime() - NOW.getTime()).toBe(90 * 24 * 60 * 60 * 1000)
    expect(minFormatted).toBe('2026-10-22T12:15')
    expect(maxFormatted).toBe(formatDateTimeLocal(maxDate))
  })
})

describe('getSchedulingParams', () => {
  it('publishes immediately when scheduling is off', () => {
    expect(getSchedulingParams(false, '2026-10-23T10:00')).toEqual({ publish_type: 'publish' })
  })

  it('falls back to publishing now when no time was picked', () => {
    expect(getSchedulingParams(true, '')).toEqual({ publish_type: 'publish' })
  })

  it('turns a future local time into unix seconds', () => {
    const value = '2026-10-23T08:30'
    expect(getSchedulingParams(true, value)).toEqual({
      publish_type: 'schedule',
      publish_data: Math.floor(new Date(2026, 9, 23, 8, 30).getTime() / 1000),
    })
  })

  it('rejects a time in the past or exactly now', () => {
    expect(getSchedulingParams(true, '2026-10-22T11:59')).toMatchObject({ publish_type: 'error' })
    expect(getSchedulingParams(true, '2026-10-22T12:00')).toMatchObject({ publish_type: 'error' })
  })

  it('an unparseable time is rejected instead of throwing', () => {
    expect(getSchedulingParams(true, 'not-a-date')).toMatchObject({ publish_type: 'error' })
  })
})

describe('formatScheduledDateDisplay', () => {
  it('shows a readable US-style date and 12-hour time', () => {
    const out = formatScheduledDateDisplay('2026-01-05T14:30')
    expect(out).toContain('Jan 5, 2026')
    expect(out).toContain('2:30')
    expect(out).toContain('PM')
  })

  it('is empty without a value', () => {
    expect(formatScheduledDateDisplay('')).toBe('')
    expect(formatScheduledDateDisplay(undefined)).toBe('')
  })
})
