// @vitest-environment jsdom
// The batch form with podcast episodes (src/page/ImportBatch.jsx): the kind of
// audio and "Import from source", or the creator's own content fields.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/lib/youtubeImport', () => ({ createImportBatch: vi.fn(async () => ({ id: 'b1', items: [] })), cancelImportBatch: vi.fn(), fmtDuration: (s) => `${s}s`, saveAutoImport: vi.fn() }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchCreatorAdPrefs: async () => ({}) }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/utils/postingAuthority', () => ({ addThreespeakToPostingAuth: vi.fn(), waitForThreespeakPostingAuth: vi.fn(async () => true) }))
vi.mock('../../../src/components/HiveAvatar/AccountImg', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Community_modal', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Beneficiary_modal', () => ({ default: () => null }))

const { createImportBatch } = await import('../../../src/lib/youtubeImport')
const { BatchForm } = await import('../../../src/page/ImportBatch.jsx')

const episodes = [
  { id: 'rss:AAAAAAAAAAAAAAAA', token: 't1', platform: 'rss', title: 'Episode 1', channelTitle: 'My Show', duration: 60, thumbnail: '' },
  { id: 'rss:BBBBBBBBBBBBBBBB', token: 't2', platform: 'rss', title: 'Episode 2', channelTitle: 'My Show', duration: 60, thumbnail: '' },
]
const form = (videos = episodes) => renderWithProviders(
  <BatchForm user="alice" videos={videos} spacingMin={30} granted onGranted={vi.fn()} onClose={vi.fn()} onStarted={vi.fn()} />,
)
const next = (user) => user.click(screen.getByRole('button', { name: 'Next' }))
const start = (user) => user.click(screen.getByRole('button', { name: /Start import/ }))

beforeEach(() => vi.clearAllMocks())

describe('batch form with podcast episodes', () => {
  it('from the source by default: the kind is sent, no remix tile, no encoder', async () => {
    const { user } = form()
    expect(screen.getByRole('dialog', { name: 'Import 2 episodes' })).toBeInTheDocument()
    expect(screen.getByText(/where each post's title, description and tags come from/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Import from source' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('Tags')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Interview' }))
    await next(user)
    expect(screen.queryByText(/remix/i)).toBeNull()
    await start(user)
    await waitFor(() => expect(createImportBatch).toHaveBeenCalled())
    const [items, options] = createImportBatch.mock.calls[0]
    expect(items).toEqual([{ token: 't1' }, { token: 't2' }])
    expect(options.audio).toMatchObject({ type: 'interview', fromSource: true })
    expect(options.beneficiaries.map((b) => b.account)).toEqual(['threespeakfund'])
  })

  it('own fields: title format, tags, own text instead of the notes', async () => {
    const { user } = form()
    await user.click(screen.getByRole('switch', { name: 'Import from source' }))
    await user.click(screen.getByRole('button', { name: 'My Show: Episode title' }))
    await user.type(screen.getByLabelText('Tags'), 'talk')
    await user.click(screen.getByRole('switch', { name: 'Use the show notes as the description' }))
    await next(user)
    expect(screen.getByRole('alert')).toHaveTextContent('Write the description to use')
    await user.type(screen.getByLabelText('Description'), 'New episode')
    await next(user)
    await start(user)
    await waitFor(() => expect(createImportBatch).toHaveBeenCalled())
    expect(createImportBatch.mock.calls[0][1].audio).toEqual({
      type: 'podcast', target: 'post', fromSource: false, titleTemplate: '{show}: {title}', useNotes: false, addendum: '', text: 'New episode', tags: ['talk'], hashtags: true,
    })
  })

  it('as snap comments: no community and no blog, the target is sent', async () => {
    const { user } = form()
    await user.click(screen.getByRole('tab', { name: 'Snap comment' }))
    expect(screen.getByText(/A reply in the snaps feed/)).toBeInTheDocument()
    await next(user)
    expect(screen.queryByText('Community')).toBeNull()
    expect(screen.queryByRole('switch', { name: /blog/i })).toBeNull()
    await start(user)
    await waitFor(() => expect(createImportBatch).toHaveBeenCalled())
    expect(createImportBatch.mock.calls[0][1].audio).toMatchObject({ target: 'snap', fromSource: true })
  })

  it('videos only: no audio settings at all', async () => {
    const { user } = form([{ id: 'abcdefghijk', platform: 'youtube', title: 'A video', duration: 60, thumbnail: '' }])
    expect(screen.queryByRole('switch', { name: 'Import from source' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Import 1 videos' })).toBeInTheDocument()
    await next(user)
    await start(user)
    await waitFor(() => expect(createImportBatch).toHaveBeenCalled())
    expect(createImportBatch.mock.calls[0][1].audio).toBeUndefined()
  })
})

describe('batch items the daily limit refused', () => {
  it('are worded in the creator\'s language by their code', async () => {
    const { limitText } = await import('../../../src/page/ImportBatch.jsx')
    const t = (k, o) => (o ? `${k} ${JSON.stringify(o)}` : k)
    expect(limitText({ errorCode: 'daily_upload_limit', isShort: true }, t)).toBe('uploadLimits.reached.short uploadLimits.later')
    expect(limitText({ errorCode: 'daily_upload_limit', isShort: false }, t)).toBe('uploadLimits.reached.video uploadLimits.later')
    expect(limitText({ errorCode: 'daily_audio_limit' }, t)).toBe('uploadLimits.reached.audio uploadLimits.later')
    expect(limitText({ errorCode: 'audio_too_long' }, t)).toBe('uploadLimits.tooLongPlain {"minutes":15}')
    expect(limitText({ errorCode: 'download_failed' }, t)).toBeNull()
  })
})
