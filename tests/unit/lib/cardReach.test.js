// Card reach (src/lib/cardReach.js): which surface a grid is, where an outside
// visitor came from, cards seen once per page view (sampled, batched), and the
// surface a card click hands to the watch page.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  surfaceForPath, classifyReferrer, markSeen, flushSeen, rememberOpenSource, takeOpenSource,
  reportOpen, SAMPLE_RATE, _resetForTests,
} from '../../../src/lib/cardReach.js'

const C = 'https://checker.3speak.tv'
let beacon

beforeEach(() => {
  sessionStorage.clear()
  beacon = vi.fn(() => true)
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
  _resetForTests({ rand: () => 0 }) // every page view sampled
})

const sent = async () => Promise.all(beacon.mock.calls.map(async ([url, blob]) => ({ url, body: JSON.parse(await blob.text()) })))

describe('surfaceForPath', () => {
  it.each([
    ['/', '', 'home'], ['/follow-feed', '', 'following'], ['/new', '', 'new'], ['/trend', '', 'trending'],
    ['/discover', '', 'discover'], ['/discover', '?q=cats', 'search'], ['/shorts', '?v=a/b', 'shorts'],
    ['/playlist/x1', '', 'playlist'], ['/t/music', '', 'tag'], ['/community/hive-1', '', 'community'],
    ['/@badadib', '', 'channel'], ['/@badadib/some-video', '', 'related'], ['/profile', '', 'channel'],
    ['/leaderboard', '', 'other'],
  ])('%s%s is %s', (path, search, want) => {
    expect(surfaceForPath(path, search)).toBe(want)
  })
})

describe('classifyReferrer', () => {
  it.each([
    ['', 'direct'], ['not a url', 'direct'],
    ['https://www.google.com/', 'search_engine'], ['https://duckduckgo.com/?q=x', 'search_engine'],
    ['https://t.co/abc', 'social'], ['https://www.reddit.com/r/hive', 'social'],
    ['https://peakd.com/@badadib/x', 'hive_apps'], ['https://ecency.com/x', 'hive_apps'],
    ['https://someblog.example/post', 'external'],
    ['https://3speak.tv/discover', 'other'],
  ])('%s is %s', (ref, want) => {
    expect(classifyReferrer(ref, '3speak.tv')).toBe(want)
  })
})

describe('cards seen', () => {
  it('once per card and surface per page view, batched to /reach/seen with the rate', async () => {
    expect(markSeen('badadib', 'v1', 'discover')).toBe(true)
    expect(markSeen('badadib', 'v1', 'discover')).toBe(false)
    expect(markSeen('badadib', 'v1', 'search')).toBe(true)
    expect(markSeen('badadib', 'v2', 'nowhere')).toBe(false)
    flushSeen()
    expect(await sent()).toEqual([{ url: `${C}/reach/seen`, body: { rate: SAMPLE_RATE, items: [
      { a: 'badadib', p: 'v1', s: 'discover' }, { a: 'badadib', p: 'v1', s: 'search' },
    ] } }])
    expect(beacon.mock.calls[0][1].type).toBe('text/plain')
  })

  it('a page view that lost the coin toss reports nothing', () => {
    _resetForTests({ rand: () => 0.99 })
    expect(markSeen('badadib', 'v1', 'home')).toBe(false)
    flushSeen()
    expect(beacon).not.toHaveBeenCalled()
  })

  it('a new page view counts the same card again', () => {
    expect(markSeen('badadib', 'v1', 'home')).toBe(true)
    window.history.pushState({ key: 'next' }, '', '/new')
    expect(markSeen('badadib', 'v1', 'home')).toBe(true)
    window.history.pushState({ key: 'root' }, '', '/')
  })

  it('a full batch goes at once', () => {
    for (let i = 0; i < 50; i += 1) markSeen('badadib', `v${i}`, 'home')
    expect(beacon).toHaveBeenCalledTimes(1)
  })
})

describe('opens', () => {
  it('a card click hands its surface to the watch page, once, for that video only', () => {
    rememberOpenSource('BadAdib', 'v1', 'search')
    expect(takeOpenSource('badadib', 'v2')).toBeNull()
    expect(takeOpenSource('badadib', 'v1')).toBe('search')
    expect(takeOpenSource('badadib', 'v1')).toBeNull()
  })

  it('a stale click is not believed', () => {
    rememberOpenSource('badadib', 'v1', 'home')
    expect(takeOpenSource('badadib', 'v1', Date.now() + 10 * 60 * 1000)).toBeNull()
  })

  it('reportOpen sends the card surface, else the referrer class, once per video', async () => {
    rememberOpenSource('badadib', 'v1', 'related')
    expect(reportOpen('badadib', 'v1', { referrer: 'https://www.google.com/' })).toBe('related')
    expect(reportOpen('badadib', 'v1')).toBeNull()
    expect(reportOpen('badadib', 'v2', { referrer: 'https://www.google.com/' })).toBe('search_engine')
    expect(await sent()).toEqual([
      { url: `${C}/reach/open`, body: { a: 'badadib', p: 'v1', s: 'related' } },
      { url: `${C}/reach/open`, body: { a: 'badadib', p: 'v2', s: 'search_engine' } },
    ])
  })

  it('without sendBeacon it falls back to a keepalive fetch', () => {
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined })
    const f = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', f)
    reportOpen('badadib', 'v3', { referrer: '' })
    expect(f).toHaveBeenCalledWith(`${C}/reach/open`, expect.objectContaining({ method: 'POST', keepalive: true, body: JSON.stringify({ a: 'badadib', p: 'v3', s: 'direct' }) }))
  })
})
