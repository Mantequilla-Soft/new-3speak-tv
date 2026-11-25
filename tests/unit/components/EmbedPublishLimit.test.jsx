// @vitest-environment jsdom
// ⏳ The free plan's daily publish limit in the upload studio's last steps
// (components/embed-studio/EmbedDetails.jsx and EmbedPreview.jsx): "publish now"
// on a taken slot is not offered (Post is off) and a one-tap "Schedule for
// <next free time>" switches to scheduling; a picked time that is taken says
// which publish takes it and has to change; a Short, which cannot be scheduled
// here, waits for its free time. The checker's GET /publish-quota is a fake
// (fetch); the upload state is a stand-in that records what is set.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ ctx: {}, set: [], publish: vi.fn() }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({ ...(await importOriginal()), ENABLE_SUBS: true }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchCreatorAdPrefs: async () => null }))
vi.mock('../../../src/lib/shortsChallenge', async (importOriginal) => ({ ...(await importOriginal()), useCurrentChallenge: () => null }))
vi.mock('../../../src/lib/uploadGate', () => ({ fetchUploadGateAd: async () => null, confirmUploadGatePost: () => {}, gateSessionId: () => null }))
vi.mock('../../../src/hive-api/api', async (importOriginal) => ({ ...(await importOriginal()), getFollowers: async () => null }))
vi.mock('../../../src/components/embed-studio/EmbedPreviewPlayer', () => ({ default: () => null }))
vi.mock('../../../src/utils/scheduledPosts', () => ({ SCHEDULED_CHECKER_BASE: 'https://checker.test' }))
vi.mock('../../../src/context/EmbedUploadContext', () => {
  const noop = () => {}
  return {
    useEmbedUpload: () => new Proxy(m.ctx, {
      get: (t, k) => {
        if (k in t) return t[k]
        if (typeof k === 'string' && /^(set|Set)/.test(k)) return (...a) => { m.set.push([k, ...a]) }
        if (['list', 'tagsPreview', 'pollOptions', 'communitiesData', 'BeneficiaryList', 'gatedAllowlist', 'statusMessages', 'chapters', 'timelineLinks', 'remixChain', 'musicCredits', 'beneficiaries'].includes(k)) return []
        if (k === 'startEarlyUpload' || k === 'navigate') return noop
        if (k === 'publishToEmbed') return m.publish
        return undefined
      },
    }),
  }
})

const { useAppStore } = await import('../../../src/lib/store')
const { refreshPublishQuota } = await import('../../../src/lib/publishQuota.js')
const { formatDateTimeLocal } = await import('../../../src/utils/schedulingHelpers.js')
const { default: EmbedDetails } = await import('../../../src/components/embed-studio/EmbedDetails.jsx')
const { default: EmbedPreview } = await import('../../../src/components/embed-studio/EmbedPreview.jsx')
const { toast } = await import('sonner')

const DAY = 24 * 3600 * 1000
const minute = (ms) => Math.ceil(ms / 60000) * 60000
const fmt = (ms) => new Date(ms).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
// The checker, faked: a video published 2 hours ago ("My trip") and one
// scheduled in two days ("Next one") keep every time before FREE_AT taken.
let PUBLISHED_AT, SCHEDULED_AT, FREE_AT, quotaCalls
const conflictsAt = (at) => [
  { permlink: 'my-trip', title: 'My trip', at: PUBLISHED_AT, scheduled: false },
  { permlink: 'next-one', title: 'Next one', at: SCHEDULED_AT, scheduled: true },
].filter((c) => Math.abs(at - c.at) < DAY).map((c) => ({ ...c, at: new Date(c.at).toISOString() }))
function answer(url) {
  const p = new URL(url).searchParams
  const kind = p.get('kind')
  const at = p.get('at') ? Date.parse(p.get('at')) : Date.now()
  const conflicts = kind === 'video' ? conflictsAt(at) : (m.shortsTaken ? [{ permlink: 's1', title: '', at: new Date(PUBLISHED_AT).toISOString(), scheduled: false }] : [])
  const taken = conflicts.length > 0
  return {
    success: true, enabled: true, exempt: false, reason: null, kind, limit: kind === 'video' ? 1 : 3, window_hours: 24,
    at: new Date(at).toISOString(), allowed: !taken, conflicts,
    next_free_at: new Date(taken ? (kind === 'video' ? FREE_AT : PUBLISHED_AT + DAY) : at).toISOString(),
  }
}
const set = (name) => m.set.filter((c) => c[0] === name).map((c) => c[1])

