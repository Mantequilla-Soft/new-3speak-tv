// The podcast library rules (src/lib/podcastLibrary.js): smart filters, the
// "New" inbox, new episodes to the queue, and the small formatting helpers.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isUnplayed, isInProgress, inboxSince, isInboxEpisode, matchesListenFilter, seasonsOf, trailerOf, isLiveNow,
  readAutoQueue, setAutoQueue, markAutoQueued, pickAutoQueue, readMineVisit, markMineVisit,
  fmtClock, fmtBytes, episodeShareUrl, deepLinkTimes, INBOX_DAYS, INBOX_MAX_DAYS,
} from '../../../src/lib/podcastLibrary.js'

const DAY = 24 * 3600 * 1000
const NOW = Date.parse('2026-10-30T12:00:00Z')
const iso = (ms) => new Date(ms).toISOString()

describe('listening state', () => {
  it('unplayed: never played or stopped in the first seconds', () => {
    expect(isUnplayed(null)).toBe(true)
    expect(isUnplayed({ pos: 3, done: false })).toBe(true)
    expect(isUnplayed({ pos: 30, done: false })).toBe(false)
    expect(isUnplayed({ pos: 0, done: true })).toBe(false)
  })

  it('in progress: started, not finished', () => {
    expect(isInProgress(null)).toBe(false)
    expect(isInProgress({ pos: 30, done: false })).toBe(true)
    expect(isInProgress({ pos: 3000, done: true })).toBe(false)
  })
})

describe('the New inbox', () => {
  it('goes back a week for a regular listener', () => {
    expect(inboxSince(NOW - 3600 * 1000, NOW)).toBe(NOW - INBOX_DAYS * DAY)
    expect(inboxSince(0, NOW)).toBe(NOW - INBOX_DAYS * DAY)
  })

  it('goes back to the last visit after a longer break, but not past the cap', () => {
    expect(inboxSince(NOW - 20 * DAY, NOW)).toBe(NOW - 20 * DAY)
    expect(inboxSince(NOW - 90 * DAY, NOW)).toBe(NOW - INBOX_MAX_DAYS * DAY)
  })

  it('only takes unplayed episodes', () => {
    const ep = { id: 'a', published_at: iso(NOW - 2 * DAY) }
    expect(isInboxEpisode(ep, null, 0, NOW)).toBe(true)
    expect(isInboxEpisode(ep, { pos: 100, done: false }, 0, NOW)).toBe(false)
    expect(isInboxEpisode({ id: 'b', published_at: iso(NOW - 10 * DAY) }, null, 0, NOW)).toBe(false)
    expect(isInboxEpisode({ id: 'b', published_at: iso(NOW - 10 * DAY) }, null, NOW - 12 * DAY, NOW)).toBe(true)
    expect(isInboxEpisode({ id: 'c' }, null, 0, NOW)).toBe(false)
  })

  it('remembers the last visit per account', () => {
    markMineVisit('alice', 1234)
    expect(readMineVisit('alice')).toBe(1234)
    expect(readMineVisit('bob')).toBe(0)
  })
})

describe('matchesListenFilter', () => {
  const progress = { played: { pos: 2000, dur: 2000, done: true }, half: { pos: 600, dur: 1200, done: false } }
  const ctx = { progressOf: (id) => progress[id] || null, isDownloaded: (id) => id === 'half', lastVisit: 0, now: NOW }
  const eps = [
    { id: 'played', published_at: iso(NOW - DAY) },
    { id: 'half', published_at: iso(NOW - DAY) },
    { id: 'fresh', published_at: iso(NOW - DAY) },
    { id: 'old', published_at: iso(NOW - 40 * DAY) },
  ]
  const ids = (filter) => eps.filter((e) => matchesListenFilter(e, filter, ctx)).map((e) => e.id)

  it('sorts episodes into the smart filters', () => {
    expect(ids('all')).toEqual(['played', 'half', 'fresh', 'old'])
    expect(ids('unplayed')).toEqual(['fresh', 'old'])
    expect(ids('inProgress')).toEqual(['half'])
    expect(ids('downloaded')).toEqual(['half'])
    expect(ids('new')).toEqual(['fresh'])
  })
})

