// Outside podcast shows inside a 3Speak playlist (src/lib/playlistFeeds.js):
// reading and writing them in json_metadata, and merging their episodes by date
// with the playlist's own items. The checker side is 3speakchecks utils/playlistFeeds.js.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))
vi.mock('../../../src/hive-api/aioha', () => ({
  signMessageWithAioha: vi.fn(), getCurrentProvider: vi.fn(), isManteAuthLogin: vi.fn(), KeyTypes: {}, Providers: {},
}))
vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(), lastVouchUser: vi.fn() }))

import {
  MAX_PLAYLIST_FEEDS, playlistFeedsOf, withPlaylistFeeds, isOwnPlaylistFeed, itemTime, mergeByDate,
} from '../../../src/lib/playlistFeeds.js'

describe('the shows in json_metadata', () => {
  it('keeps valid public http(s) feeds, once each, titles trimmed and capped', () => {
    expect(playlistFeedsOf({
      feeds: [
        { url: 'https://www.a.example/rss/', title: `  ${'T'.repeat(150)}  ` },
        { url: 'http://a.example/rss' },
        'https://b.example/rss',
        { url: 'https://user:pw@c.example/rss' },
        { url: 'ftp://d.example/rss' },
        { url: 'nope' },
        null,
      ],
    })).toEqual([{ url: 'https://www.a.example/rss/', title: 'T'.repeat(100) }, { url: 'https://b.example/rss' }])
    expect(playlistFeedsOf({})).toEqual([])
    expect(playlistFeedsOf(null)).toEqual([])
    const many = Array.from({ length: 40 }, (_, i) => ({ url: `https://e.example/${i}` }))
    expect(playlistFeedsOf({ feeds: many })).toHaveLength(MAX_PLAYLIST_FEEDS)
  })

  it('replaces the list and keeps everything else; no shows drops the key', () => {
    const meta = { tags: ['a'], type: 'audio', feeds: [{ url: 'https://old.example/rss' }] }
    expect(withPlaylistFeeds(meta, [{ url: 'https://new.example/rss', title: 'New' }]))
      .toEqual({ tags: ['a'], type: 'audio', feeds: [{ url: 'https://new.example/rss', title: 'New' }] })
    expect(withPlaylistFeeds(meta, [])).toEqual({ tags: ['a'], type: 'audio' })
    expect(meta.feeds).toHaveLength(1)
  })

  it('knows the playlist\'s own feed', () => {
    expect(isOwnPlaylistFeed('https://3speak.tv/rss/playlist/abc-123.xml', 'abc-123')).toBe(true)
    expect(isOwnPlaylistFeed('https://3speak.tv/rss/playlist/other.xml', 'abc-123')).toBe(false)
  })
})

describe('merging by date', () => {
  const video = (permlink, created, extra = {}) => ({ author: 'alice', permlink, created_at: created, ...extra })
  const ep = (id, published, extra = {}) => ({ id, feed_id: 'f1', title: id, published_at: published, ...extra })
  const FEEDS = [{ id: 'f1', title: 'Show' }]

  it('reads Hive dates as UTC, and prefers the audio row\'s own date', () => {
    expect(itemTime(video('a', '2026-11-01T10:00:00'))).toBe(Date.parse('2026-11-01T10:00:00Z'))
    expect(itemTime(video('a', '2026-11-01T10:00:00', { audioDoc: { createdAt: '2026-11-02T00:00:00.000Z' } }))).toBe(Date.parse('2026-11-02T00:00:00Z'))
    expect(itemTime({})).toBe(0)
  })

  it('newest first, outside episodes with their show, undated items last', () => {
    const out = mergeByDate(
      [video('v-old', '2026-10-01T00:00:00'), video('v-new', '2026-11-05T00:00:00'), video('v-none', null)],
      [ep('e1', '2026-11-03T00:00:00.000Z'), ep('e2', '2026-09-01T00:00:00.000Z')],
      FEEDS,
      { complete: true },
    )
    expect(out.map((e) => (e.kind === 'item' ? e.video.permlink : e.ep.id))).toEqual(['v-new', 'e1', 'v-old', 'e2', 'v-none'])
    expect(out[1].feed).toEqual(FEEDS[0])
  })

  it('while older episodes are still to load, older items wait for them', () => {
    const out = mergeByDate(
      [video('v-new', '2026-11-05T00:00:00'), video('v-old', '2026-10-01T00:00:00'), video('v-none', null)],
      [ep('e1', '2026-11-03T00:00:00.000Z')],
      FEEDS,
      { complete: false },
    )
    expect(out.map((e) => (e.kind === 'item' ? e.video.permlink : e.ep.id))).toEqual(['v-new', 'e1'])
  })

  it('leaves out an outside episode that is one of the playlist\'s own 3Speak posts', () => {
    const out = mergeByDate(
      [video('day-1', '2026-11-01T00:00:00')],
      [ep('dup', '2026-11-01T00:00:00.000Z', { link: 'https://3speak.tv/watch?v=alice/day-1' }), ep('other', '2026-11-02T00:00:00.000Z', { link: 'https://3speak.tv/watch?v=bob/day-1' })],
      FEEDS,
      { complete: true },
    )
    expect(out.map((e) => (e.kind === 'item' ? e.video.permlink : e.ep.id))).toEqual(['other', 'day-1'])
  })
})
