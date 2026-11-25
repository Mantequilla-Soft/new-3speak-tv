// ScheduledPostEditor (src/components/studio/ScheduledPostEditor.jsx): editing and
// cancelling a post queued on the checker. Each write carries the owner's
// signature (utils/scheduledPostProof.js, a fake here), asked for right before it
// is sent; a write that fails says why and leaves the form as it was. The checker
// (axios) is a fake.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ get: null, post: null, prove: null, user: 'alice' }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('axios', () => ({ default: { get: (...a) => m.get(...a), post: (...a) => m.post(...a) } }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (pick) => (typeof pick === 'function' ? pick({ user: m.user }) : { user: m.user }) }))
vi.mock('../../../src/utils/config', async (importOriginal) => ({ ...(await importOriginal()), CHECKER_API_KEY: 'checker-key' }))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn() }))
vi.mock('../../../src/components/studio/MarkdownComposer', () => ({
  default: ({ value, onChange }) => <textarea aria-label="Description" value={value} onChange={(e) => onChange(e.target.value)} />,
}))
vi.mock('../../../src/components/modal/Beneficiary_modal', () => ({ default: () => null }))
vi.mock('../../../src/utils/scheduledPostProof', async (importOriginal) => ({
  ...(await importOriginal()),
  proveScheduledPost: (...a) => m.prove(...a),
}))

const { default: ScheduledPostEditor } = await import('../../../src/components/studio/ScheduledPostEditor.jsx')
const { ScheduledPostProofError } = await import('../../../src/utils/scheduledPostProof.js')
const { toast } = await import('sonner')

const SCHEDULED = {
  permlink: 'my-video-42', owner: 'alice', status: 'scheduled', title: 'Hello', description: 'desc',
  scheduledOn: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(), tags: ['a'], beneficiaries: [], payoutOptions: 'default',
}
const PROOF = { signature: 'OWNER-SIG', timestamp: 4242 }
const writeTo = (path) => m.post.mock.calls.filter(([url]) => url.endsWith(path))

beforeEach(() => {
  m.user = 'alice'
  m.get = vi.fn(async () => ({ data: { scheduled_posts: [SCHEDULED] } }))
  m.post = vi.fn(async () => ({ data: { success: true } }))
  m.prove = vi.fn(async () => PROOF)
})

async function mount(props = {}) {
  const onSaved = vi.fn()
  const onCancelled = vi.fn()
  const r = renderWithProviders(<ScheduledPostEditor permlink="my-video-42" onSaved={onSaved} onCancelled={onCancelled} {...props} />)
  await screen.findByRole('button', { name: 'Save changes' })
  return { ...r, onSaved, onCancelled }
}

