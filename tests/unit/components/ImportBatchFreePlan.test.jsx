// @vitest-environment jsdom
// ⏳ The batch import under the free plan's daily upload limits (src/page/ImportBatch.jsx):
// the form says one video a day and that the creator's own uploads are blocked
// meanwhile, the status says which item waits for the next free upload.
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
const quota = { current: null }
vi.mock('../../../src/hooks/useUploadQuota', () => ({ default: () => quota.current }))

const { BatchForm, BatchStatus, freeBatchPlan } = await import('../../../src/page/ImportBatch.jsx')

const NOW = Date.parse('2026-11-22T12:00:00Z')
const DAY = 24 * 3600 * 1000
const free = (video, short = { limit: 3, used: 0, remaining: 3, nextAt: null }) => ({ ready: true, exempt: false, video, short, audio: null })
const vid = (id, extra = {}) => ({ id, platform: 'youtube', title: `Video ${id}`, duration: 600, type: 'videos', ...extra })

describe('freeBatchPlan', () => {
  it('no plan for Pro / warm-up, unknown limits, or podcast episodes only', () => {
    expect(freeBatchPlan([vid('a')], { ready: true, exempt: true, video: null, short: null }, NOW)).toBeNull()
    expect(freeBatchPlan([vid('a')], { ready: true, exempt: false, video: null, short: null }, NOW)).toBeNull()
    expect(freeBatchPlan([vid('a')], { ready: false, exempt: false, video: { limit: 1, used: 0, remaining: 1 } }, NOW)).toBeNull()
    expect(freeBatchPlan([{ id: 'rss:x', platform: 'rss' }], free({ limit: 1, used: 0, remaining: 1, nextAt: null }), NOW)).toBeNull()
  })

  it('one video fits today: a plan without an end date', () => {
    expect(freeBatchPlan([vid('a')], free({ limit: 1, used: 0, remaining: 1, nextAt: null }), NOW)).toEqual({ lastAt: null })
  })

  it('five videos with today free: the last one about four days out', () => {
    const plan = freeBatchPlan(['a', 'b', 'c', 'd', 'e'].map((id) => vid(id)), free({ limit: 1, used: 0, remaining: 1, nextAt: null }), NOW)
    expect(plan.lastAt).toBe(NOW + 4 * DAY)
  })

  it('today used up: counts from the next free upload', () => {
    const nextAt = NOW + 3 * 3600 * 1000
    const plan = freeBatchPlan([vid('a'), vid('b')], free({ limit: 1, used: 1, remaining: 0, nextAt }), NOW)
    expect(plan.lastAt).toBe(nextAt + DAY)
  })

  it('Shorts count against their own 3 a day', () => {
    const shorts = ['a', 'b', 'c'].map((id) => vid(id, { type: 'shorts', duration: 30 }))
    expect(freeBatchPlan(shorts, free({ limit: 1, used: 0, remaining: 1, nextAt: null }), NOW)).toEqual({ lastAt: null })
    const four = [...shorts, vid('d', { platform: 'tiktok', type: undefined, duration: 20 })]
    expect(freeBatchPlan(four, free({ limit: 1, used: 0, remaining: 1, nextAt: null }), NOW).lastAt).toBe(NOW + DAY)
  })
})

const form = (videos) => renderWithProviders(
  <BatchForm user="badadib" videos={videos} spacingMin={30} granted onGranted={vi.fn()} onClose={vi.fn()} onStarted={vi.fn()} />,
)
const next = (user) => user.click(screen.getByRole('button', { name: 'Next' }))

beforeEach(() => { quota.current = null })

describe('batch form notice', () => {
  it('free account: one video a day, own uploads blocked, last date, Pro link', async () => {
    quota.current = free({ limit: 1, used: 0, remaining: 1, nextAt: null })
    const { user } = form([vid('a'), vid('b'), vid('c')])
    await next(user)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Free plan: one video per day')
    expect(note).toHaveTextContent('you cannot upload other videos yourself in that time')
    expect(note).toHaveTextContent('The last one goes out around')
    expect(screen.getByRole('link', { name: 'Get 3Speak Pro' })).toHaveAttribute('href', '/wallet/badadib#pro')
  })

  it('Pro account: no notice', async () => {
    quota.current = { ready: true, exempt: true, video: null, short: null, audio: null }
    const { user } = form([vid('a'), vid('b')])
    await next(user)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('batch status', () => {
  const batch = (items) => ({ id: 'b1', createdAt: new Date().toISOString(), options: {}, items })
  const row = (sourceId, extra) => ({ sourceId, platform: 'youtube', title: `Video ${sourceId}`, thumbnail: '', progress: 0, error: null, isShort: false, permlink: null, scheduledOn: null, ...extra })

  it('an item waiting for the next free upload says so, with the blocked-uploads note', () => {
    const waitUntil = new Date(Date.now() + DAY).toISOString()
    renderWithProviders(<BatchStatus user="badadib" onChange={vi.fn()} batch={batch([
      row('a', { status: 'scheduled', scheduledOn: new Date(Date.now() + 600000).toISOString() }),
      row('b', { status: 'queued', waitUntil }),
    ])} />)
    expect(screen.getByText(/Waits for your next free upload/)).toBeInTheDocument()
    expect(screen.getByText(/This batch is using your free daily uploads/)).toBeInTheDocument()
  })

  it('a plain queued item: no free-plan note', () => {
    renderWithProviders(<BatchStatus user="badadib" onChange={vi.fn()} batch={batch([row('a', { status: 'queued' })])} />)
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.queryByText(/free daily uploads/)).toBeNull()
  })
})
