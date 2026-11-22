// @vitest-environment jsdom
// The weekly Shorts challenge page (src/page/ShortsChallenge.jsx): this week's
// theme from the checker, its checked entries, next week, earlier weeks, and
// "Join with a Short".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

const m = vi.hoisted(() => ({ list: null, one: {}, entries: null, entryCalls: [] }))
// The checker, answered by URL (lib/shortsChallenge.js fetches these)
function checker(url) {
  const u = new URL(url)
  let status = 200
  let body
  const e = /^\/shorts-challenges\/([^/]+)\/entries$/.exec(u.pathname)
  const one = /^\/shorts-challenges\/([^/]+)$/.exec(u.pathname)
  if (u.pathname === '/shorts-challenges') body = m.list
  else if (e) {
    m.entryCalls.push([decodeURIComponent(e[1]), u.searchParams.get('page'), u.searchParams.get('limit')])
    try { body = m.entries() } catch { status = 500; body = {} }
  } else if (one) {
    const c = m.one[decodeURIComponent(one[1])]
    if (c) body = { success: true, challenge: c }; else { status = 404; body = {} }
  }
  return { ok: status < 400, status, json: async () => body }
}
vi.mock('../../../src/components/Cards/Card3', () => ({
  default: ({ videos, linkPrefix }) => (
    <ul data-testid="entries">{videos.map((v) => <li key={v.permlink}>{`${linkPrefix}:${v.author}/${v.permlink}`}</li>)}</ul>
  ),
}))
vi.mock('../../../src/hooks/useContentBatch', () => ({ useContentBatch: () => ({ getContentForVideo: () => null }) }))
vi.mock('../../../src/hooks/useWatchHistory', () => ({ useWatchHistory: () => ({ isWatched: () => false }) }))
vi.mock('../../../src/hooks/useViewCounts', () => ({ default: () => ({ getViewCount: () => 0 }) }))
const { default: ShortsChallenge } = await import('../../../src/page/ShortsChallenge.jsx')

const ch = (week, title, extra = {}) => {
  const n = Number(week.slice(6))
  const start = new Date(Date.UTC(2026, 10, 22 + (n - 48) * 7)) // weeks start on Sunday
  return {
    week, tag: `challenge2026w${n}`, theme: title, texts: { en: { title, prompt: `Prompt of ${title}` } },
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 7 * 864e5 - 1).toISOString(), entries: 0, ...extra,
  }
}
const W48 = ch('2026-W48', 'Your workspace')
const W49 = ch('2026-W49', 'One skill in 60 seconds')
const W50 = ch('2026-W50', 'The season where you are')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-02T10:00:00Z')) // 2026-W49
  sessionStorage.clear()
  m.list = { week: '2026-W49', current: W49, next: W50, past: [W48] }
  m.one = { '2026-W48': W48, '2026-W49': W49, '2026-W50': W50 }
  m.entries = () => ({ total: 0, totalPages: 1, videos: [] })
  m.entryCalls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => checker(String(url))))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('ShortsChallenge page', () => {
  it('shows this week\'s theme, its dates, next week and the checked entries', async () => {
    m.entries = () => ({ total: 2, totalPages: 1, videos: [{ author: 'badadib', permlink: 'one' }, { author: 'badadib', permlink: 'two' }] })
    renderWithProviders(<ShortsChallenge />, { route: '/challenge', path: '/challenge' })
    expect(await screen.findByRole('heading', { level: 1, name: 'One skill in 60 seconds' })).toBeInTheDocument()
    expect(screen.getByText('Prompt of One skill in 60 seconds')).toBeInTheDocument()
    expect(screen.getByText(/Shorts challenge, week 49/)).toBeInTheDocument()
    expect(screen.getByText(/to .* \(UTC\) · Ends in 3 days/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#challenge2026w49' })).toHaveAttribute('href', '/t/challenge2026w49')
    expect(screen.getByText('The season where you are')).toBeInTheDocument()
    expect(screen.getByText('Your workspace')).toBeInTheDocument()
    expect(screen.getByText(/once the team has checked them/)).toBeInTheDocument()
    expect(await screen.findByText('/shorts:badadib/two')).toBeInTheDocument()
    expect(screen.getByText('2 entries')).toBeInTheDocument()
    expect(m.entryCalls[0]).toEqual(['2026-W49', '1', '24'])
  })

  it('"Join with a Short" remembers the week and opens the Shorts uploader', async () => {
    const { user } = renderWithProviders(<ShortsChallenge />, { route: '/challenge', path: '/challenge' })
    expect(await screen.findByText('No entries yet. Be the first!')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Join with a Short/ }))
    expect(screen.getByTestId('location').textContent).toBe('/embed-studio?from=shorts')
    expect(sessionStorage.getItem('3speak-challenge-join')).toBe('2026-W49')
  })

  it('an earlier week: its entries, no Join, a way back to this week', async () => {
    renderWithProviders(<ShortsChallenge />, { route: '/challenge/2026-W48', path: '/challenge/:week' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Your workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Join with a Short/ })).toBeNull()
    expect(screen.getByText(/This challenge has ended/)).toBeInTheDocument()
    expect(await screen.findByText('Nobody joined this week.')).toBeInTheDocument()
    expect(m.entryCalls[0]).toEqual(['2026-W48', '1', '24'])
  })

  it('a coming week: the theme to plan for, no entries asked for', async () => {
    renderWithProviders(<ShortsChallenge />, { route: '/challenge/2026-W50', path: '/challenge/:week' })
    expect(await screen.findByRole('heading', { level: 1, name: 'The season where you are' })).toBeInTheDocument()
    expect(screen.getByText(/has not started yet/)).toBeInTheDocument()
    expect(m.entryCalls).toEqual([])
  })

  it('a week with no challenge says so', async () => {
    renderWithProviders(<ShortsChallenge />, { route: '/challenge/2031-W02', path: '/challenge/:week' })
    expect(await screen.findByText('There is no challenge for this week.')).toBeInTheDocument()
  })

  it('no challenge this week: says so, with the next one to plan for', async () => {
    m.list = { week: '2026-W47', current: null, next: W48, past: [] }
    renderWithProviders(<ShortsChallenge />, { route: '/challenge', path: '/challenge' })
    expect(await screen.findByText('There is no challenge this week. Check back soon!')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Your workspace/ })).toHaveAttribute('href', '/challenge/2026-W48')
  })

  it('says so when the entries cannot be loaded', async () => {
    m.entries = () => { throw new Error('down') }
    renderWithProviders(<ShortsChallenge />, { route: '/challenge', path: '/challenge' })
    await waitFor(() => expect(screen.getByText('Could not load the entries.')).toBeInTheDocument())
  })
})