describe('feed extras', () => {
  it('lists the seasons and finds the newest trailer', () => {
    const eps = [{ id: 1, season: 2 }, { id: 2, season: 1, episode_type: 'trailer' }, { id: 3 }, { id: 4, season: '2' }, { id: 5, episode_type: 'trailer' }]
    expect(seasonsOf(eps)).toEqual([1, 2])
    expect(trailerOf(eps).id).toBe(2)
    expect(trailerOf([{ id: 1 }])).toBeNull()
  })

  it('tells a show on air', () => {
    expect(isLiveNow({ live: [{ status: 'pending' }, { status: 'live' }] })).toBe(true)
    expect(isLiveNow({ live: [{ status: 'pending' }] })).toBe(false)
    expect(isLiveNow({})).toBe(false)
  })
})

describe('new episodes to the queue', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the switch per account and per show', () => {
    setAutoQueue('alice', 'f1', true, 1000)
    expect(readAutoQueue('alice').feeds).toEqual({ f1: 1000 })
    expect(readAutoQueue('bob').feeds).toEqual({})
    setAutoQueue('alice', 'f1', false)
    expect(readAutoQueue('alice').feeds).toEqual({})
  })

  it('remembers what went to the queue', () => {
    markAutoQueued('alice', ['a', 'b'])
    markAutoQueued('alice', ['b', 'c'])
    expect(readAutoQueue('alice').added).toEqual(['a', 'b', 'c'])
  })

  it('picks only new, unplayed, not yet queued episodes of switched-on shows, oldest first', () => {
    const on = NOW - 5 * DAY
    const settings = { feeds: { f1: on }, added: ['seen'] }
    const eps = [
      { id: 'new2', feed_id: 'f1', published_at: iso(NOW - DAY) },
      { id: 'new1', feed_id: 'f1', published_at: iso(NOW - 2 * DAY) },
      { id: 'before', feed_id: 'f1', published_at: iso(NOW - 6 * DAY) },
      { id: 'other', feed_id: 'f2', published_at: iso(NOW - DAY) },
      { id: 'seen', feed_id: 'f1', published_at: iso(NOW - DAY) },
      { id: 'played', feed_id: 'f1', published_at: iso(NOW - DAY) },
      { id: 'queued', feed_id: 'f1', published_at: iso(NOW - DAY) },
      { id: 'current', feed_id: 'f1', published_at: iso(NOW - DAY) },
    ]
    const picked = pickAutoQueue(eps, settings, {
      progressOf: (id) => (id === 'played' ? { pos: 900, done: false } : null),
      queuedIds: new Set(['queued']),
      currentId: 'current',
    })
    expect(picked.map((e) => e.id)).toEqual(['new1', 'new2'])
  })

  it('prefers the first-seen time when the list has it', () => {
    const settings = { feeds: { f1: NOW - DAY }, added: [] }
    const eps = [{ id: 'backdated', feed_id: 'f1', published_at: iso(NOW - 3 * DAY), first_seen_at: iso(NOW - 3600 * 1000) }]
    expect(pickAutoQueue(eps, settings, { progressOf: () => null, queuedIds: new Set() })).toHaveLength(1)
  })
})

describe('formatting', () => {
  it('clock times', () => {
    expect(fmtClock(754)).toBe('12:34')
    expect(fmtClock(3723)).toBe('1:02:03')
    expect(fmtClock(5)).toBe('0:05')
    expect(fmtClock(-3)).toBe('0:00')
  })

  it('sizes', () => {
    expect(fmtBytes(1536000)).toBe('1.5 MB')
    expect(fmtBytes(250000000)).toBe('250 MB')
    expect(fmtBytes(2e9)).toBe('2.0 GB')
    expect(fmtBytes(900)).toBe('900 B')
  })

  it('share links at a timestamp', () => {
    const path = '/audio?type=external&episode=f%3A1'
    expect(episodeShareUrl('https://3speak.tv', path)).toBe('https://3speak.tv/audio?type=external&episode=f%3A1')
    expect(episodeShareUrl('https://3speak.tv', path, 754.6)).toBe('https://3speak.tv/audio?type=external&episode=f%3A1&t=754')
    expect(episodeShareUrl('https://3speak.tv', path, 10, 25.2)).toBe('https://3speak.tv/audio?type=external&episode=f%3A1&t=10&end=26')
  })

  it('reads a deep link', () => {
    expect(deepLinkTimes(new URLSearchParams('t=754&end=800'))).toEqual({ t: 754, end: 800 })
    expect(deepLinkTimes(new URLSearchParams('t=754&end=10'))).toEqual({ t: 754, end: null })
    expect(deepLinkTimes(new URLSearchParams('t=abc'))).toEqual({ t: null, end: null })
    expect(deepLinkTimes(new URLSearchParams(''))).toEqual({ t: null, end: null })
  })
})
