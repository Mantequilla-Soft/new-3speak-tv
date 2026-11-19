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
vi.mock('../../../src/utils/scheduledPosts', () => ({ publishDraft: h.publishDraft, deleteDraft: h.deleteDraft }))

const { default: EpisodeNumberFields } = await import('../../../src/components/Episodes/EpisodeNumberFields.jsx')
const { default: EpisodeBadge } = await import('../../../src/components/Episodes/EpisodeBadge.jsx')
const { default: AudioPublishWhen, scheduleTooSoon, SCHEDULE_MIN_LEAD_MIN } = await import('../../../src/components/AudioUploadModal/AudioPublishWhen.jsx')
const { formatDateTimeLocal } = await import('../../../src/utils/schedulingHelpers')
const { default: DraftCard } = await import('../../../src/components/Draft/DraftCard.jsx')

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