beforeEach(() => {
  stubMatchMedia(false)
  PUBLISHED_AT = Date.now() - 2 * 3600 * 1000
  SCHEDULED_AT = minute(Date.now() + 2 * DAY)
  FREE_AT = SCHEDULED_AT + DAY
  quotaCalls = []
  m.set = []
  m.shortsTaken = false
  m.publish = vi.fn(async () => {})
  m.ctx = { fromStories: false, isStory: false, user: 'badadib', title: 'A video', description: 'hi', tagsInputValue: '', selectedThumbnail: 'x', step: 3, remaingPercent: 100, saveAsDraft: false, isScheduled: false, scheduleDateTime: '' }
  useAppStore.setState({ user: 'badadib', incubationHandle: null })
  refreshPublishQuota()
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/publish-quota/')) { quotaCalls.push(new URL(String(url))); return { ok: true, json: async () => answer(String(url)) } }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
})

describe('details step: publish now on a taken slot', () => {
  it('says why, names what takes it, and one tap schedules it on the next free time', async () => {
    const { user } = renderWithProviders(<EmbedDetails />, { route: '/embed-studio/details' })
    const note = await screen.findByText(/You cannot publish this right now\./)
    expect(note).toHaveTextContent('On the free plan you can publish 1 video per 24 hours.')
    expect(note).toHaveTextContent(`"My trip" was published at ${fmt(PUBLISHED_AT)}.`)
    expect(note).toHaveTextContent(`Earliest free time: ${fmt(FREE_AT)}.`)
    expect(within(note.closest('.publish-limit-note')).getByRole('link', { name: 'Get 3Speak Pro' })).toHaveAttribute('href', '/wallet/badadib#pro')
    await user.click(screen.getByRole('button', { name: `Schedule for ${fmt(FREE_AT)}` }))
    expect(set('setScheduleDateTime')).toEqual([formatDateTimeLocal(new Date(FREE_AT))])
    expect(set('setIsScheduled')).toEqual([true])
    expect(set('setSaveAsDraft')).toEqual([false])
  })

  it('a draft has no time and is never held back', async () => {
    m.ctx.saveAsDraft = true
    renderWithProviders(<EmbedDetails />, { route: '/embed-studio/details' })
    await screen.findByText('Description')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/You cannot publish this right now/)).toBeNull()
    expect(quotaCalls).toEqual([])
  })

  it('no limit known (the route 404s): nothing shown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    renderWithProviders(<EmbedDetails />, { route: '/embed-studio/details' })
    await screen.findByText('Description')
    await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelector('.publish-limit-note')).toBeNull()
  })
})

