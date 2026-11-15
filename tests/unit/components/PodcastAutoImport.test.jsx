// @vitest-environment jsdom
// 🔁 The automatic podcast import card and its settings form
// (src/page/PodcastAutoImport.jsx). The save call and the ad prefs are stand-ins.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/lib/youtubeImport', () => ({ saveAutoImport: vi.fn() }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchCreatorAdPrefs: async () => ({}) }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/utils/postingAuthority', () => ({ addThreespeakToPostingAuth: vi.fn(), waitForThreespeakPostingAuth: vi.fn(async () => true) }))
vi.mock('../../../src/components/HiveAvatar/AccountImg', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Community_modal', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Beneficiary_modal', () => ({ default: () => null }))

const { saveAutoImport } = await import('../../../src/lib/youtubeImport')
const { PodcastAutoCard, previewTitle } = await import('../../../src/page/PodcastAutoImport.jsx')

const show = { url: 'https://example.com/feed.xml', id: '0123456789abcdef01234567', title: 'My Show' }
const sample = { title: 'Latest episode', show: 'My Show', episode: 12, date: '2026-11-14' }
const info = (configs = []) => ({ available: true, intervalMin: 15, maxPerDay: 5, configs })
const card = (props = {}) => renderWithProviders(
  <PodcastAutoCard user="alice" show={show} info={info()} sample={sample} granted onGranted={vi.fn()} onSaved={vi.fn()} {...props} />,
)

beforeEach(() => vi.clearAllMocks())

describe('previewTitle', () => {
  it('fills the template like the server and drops what has no value', () => {
    expect(previewTitle('{show} #{episode}: {title}', sample)).toBe('My Show #12: Latest episode')
    expect(previewTitle('{show} #{episode}: {title} ({date})', { title: 'Hi' })).toBe('Hi')
  })
})

describe('PodcastAutoCard', () => {
  it('off: says so and offers the set-up', () => {
    card()
    expect(screen.getByText(/Off\. Switch it on/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Set up automatic import/ })).toBeInTheDocument()
  })

  it('on: since when, what it did, and why the last check failed', () => {
    card({
      info: info([{
        feedUrl: show.url, enabled: true, enabledAt: '2026-11-14T10:00:00Z', settings: {}, options: {},
        status: { queued: 3, waiting: 2, lastErrorCode: 'no_grant', lastSkipped: [{ title: 'Marathon', reason: 'too_long' }] },
      }]),
    })
    expect(screen.getByText(/On since/)).toBeInTheDocument()
    expect(screen.getByText('New episodes imported so far: 3')).toBeInTheDocument()
    expect(screen.getByText('Waiting for tomorrow: 2 (at most 5 a day)')).toBeInTheDocument()
    expect(screen.getByText(/Skipped, longer than the import limit: Marathon/)).toBeInTheDocument()
    expect(screen.getByText(/3Speak may no longer publish for you/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit settings/ })).toBeInTheDocument()
  })

  it('not on this server: no set-up button', () => {
    card({ info: { ...info(), available: false } })
    expect(screen.getByText(/not available on this server yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull()
  })
})

describe('the settings form', () => {
  it('saves the title template, tags, notes with an addendum and the kind', async () => {
    const onSaved = vi.fn()
    saveAutoImport.mockResolvedValue({ config: { feedUrl: show.url, enabled: true } })
    const { user } = card({ onSaved })
    await user.click(screen.getByRole('button', { name: /Set up automatic import/ }))
    await user.click(screen.getByRole('tab', { name: 'Interview' }))
    // Own fields only once "Import from source" is off.
    expect(screen.queryByLabelText('Tags')).toBeNull()
    await user.click(screen.getByRole('switch', { name: 'Import from source' }))
    await user.click(screen.getByRole('button', { name: 'My Show #12: Episode title' }))
    expect(screen.getByText('Example: My Show #12: Latest episode')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Tags'), 'talk hive')
    await user.type(screen.getByLabelText(/Text under the show notes/), 'Subscribe!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(saveAutoImport).toHaveBeenCalledWith(expect.objectContaining({
      feedUrl: show.url,
      enabled: true,
      settings: { type: 'interview', target: 'post', fromSource: false, titleTemplate: '{show} #{episode}: {title}', useNotes: true, addendum: 'Subscribe!', text: '', tags: ['talk', 'hive'], hashtags: true },
      options: expect.objectContaining({ community: 'hive-181335', payout: 'default', beneficiaries: [], nsfw: false, reblog: false, ads: true }),
    }))
  })

  it('without the show notes a description of your own is required', async () => {
    const { user } = card()
    await user.click(screen.getByRole('button', { name: /Set up automatic import/ }))
    await user.click(screen.getByRole('switch', { name: 'Import from source' }))
    await user.click(screen.getByRole('switch', { name: 'Use the show notes as the description' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write the description to use')
    expect(saveAutoImport).not.toHaveBeenCalled()
    // user-event reads "{" as a key: "{{" types one brace.
    await user.type(screen.getByLabelText('Description'), 'New from {{show}')
    saveAutoImport.mockResolvedValue({ config: { feedUrl: show.url } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveAutoImport).toHaveBeenCalled())
    expect(saveAutoImport.mock.calls[0][0].settings).toMatchObject({ useNotes: false, text: 'New from {show}' })
  })

  it('from the source by default: only the kind is picked, the episode gives the rest', async () => {
    saveAutoImport.mockResolvedValue({ config: { feedUrl: show.url } })
    const { user } = card()
    await user.click(screen.getByRole('button', { name: /Set up automatic import/ }))
    expect(screen.getByRole('switch', { name: 'Import from source' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveAutoImport).toHaveBeenCalled())
    expect(saveAutoImport.mock.calls[0][0].settings).toMatchObject({ type: 'podcast', fromSource: true })
  })

  it('a saved setup opens with its own choice', async () => {
    const { user } = card({
      info: info([{ feedUrl: show.url, enabled: true, enabledAt: '2026-11-14T10:00:00Z', settings: { type: 'audiobook', fromSource: false, titleTemplate: '{show}: {title}', tags: ['books'], useNotes: true }, options: {}, status: {} }]),
    })
    await user.click(screen.getByRole('button', { name: /Edit settings/ }))
    expect(screen.getByRole('switch', { name: 'Import from source' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText('Tags')).toHaveValue('books')
    expect(screen.getByRole('tab', { name: 'Audiobook' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switching on without the publish permission asks for it first', async () => {
    const { user } = card({ granted: false })
    await user.click(screen.getByRole('button', { name: /Set up automatic import/ }))
    expect(screen.getByText(/needs permission to publish on your account/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
