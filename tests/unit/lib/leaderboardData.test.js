// Leaderboards: request shapes, which metrics have topic boards, profile badge
// selection (tiers, activity floors, cap) and labels (src/lib/leaderboardData.js).
import { describe, it, expect, vi } from 'vitest'
import {
  fetchLeaderboard,
  fetchUserLeaderboardStats,
  fetchTopics,
  fetchTopicLeaderboard,
  fetchLeaderboardBadges,
  metricSupportsTopics,
  metricById,
  visibleBadges,
  badgeLabel,
  badgeTitle,
  formatDuration,
  formatMetric,
  METRICS,
  BOARD_TYPES,
  MAX_PROFILE_BADGES,
} from '../../../src/lib/leaderboardData.js'

const C = 'https://checker.3speak.tv'

describe('requests', () => {
  it('builds each board URL with its defaults', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) })
    vi.stubGlobal('fetch', f)
    await fetchLeaderboard()
    await fetchLeaderboard({ window: '30d', metric: 'streams', limit: 10, page: 2 })
    await fetchUserLeaderboardStats('a b')
    await fetchTopics()
    await fetchTopicLeaderboard({ topic: 'music & art' })
    await fetchLeaderboardBadges('alice')
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${C}/leaderboard?window=7d&metric=video_watch_secs&limit=50&page=1`,
      `${C}/leaderboard?window=30d&metric=streams&limit=10&page=2`,
      `${C}/leaderboard/user/a%20b?window=7d`,
      `${C}/leaderboard/topics`,
      `${C}/leaderboard/topic?topic=music%20%26%20art&window=7d&metric=video_watch_secs&limit=50&page=1`,
      `${C}/leaderboard/badges/alice`,
    ])
  })

  it('throws on an HTTP error or success:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(fetchTopics()).rejects.toThrow('503')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }))
    await expect(fetchTopics()).rejects.toThrow('leaderboard error')
  })
})

describe('metrics', () => {
  it('only the four content metrics have topic boards', () => {
    expect(['video_uploads', 'short_uploads', 'video_watch_secs', 'short_watch_secs'].every(metricSupportsTopics)).toBe(true)
    expect(metricSupportsTopics('tags_given')).toBe(false)
    expect(metricSupportsTopics('streams')).toBe(false)
  })

  it('an unknown metric falls back to the first one', () => {
    expect(metricById('streams').id).toBe('streams')
    expect(metricById('nope')).toBe(METRICS[0])
  })

  it('every metric is reachable from a board type', () => {
    const boardMetrics = BOARD_TYPES.flatMap((bt) => bt.metrics.map((m) => m.id))
    for (const m of METRICS) expect(boardMetrics).toContain(m.id)
  })
})

describe('visibleBadges', () => {
  it('shows only Top 50 and better', () => {
    const out = visibleBadges([
      { metric: 'video_uploads', tier: 'top100', value: 99 },
      { metric: 'video_uploads', tier: 'top50', value: 1 },
      { metric: 'short_uploads', tier: 'top1', value: 1 },
    ])
    expect(out.map((b) => b.tier)).toEqual(['top50', 'top1'])
  })

  it('requires real activity on the young streaming boards', () => {
    const out = visibleBadges([
      { metric: 'streams', tier: 'top1', value: 4 },
      { metric: 'streams', tier: 'top1', value: 5 },
      { metric: 'stream_secs', tier: 'top3', value: 3599 },
      { metric: 'boost_amount_received', tier: 'top1', value: '10' },
    ])
    expect(out.map((b) => [b.metric, b.value])).toEqual([['streams', 5], ['boost_amount_received', '10']])
  })

  it('keeps the checker\'s order and caps at three', () => {
    expect(MAX_PROFILE_BADGES).toBe(3)
    const badges = ['a', 'b', 'c', 'd'].map((x) => ({ metric: 'video_uploads', tier: 'top10', value: 1, id: x }))
    expect(visibleBadges(badges).map((b) => b.id)).toEqual(['a', 'b', 'c'])
    expect(visibleBadges(null)).toEqual([])
  })
})

describe('badge text', () => {
  it('uses the short noun, then the board label, then the raw id', () => {
    expect(badgeLabel({ metric: 'video_uploads', tier_label: '#1' })).toBe('#1 Videos')
    expect(badgeLabel({ metric: 'streams', tier_label: 'Top 3' })).toBe('Top 3 Streams')
    expect(badgeLabel({ metric: 'mystery', tier_label: '#1' })).toBe('#1 mystery')
  })

  it('titles all-time and windowed badges', () => {
    expect(badgeTitle({ metric: 'video_uploads', rank: 2, window: 'all' })).toBe('Ranked #2 for videos uploaded over all time')
    expect(badgeTitle({ metric: 'video_uploads', rank: 5, window: '7d' })).toBe('Ranked #5 for videos uploaded over the last 7 days')
  })
})

describe('formatting', () => {
  it('formatDuration: 4h 12m / 12m 30s / 45s', () => {
    expect(formatDuration(4 * 3600 + 12 * 60 + 5)).toBe('4h 12m')
    expect(formatDuration(750)).toBe('12m 30s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(-3)).toBe('0s')
    expect(formatDuration(null)).toBe('0s')
  })

  it('formatMetric picks the duration format only for durations', () => {
    expect(formatMetric(90, 'duration')).toBe('1m 30s')
    expect(formatMetric(1234, 'count')).not.toBe('20m 34s')
  })
})
