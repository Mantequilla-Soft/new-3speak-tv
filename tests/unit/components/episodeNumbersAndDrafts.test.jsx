// @vitest-environment jsdom
// Season/episode fields and the "S2 E5" badge (components/Episodes), when a
// standalone audio post goes out (AudioPublishWhen) and a draft's actions in the
// studio (DraftCard).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ publishDraft: vi.fn(), deleteDraft: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/utils/scheduledPosts', () => ({ publishDraft: h.publishDraft, deleteDraft: h.deleteDraft, SCHEDULED_CHECKER_BASE: 'https://checker.test' }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))

const { default: EpisodeNumberFields } = await import('../../../src/components/Episodes/EpisodeNumberFields.jsx')
const { default: EpisodeBadge } = await import('../../../src/components/Episodes/EpisodeBadge.jsx')
const { default: AudioPublishWhen, scheduleTooSoon, SCHEDULE_MIN_LEAD_MIN } = await import('../../../src/components/AudioUploadModal/AudioPublishWhen.jsx')
const { formatDateTimeLocal } = await import('../../../src/utils/schedulingHelpers')
const { default: DraftCard } = await import('../../../src/components/Draft/DraftCard.jsx')
const { useAppStore } = await import('../../../src/lib/store')
const { refreshPublishQuota } = await import('../../../src/lib/publishQuota.js')
const { toast } = await import('sonner')
const { toastMessages } = await import('./_render.jsx')

function Numbers() {
  const [season, setSeason] = useState('')
  const [episode, setEpisode] = useState('')
  return <EpisodeNumberFields season={season} episode={episode} onSeason={setSeason} onEpisode={setEpisode} />
}

beforeEach(() => {
  h.publishDraft.mockReset().mockResolvedValue({ success: true })
  h.deleteDraft.mockReset().mockResolvedValue({ success: true })
})

describe('season and episode', () => {
  it('takes digits only and flags a number out of range', async () => {
    const { user } = renderWithProviders(<Numbers />)
    const season = screen.getByTestId('episode-season')
    await user.type(season, '2a')
    expect(season).toHaveValue('2')
    await user.type(screen.getByTestId('episode-episode'), '0')
    expect(screen.getByRole('alert')).toHaveTextContent('A whole number from 1 to 99999')
  })

  it('the badge reads S2 E5, and is not there without numbers', () => {
    const { unmount } = renderWithProviders(<EpisodeBadge season={2} episode={5} />)
    expect(screen.getByTestId('episode-badge')).toHaveTextContent('S2 E5')
    unmount()
    renderWithProviders(<EpisodeBadge />)
    expect(screen.queryByTestId('episode-badge')).toBeNull()
  })
})

describe('AudioPublishWhen', () => {
  it('now, schedule (with the earliest time preset) or draft', async () => {
    const onChange = vi.fn()
    const onScheduleAt = vi.fn()
    const { user, rerender } = renderWithProviders(<AudioPublishWhen value="now" onChange={onChange} scheduleAt="" onScheduleAt={onScheduleAt} />)
    await user.click(screen.getByRole('tab', { name: /Schedule/ }))
    expect(onChange).toHaveBeenCalledWith('schedule')
    expect(onScheduleAt).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/))
    rerender(<AudioPublishWhen value="draft" onChange={onChange} scheduleAt="" onScheduleAt={onScheduleAt} />)
    expect(screen.getByText(/Kept in Drafts in your studio/)).toBeInTheDocument()
  })

  it('a time too close (or none) is too soon: the checker wants 5 minutes, the upload its share', () => {
    const now = Date.parse('2026-11-16T12:00:00')
    const at = (min) => formatDateTimeLocal(new Date(now + min * 60 * 1000))
    expect(SCHEDULE_MIN_LEAD_MIN).toBeGreaterThan(5)
    expect(scheduleTooSoon(at(15), now)).toBe(false)
    expect(scheduleTooSoon(at(SCHEDULE_MIN_LEAD_MIN), now)).toBe(false)
    expect(scheduleTooSoon(at(SCHEDULE_MIN_LEAD_MIN - 1), now)).toBe(true)
    expect(scheduleTooSoon(at(-30), now)).toBe(true)
    expect(scheduleTooSoon('', now)).toBe(true)
    expect(scheduleTooSoon('not a date', now)).toBe(true)
  })

  it('says so under the day strip when the picked time has come too close', () => {
    const soon = formatDateTimeLocal(new Date(Date.now() + 2 * 60 * 1000))
    renderWithProviders(<AudioPublishWhen value="schedule" onChange={() => {}} scheduleAt={soon} onScheduleAt={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Pick one at least 10 minutes from now')
  })
})

