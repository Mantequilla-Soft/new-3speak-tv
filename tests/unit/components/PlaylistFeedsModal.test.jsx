// @vitest-environment jsdom
// The owner's editor for the external shows of a playlist
// (components/Podcasts/PlaylistFeedsModal.jsx): a link is checked with the checker
// before it is listed, a name searches the directories, and Save writes the list
// into the playlist's json_metadata, keeping everything else in it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/playlistOperations', () => ({ updatePlaylist: (...a) => m.update(...a) }))
vi.mock('../../../src/lib/podcasts', async (orig) => ({
  ...(await orig()),
  resolveFeed: (...a) => m.resolve(...a),
  searchPodcasts: (...a) => m.search(...a),
}))
vi.mock('../../../src/components/Podcasts/PodcastArt', () => ({ default: () => <span /> }))

const { toast } = await import('sonner')
const { default: PlaylistFeedsModal } = await import('../../../src/components/Podcasts/PlaylistFeedsModal.jsx')

const META = { tags: ['talk'], type: 'audio', feeds: [{ url: 'https://old.example/rss', title: 'Old Show' }] }
let props
function mount(over = {}) {
  props = { playlistId: 'pl-1', user: 'badadib', jsonMeta: META, onClose: vi.fn(), onSaved: vi.fn(), ...over }
  return renderWithProviders(<PlaylistFeedsModal {...props} />)
}
const savedMeta = () => JSON.parse(m.update.mock.calls[0][1].json_metadata)

beforeEach(() => {
  m.update = vi.fn(async () => {})
  m.resolve = vi.fn(async (_user, url) => ({ success: true, feed: { id: 'f2', url, title: 'New Show' } }))
  m.search = vi.fn(async () => ({ results: [] }))
})

describe('the external shows editor', () => {
  it('lists the shows already in the playlist; Save stays off until something changes', () => {
    mount()
    expect(screen.getByRole('dialog', { name: 'External shows' })).toBeInTheDocument()
    expect(screen.getByText('Old Show')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  it('checks a pasted link, lists it, and saves the list into json_metadata', async () => {
    const { user } = mount()
    await user.type(screen.getByRole('searchbox', { name: 'Search shows or paste a feed link' }), 'feeds.example/new.xml')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(m.resolve).toHaveBeenCalledWith('badadib', 'https://feeds.example/new.xml')
    expect(await screen.findByText('New Show')).toBeInTheDocument()
    expect(m.search).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1))
    expect(m.update.mock.calls[0][0]).toBe('pl-1')
    expect(Object.keys(m.update.mock.calls[0][1])).toEqual(['json_metadata'])
    expect(savedMeta()).toEqual({
      tags: ['talk'], type: 'audio',
      feeds: [{ url: 'https://old.example/rss', title: 'Old Show' }, { url: 'https://feeds.example/new.xml', title: 'New Show' }],
    })
    expect(props.onSaved).toHaveBeenCalledWith(m.update.mock.calls[0][1].json_metadata)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('removing the last show drops the key', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Remove Old Show' }))
    expect(screen.getByText('No external shows yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(m.update).toHaveBeenCalled())
    expect(savedMeta()).toEqual({ tags: ['talk'], type: 'audio' })
  })

  it('a name searches the directories, and a result is added like a link', async () => {
    m.search = vi.fn(async () => ({ results: [
      { url: 'https://found.example/rss', title: 'Found Show', author: 'Host' },
      { url: 'https://old.example/rss', title: 'Old Show again', author: 'Host' },
    ] }))
    const { user } = mount()
    await user.type(screen.getByRole('searchbox'), 'found')
    const row = (await screen.findByText('Found Show')).closest('.pl-feeds-row')
    // A show already in the list is marked, not offered again.
    expect(within(screen.getByText('Old Show again').closest('.pl-feeds-row')).getByText('In the playlist')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Add' }))
    expect(m.resolve).toHaveBeenCalledWith('badadib', 'https://found.example/rss')
  })

  it('says why a show cannot be added', async () => {
    m.resolve = vi.fn(async () => ({ success: false, code: 'private_feed' }))
    const { user } = mount()
    await user.type(screen.getByRole('searchbox'), 'https://secret.example/rss')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain("Feeds that need a password can't go into a playlist, because playlists are public."))

    m.resolve.mockClear()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'https://3speak.tv/rss/playlist/pl-1.xml')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(toastMessages(toast.error)).toContain("That is this playlist's own feed.")
    expect(m.resolve).not.toHaveBeenCalled()
  })

  it('a show the checker answers with twice is listed once', async () => {
    m.resolve = vi.fn(async () => ({ success: true, feed: { id: 'f1', url: 'https://old.example/rss/', title: 'Old Show' } }))
    const { user } = mount()
    await user.type(screen.getByRole('searchbox'), 'https://www.old.example/rss')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('That show is already in this playlist.'))
    expect(screen.getAllByText('Old Show')).toHaveLength(1)
  })
})