describe('details step: a scheduled time that is taken', () => {
  it('names the scheduled post that takes it and offers the next free time', async () => {
    m.ctx.isScheduled = true
    m.ctx.scheduleDateTime = formatDateTimeLocal(new Date(SCHEDULED_AT + 3 * 3600 * 1000))
    renderWithProviders(<EmbedDetails />, { route: '/embed-studio/details' })
    const note = await screen.findByText(/This time is taken\./)
    expect(note).toHaveTextContent(`"Next one" is scheduled for ${fmt(SCHEDULED_AT)}.`)
    expect(note).toHaveTextContent(`Earliest free time: ${fmt(FREE_AT)}.`)
    expect(Date.parse(quotaCalls.at(-1).searchParams.get('at'))).toBe(SCHEDULED_AT + 3 * 3600 * 1000)
  })

  it('in the schedule sheet: a taken pick keeps the main button off until "Use <time>"', async () => {
    const { user } = renderWithProviders(<EmbedDetails />, { route: '/embed-studio/details' })
    await screen.findByText(/You cannot publish this right now\./)
    // The Schedule row of the settings list ("Publish later" while nothing is picked).
    await user.click(screen.getByText('Publish later').closest('button'))
    const sheet = await screen.findByRole('dialog')
    // Opens on the earliest allowed time (in 15 minutes): within a day of "My trip".
    await within(sheet).findByText(/This time is taken\./)
    const main = within(sheet).getAllByRole('button', { name: /^Schedule for / }).at(-1)
    expect(main).toBeDisabled()
    await user.click(within(sheet).getByRole('button', { name: `Use ${fmt(FREE_AT)}` }))
    await waitFor(() => expect(within(sheet).queryByText(/This time is taken\./)).toBeNull())
    await waitFor(() => expect(Date.parse(quotaCalls.at(-1).searchParams.get('at'))).toBe(FREE_AT))
    await waitFor(() => expect(within(sheet).getAllByRole('button', { name: /^Schedule for / }).at(-1)).toBeEnabled())
  })
})

describe('preview step: Post', () => {
  it('publish now on a taken slot: Post is off, the note offers the next free time', async () => {
    const { user } = renderWithProviders(<EmbedPreview />, { route: '/embed-studio/preview' })
    await screen.findByText(/You cannot publish this right now\./)
    for (const b of screen.getAllByRole('button', { name: 'Post Video' })) expect(b).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: `Schedule for ${fmt(FREE_AT)}` })[0])
    expect(set('setIsScheduled')).toEqual([true])
    expect(set('setScheduleDateTime')).toEqual([formatDateTimeLocal(new Date(FREE_AT))])
  })

  it('a free scheduled time posts, after asking the checker once more', async () => {
    m.ctx.isScheduled = true
    m.ctx.scheduleDateTime = formatDateTimeLocal(new Date(FREE_AT))
    const { user } = renderWithProviders(<EmbedPreview />, { route: '/embed-studio/preview' })
    await waitFor(() => expect(quotaCalls.length).toBeGreaterThan(0))
    const post = screen.getAllByRole('button', { name: 'Post Video' })[0]
    await waitFor(() => expect(post).toBeEnabled())
    await user.click(post)
    await waitFor(() => expect(m.publish).toHaveBeenCalledTimes(1))
    expect(quotaCalls.length).toBeGreaterThanOrEqual(2)
    expect(document.querySelector('.publish-limit-note')).toBeNull()
  })

  it('the slot taken meanwhile: the last check holds the post back and says why', async () => {
    m.ctx.isScheduled = true
    m.ctx.scheduleDateTime = formatDateTimeLocal(new Date(FREE_AT))
    const { user } = renderWithProviders(<EmbedPreview />, { route: '/embed-studio/preview' })
    const post = screen.getAllByRole('button', { name: 'Post Video' })[0]
    await waitFor(() => expect(post).toBeEnabled())
    // Another video got scheduled right on that time in another tab.
    SCHEDULED_AT = FREE_AT
    FREE_AT = SCHEDULED_AT + DAY
    await user.click(post)
    await waitFor(() => expect(toastMessages(toast.error).join(' ')).toContain('This time is taken.'))
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('a Short over its 3 a day cannot be scheduled here: Post is off until its free time, no schedule button', async () => {
    m.ctx = { ...m.ctx, fromStories: true, title: '' }
    m.shortsTaken = true
    renderWithProviders(<EmbedPreview />, { route: '/embed-studio/preview' })
    const note = await screen.findByText(/You cannot publish this right now\./)
    expect(note).toHaveTextContent('On the free plan you can publish 3 Shorts per 24 hours.')
    expect(note).toHaveTextContent(`It can be posted from ${fmt(PUBLISHED_AT + DAY)}.`)
    expect(quotaCalls.at(-1).searchParams.get('kind')).toBe('short')
    expect(screen.queryByRole('button', { name: /^Schedule for / })).toBeNull()
    for (const b of screen.getAllByRole('button', { name: 'Post Short' })) expect(b).toBeDisabled()
  })
})