describe('DraftCard', () => {
  const draft = { id: 'd1', permlink: 'ep-5', title: 'Episode 5', kind: 'audio', updatedAt: '2026-11-14T10:00:00Z' }

  it('shows the draft and publishes it now', async () => {
    const onChanged = vi.fn()
    const { user } = renderWithProviders(<DraftCard draft={draft} owner="badadib" onChanged={onChanged} />)
    const card = screen.getByTestId('draft-card')
    expect(card).toHaveTextContent('Episode 5')
    expect(card).toHaveTextContent('Audio')
    expect(card).toHaveTextContent('Draft')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(h.publishDraft).toHaveBeenCalledWith({ owner: 'badadib', permlink: 'ep-5' }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('schedules it for the picked time', async () => {
    const { user } = renderWithProviders(<DraftCard draft={draft} owner="badadib" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Schedule' }))
    await user.click(await screen.findByRole('button', { name: /Schedule for/ }))
    await waitFor(() => expect(h.publishDraft).toHaveBeenCalledTimes(1))
    const { scheduledOn } = h.publishDraft.mock.calls[0][0]
    expect(Date.parse(scheduledOn)).toBeGreaterThan(Date.now() + 10 * 60 * 1000)
  })

  it('deletes it only after a confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { user } = renderWithProviders(<DraftCard draft={draft} owner="badadib" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(h.deleteDraft).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.deleteDraft).toHaveBeenCalledWith({ owner: 'badadib', permlink: 'ep-5' }))
    confirm.mockRestore()
  })
})

// ⏳ The free plan's daily publish limit (lib/publishQuota.js) on a video draft:
// "Publish now" on a taken slot opens the schedule dialog on the next free time
// instead, and a picked time that is taken holds Schedule back. The checker's
// GET /publish-quota is a fake (fetch).
describe('DraftCard: the daily publish limit', () => {
  const DAY = 24 * 3600 * 1000
  const draft = { id: 'd2', permlink: 'trip-2', title: 'Trip part 2', kind: 'video', updatedAt: '2026-11-14T10:00:00Z' }
  const fmt = (ms) => new Date(ms).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
  let publishedAt, freeAt, quotaCalls
  beforeEach(() => {
    publishedAt = Date.now() - 2 * 3600 * 1000
    freeAt = Math.ceil((publishedAt + DAY) / 60000) * 60000
    quotaCalls = []
    useAppStore.setState({ user: 'badadib' })
    refreshPublishQuota()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = new URL(String(url))
      quotaCalls.push(u)
      const at = u.searchParams.get('at') ? Date.parse(u.searchParams.get('at')) : Date.now()
      const taken = at < freeAt
      return { ok: true, json: async () => ({
        success: true, enabled: true, exempt: false, kind: 'video', limit: 1, at: new Date(at).toISOString(), allowed: !taken,
        conflicts: taken ? [{ permlink: 'trip-1', title: 'Trip part 1', at: new Date(publishedAt).toISOString(), scheduled: false }] : [],
        next_free_at: new Date(taken ? freeAt : at).toISOString(),
      }) }
    }))
  })

  it('"Publish now" on a taken slot publishes nothing and offers the next free time', async () => {
    const { user } = renderWithProviders(<DraftCard draft={draft} owner="badadib" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog')
    expect(h.publishDraft).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent(`You cannot publish this right now. On the free plan you can publish 1 video per 24 hours. "Trip part 1" was published at ${fmt(publishedAt)}. Earliest free time: ${fmt(freeAt)}.`)
    const schedule = screen.getByRole('button', { name: /^Schedule for / })
    await waitFor(() => expect(quotaCalls.some((u) => Date.parse(u.searchParams.get('at')) === freeAt)).toBe(true))
    await waitFor(() => expect(schedule).toBeEnabled())
    await user.click(schedule)
    await waitFor(() => expect(h.publishDraft).toHaveBeenCalledTimes(1))
    expect(Date.parse(h.publishDraft.mock.calls[0][0].scheduledOn)).toBe(freeAt)
  })

  it('a picked time that is taken: Schedule is off until "Use <time>"', async () => {
    const { user } = renderWithProviders(<DraftCard draft={draft} owner="badadib" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Schedule' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveTextContent('This time is taken.'))
    expect(screen.getByRole('button', { name: /^Schedule for / })).toBeDisabled()
    expect(quotaCalls.at(-1).searchParams.get('exclude')).toBe('trip-2')
    await user.click(screen.getByRole('button', { name: `Use ${fmt(freeAt)}` }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Schedule for / })).toBeEnabled())
  })

  it('the checker refusing "Publish now" (429) says why and opens the schedule dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    h.publishDraft.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 429'), { response: { status: 429, data: {
      error: 'Daily publish limit reached', code: 'daily_publish_limit', kind: 'video', limit: 1,
      conflicts: [{ permlink: 'trip-1', title: 'Trip part 1', at: new Date(publishedAt).toISOString(), scheduled: false }],
      next_free_at: new Date(freeAt).toISOString(),
    } } }))
    const { user } = renderWithProviders(<DraftCard draft={draft} owner="badadib" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(toastMessages(toast.error).join(' ')).toContain(`"Trip part 1" was published at ${fmt(publishedAt)}.`))
    expect(await screen.findByRole('dialog')).toHaveTextContent('You cannot publish this right now.')
  })

  it('an audio draft is never checked', async () => {
    const { user } = renderWithProviders(<DraftCard draft={{ ...draft, kind: 'audio' }} owner="badadib" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(h.publishDraft).toHaveBeenCalledTimes(1))
    expect(quotaCalls).toEqual([])
  })
})
