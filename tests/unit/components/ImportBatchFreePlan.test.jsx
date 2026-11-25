// @vitest-environment jsdom
// ⏳ The batch import under the free plan's daily publish limit (src/page/ImportBatch.jsx):
// the form says one video a day and that the creator's own publishing shares
// those days, the status says which item waits for the next free publish time.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/lib/youtubeImport', () => ({ createImportBatch: vi.fn(), cancelImportBatch: vi.fn(), fmtDuration: (s) => `${s}s`, saveAutoImport: vi.fn() }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchCreatorAdPrefs: async () => ({}) }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/utils/postingAuthority', () => ({ addThreespeakToPostingAuth: vi.fn(), waitForThreespeakPostingAuth: vi.fn(async () => true) }))
vi.mock('../../../src/components/HiveAvatar/AccountImg', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Community_modal', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Beneficiary_modal', () => ({ default: () => null }))
// The publish quota for now, per kind (hooks/usePublishQuota.js), steered per test
const quota = { current: {} }
vi.mock('../../../src/hooks/usePublishQuota', () => ({ default: ({ kind }) => ({ ready: true, quota: quota.current[kind] ?? null, blocked: false }) }))

const { BatchForm, BatchStatus, freeBatchPlan, limitText } = await import('../../../src/page/ImportBatch.jsx')

const NOW = Date.parse('2026-11-22T12:00:00Z')
const DAY = 24 * 3600 * 1000
const freeNow = (limit) => ({ exempt: false, kind: limit === 1 ? 'video' : 'short', limit, allowed: true, conflicts: [], nextFreeAt: NOW })
const takenUntil = (limit, nextFreeAt) => ({ exempt: false, limit, allowed: false, conflicts: [], nextFreeAt })
const free = (video = freeNow(1), short = freeNow(3)) => ({ video, short })
const vid = (id, extra = {}) => ({ id, platform: 'youtube', title: `Video ${id}`, duration: 600, type: 'videos', ...extra })

describe('freeBatchPlan', () => {
  it('no plan for Pro, unknown limits, or podcast episodes only', () => {
    expect(freeBatchPlan([vid('a')], { video: { exempt: true, reason: 'pro' }, short: { exempt: true } }, NOW)).toBeNull()
    expect(freeBatchPlan([vid('a')], { video: null, short: null }, NOW)).toBeNull()
    expect(freeBatchPlan([{ id: 'rss:x', platform: 'rss' }], free(), NOW)).toBeNull()
  })

  it('one video free now: a plan without an end date', () => {
    expect(freeBatchPlan([vid('a')], free(), NOW)).toEqual({ lastAt: null })
  })

  it('five videos with now free: the last one about four days out', () => {
    const plan = freeBatchPlan(['a', 'b', 'c', 'd', 'e'].map((id) => vid(id)), free(), NOW)
    expect(plan.lastAt).toBe(NOW + 4 * DAY)
  })

  it('now taken: counts from the next free publish time', () => {
    const nextFreeAt = NOW + 3 * 3600 * 1000
    const plan = freeBatchPlan([vid('a'), vid('b')], free(takenUntil(1, nextFreeAt)), NOW)
    expect(plan.lastAt).toBe(nextFreeAt + DAY)
  })

  it('Shorts count against their own 3 a day', () => {
    const shorts = ['a', 'b', 'c'].map((id) => vid(id, { type: 'shorts', duration: 30 }))
    expect(freeBatchPlan(shorts, free(), NOW)).toEqual({ lastAt: null })
    const four = [...shorts, vid('d', { platform: 'tiktok', type: undefined, duration: 20 })]
    expect(freeBatchPlan(four, free(), NOW).lastAt).toBe(NOW + DAY)
  })
})

describe('limitText', () => {
  const t = (k) => k
  it('words an item the checker kept refusing over the daily publish limit', () => {
    expect(limitText({ errorCode: 'daily_publish_limit' }, t)).toBe('publishLimits.batchRefused')
    expect(limitText({ errorCode: 'download_failed' }, t)).toBeNull()
  })
})

const form = (videos) => renderWithProviders(
  <BatchForm user="badadib" videos={videos} spacingMin={30} granted onGranted={vi.fn()} onClose={vi.fn()} onStarted={vi.fn()} />,
)
const next = (user) => user.click(screen.getByRole('button', { name: 'Next' }))

beforeEach(() => { quota.current = {} })

describe('batch form notice', () => {
  it('free account: one video a day, own publishing shares the days, last date, Pro link', async () => {
    quota.current = free()
    const { user } = form([vid('a'), vid('b'), vid('c')])
    await next(user)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Free plan: one video per day')
    expect(note).toHaveTextContent('If you publish or schedule a video of your own meanwhile, the batch moves on to the next free day.')
    expect(note).toHaveTextContent('The last one goes out around')
    expect(screen.getByRole('link', { name: 'Get 3Speak Pro' })).toHaveAttribute('href', '/wallet/badadib#pro')
  })

  it('Pro account: no notice', async () => {
    quota.current = { video: { exempt: true, reason: 'pro' }, short: { exempt: true, reason: 'pro' } }
    const { user } = form([vid('a'), vid('b')])
    await next(user)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('batch status', () => {
  const batch = (items) => ({ id: 'b1', createdAt: new Date().toISOString(), options: {}, items })
  const row = (sourceId, extra) => ({ sourceId, platform: 'youtube', title: `Video ${sourceId}`, thumbnail: '', progress: 0, error: null, isShort: false, permlink: null, scheduledOn: null, ...extra })

  it('an item waiting for the next free publish time says so, with the free-plan note', () => {
    const waitUntil = new Date(Date.now() + DAY).toISOString()
    renderWithProviders(<BatchStatus user="badadib" onChange={vi.fn()} batch={batch([
      row('a', { status: 'scheduled', scheduledOn: new Date(Date.now() + 600000).toISOString() }),
      row('b', { status: 'queued', waitUntil }),
    ])} />)
    expect(screen.getByText(/Waits for your next free publish time/)).toBeInTheDocument()
    expect(screen.getByText(/This batch uses your free daily publishing/)).toBeInTheDocument()
  })

  it('a plain queued item: no free-plan note', () => {
    renderWithProviders(<BatchStatus user="badadib" onChange={vi.fn()} batch={batch([row('a', { status: 'queued' })])} />)
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.queryByText(/free daily publishing/)).toBeNull()
  })
})