describe('saving changes', () => {
  it('the premiere listing shows as it is and is saved with the rest', async () => {
    m.get = vi.fn(async () => ({ data: { scheduled_posts: [{ ...SCHEDULED, premiere: true }] } }))
    const { user, onSaved } = await mount()
    const sw = screen.getByRole('switch', { name: 'List as a premiere' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(writeTo('/scheduled-posts/update')[0][1].updates.premiere).toBe(false)
  })

  it('signs the update for the owner right before sending it', async () => {
    const { user, onSaved } = await mount()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(m.prove).toHaveBeenCalledWith({ action: 'update', owner: 'alice', permlink: 'my-video-42' })
    const [[url, body, config]] = writeTo('/scheduled-posts/update')
    expect(url).toBe('https://prod-checker.okinoko.io/scheduled-posts/update')
    expect(body).toMatchObject({ ...PROOF, owner: 'alice', permlink: 'my-video-42', updates: { title: 'Hello' } })
    expect(config).toEqual({ headers: { Authorization: 'Bearer checker-key' } })
    expect(m.prove.mock.invocationCallOrder[0]).toBeLessThan(m.post.mock.invocationCallOrder[0])
    expect(toastMessages(toast.success)).toContain('Scheduled post updated')
  })

  it('without a signature (the checker still takes that) it is sent unsigned, as before', async () => {
    m.prove = vi.fn(async () => ({}))
    const { user, onSaved } = await mount()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [[, body]] = writeTo('/scheduled-posts/update')
    expect(body).not.toHaveProperty('signature')
  })

  it('a signature that cannot be had says why, sends nothing and keeps the form', async () => {
    m.prove = vi.fn(async () => { throw new ScheduledPostProofError('not_signed_in_as', 'alice') })
    const { user, onSaved } = await mount()
    const titleInput = screen.getByDisplayValue('Hello')
    await user.clear(titleInput)
    await user.type(titleInput, 'New title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Could not confirm that you are signed in as @alice. Log out and back in, then try again.'))
    expect(writeTo('/scheduled-posts/update')).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('New title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('the checker refusing it for want of a signature is said in words', async () => {
    m.post = vi.fn(async () => { throw Object.assign(new Error('Request failed'), { response: { status: 401, data: { error: 'Signature required' } } }) })
    const { user } = await mount()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('The scheduled post was refused because it could not be confirmed as yours. Log out and back in, then try again.'))
  })
})

describe('cancelling', () => {
  it('signs the cancel for the owner and sends it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, onCancelled } = await mount()
    await user.click(screen.getByRole('button', { name: 'Cancel scheduled post' }))
    await waitFor(() => expect(onCancelled).toHaveBeenCalled())
    expect(m.prove).toHaveBeenCalledWith({ action: 'cancel', owner: 'alice', permlink: 'my-video-42' })
    expect(writeTo('/scheduled-posts/cancel')[0][1]).toEqual({ ...PROOF, owner: 'alice', permlink: 'my-video-42' })
    expect(toastMessages(toast.success)).toContain('Scheduled post cancelled')
  })

  it('asks nothing and sends nothing when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await mount()
    await user.click(screen.getByRole('button', { name: 'Cancel scheduled post' }))
    expect(m.prove).not.toHaveBeenCalled()
    expect(writeTo('/scheduled-posts/cancel')).toHaveLength(0)
  })

  it('a missing grant says so, and the post stays', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.prove = vi.fn(async () => { throw new ScheduledPostProofError('no_grant', 'alice') })
    const { user, onCancelled } = await mount()
    await user.click(screen.getByRole('button', { name: 'Cancel scheduled post' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Scheduling needs @threespeak posting authority on your account.'))
    expect(writeTo('/scheduled-posts/cancel')).toHaveLength(0)
    expect(onCancelled).not.toHaveBeenCalled()
  })
})

// ⏳ The free plan's daily publish limit (lib/publishQuota.js): a new time is
// checked with the checker's GET /publish-quota (fetch, a fake), leaving the
// post itself out; a taken one shows what takes it and holds Save back.
describe('the daily publish limit', () => {
  const DAY = 24 * 3600 * 1000
  const fmt = (ms) => new Date(ms).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
  const minute = (ms) => Math.ceil(ms / 60000) * 60000
  const conflictAt = Date.parse(SCHEDULED.scheduledOn) + 3 * 3600 * 1000
  const freeAt = minute(Date.parse(SCHEDULED.scheduledOn) + 3 * DAY)
  let quotaCalls
  const answer = (url) => {
    const at = Date.parse(new URL(url).searchParams.get('at'))
    const taken = at < freeAt
    return {
      success: true, enabled: true, exempt: false, reason: null, kind: 'video', limit: 1, window_hours: 24,
      at: new Date(at).toISOString(), allowed: !taken,
      conflicts: taken ? [{ permlink: 'trip', title: 'Trip', at: new Date(conflictAt).toISOString(), scheduled: true }] : [],
      next_free_at: new Date(taken ? freeAt : at).toISOString(),
    }
  }
  beforeEach(async () => {
    const { refreshPublishQuota } = await import('../../../src/lib/publishQuota.js')
    refreshPublishQuota()
    quotaCalls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/publish-quota/')) { quotaCalls.push(String(url)); return { ok: true, json: async () => answer(String(url)) } }
      return { ok: true, json: async () => ({ premium: false }) }
    }))
  })

  it('the loaded time is not checked again', async () => {
    await mount()
    await new Promise((r) => setTimeout(r, 500))
    expect(quotaCalls).toEqual([])
  })

  it('a taken new time: says what takes it, Save is off, and "Use" puts the free time in', async () => {
    const { user } = await mount()
    // Twelve hours on: still within a day of "Trip".
    await user.click(screen.getByRole('button', { name: /^(AM|PM)$/ }))
    const note = await screen.findByText(/This time is taken\./)
    expect(note).toHaveTextContent('On the free plan you can publish 1 video per 24 hours.')
    expect(note).toHaveTextContent(`"Trip" is scheduled for ${fmt(conflictAt)}.`)
    expect(note).toHaveTextContent(`Earliest free time: ${fmt(freeAt)}.`)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    const url = new URL(quotaCalls.at(-1))
    expect(url.pathname).toBe('/publish-quota/alice')
    expect(url.searchParams.get('kind')).toBe('video')
    expect(url.searchParams.get('exclude')).toBe('my-video-42')

    await user.click(screen.getByRole('button', { name: `Use ${fmt(freeAt)}` }))
    await waitFor(() => expect(Date.parse(new URL(quotaCalls.at(-1)).searchParams.get('at'))).toBe(freeAt))
    await waitFor(() => expect(screen.queryByText(/This time is taken\./)).toBeNull())
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('the checker refusing the time at Save (429) is said in words, not as its raw error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    m.post = vi.fn(async () => {
      throw Object.assign(new Error('Request failed with status code 429'), { response: { status: 429, data: {
        error: 'Daily publish limit reached', code: 'daily_publish_limit', kind: 'video', limit: 1,
        conflicts: [{ permlink: 'trip', title: 'Trip', at: new Date(conflictAt).toISOString(), scheduled: true }],
        next_free_at: new Date(freeAt).toISOString(),
      } } })
    })
    const { user, onSaved } = await mount()
    await user.click(screen.getByRole('button', { name: /^(AM|PM)$/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(toastMessages(toast.error).join(' ')).toContain(`This time is taken. On the free plan you can publish 1 video per 24 hours. "Trip" is scheduled for ${fmt(conflictAt)}. Earliest free time: ${fmt(freeAt)}.`))
    expect(onSaved).not.toHaveBeenCalled()
  })
})
