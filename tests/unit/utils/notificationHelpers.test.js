// Rendering helpers for Hive notifications (src/utils/notificationHelpers.js).
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getNotificationPostKey, getNotificationRoute, getNotificationActor, getNotificationTypeLabel,
  formatNotificationMsg, formatNotifTime,
} from '../../../src/utils/notificationHelpers.js'

describe('notification links', () => {
  it('a post url gives its key and the universal post route, with or without @', () => {
    expect(getNotificationPostKey({ url: 'alice/my-post' })).toBe('alice/my-post')
    expect(getNotificationPostKey({ url: '@alice/my-post' })).toBe('alice/my-post')
    expect(getNotificationRoute({ url: 'alice/my-post' })).toBe('/post/alice/my-post')
    expect(getNotificationRoute({ url: '@alice/my-post' })).toBe('/post/alice/my-post')
  })

  it('a profile url routes to the profile and is not a post', () => {
    expect(getNotificationRoute({ url: '@alice' })).toBe('/p/alice')
    expect(getNotificationPostKey({ url: '@alice' })).toBeNull()
  })

  it('a transaction has no link', () => {
    expect(getNotificationRoute({ url: 'trx:abc123' })).toBeNull()
    expect(getNotificationPostKey({ url: 'trx:abc123' })).toBeNull()
  })

  it('a bare author falls back to the profile', () => {
    expect(getNotificationRoute({ url: 'alice' })).toBe('/p/alice')
    expect(getNotificationPostKey({ url: 'alice' })).toBeNull()
  })

  it('is null without a url', () => {
    expect(getNotificationRoute(null)).toBeNull()
    expect(getNotificationRoute({})).toBeNull()
    expect(getNotificationPostKey(undefined)).toBeNull()
    expect(getNotificationRoute({ url: '/' })).toBeNull()
  })
})

describe('getNotificationActor and labels', () => {
  it('reads the leading @account from the message', () => {
    expect(getNotificationActor({ msg: '@alice.bob voted on your post ($0.01)' })).toBe('alice.bob')
    expect(getNotificationActor({ msg: 'someone @alice' })).toBeNull()
    expect(getNotificationActor({})).toBeNull()
  })

  it('labels known types and falls back to the raw type', () => {
    expect(getNotificationTypeLabel('reply_comment')).toBe('replied')
    expect(getNotificationTypeLabel('pin_post')).toBe('pinned your post')
    expect(getNotificationTypeLabel('new_thing')).toBe('new_thing')
    expect(getNotificationTypeLabel(undefined)).toBe('did something')
  })
})

describe('formatNotificationMsg', () => {
  it('drops "and 0 others" and singularises "and 1 others"', () => {
    expect(formatNotificationMsg('@alice mentioned you and 0 others')).toBe('@alice mentioned you')
    expect(formatNotificationMsg('@alice mentioned you and 1 others')).toBe('@alice mentioned you and 1 other')
    expect(formatNotificationMsg('@alice mentioned you and 5 others')).toBe('@alice mentioned you and 5 others')
  })

  it('leaves larger counts that start with 0 or 1 alone', () => {
    expect(formatNotificationMsg('@a mentioned you and 10 others')).toBe('@a mentioned you and 10 others')
  })

  it('passes non-strings through', () => {
    expect(formatNotificationMsg('')).toBe('')
    expect(formatNotificationMsg(null)).toBeNull()
  })
})

describe('formatNotifTime', () => {
  afterEach(() => vi.useRealTimers())
  const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
  const ago = (ms) => new Date(NOW - ms).toISOString().replace(/\.\d+Z$/, '')

  it('reads Hive dates as UTC and gives a short age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(formatNotifTime(ago(30 * 1000))).toBe('30s')
    expect(formatNotifTime(ago(5 * 60 * 1000))).toBe('5m')
    expect(formatNotifTime(ago(3 * 3600 * 1000))).toBe('3h')
    expect(formatNotifTime(ago(2 * 86400 * 1000))).toBe('2d')
    expect(formatNotifTime(ago(65 * 86400 * 1000))).toBe('2mo')
    expect(formatNotifTime(ago(800 * 86400 * 1000))).toBe('2y')
  })

  it('accepts a date that already ends in Z and never shows a negative age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(formatNotifTime(new Date(NOW - 120000).toISOString())).toBe('2m')
    expect(formatNotifTime(new Date(NOW + 60000).toISOString())).toBe('0s')
    expect(formatNotifTime('')).toBe('')
  })
})
