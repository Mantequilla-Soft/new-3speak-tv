// @vitest-environment jsdom
// "Save to Playlist" (components/AddToPlaylistModal/AddToPlaylistModal.jsx):
// Watch Later first (created, private, on first use), then the member's own
// playlists with the ones already holding the video marked, and a form to create
// a new playlist with the video in it. Playlist writes are spies.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/hooks/useMyPlaylists', async (importOriginal) => ({
  ...(await importOriginal()),
  useMyPlaylists: () => m.query,
}))
vi.mock('../../../src/utils/playlistOperations', () => ({
  addToPlaylist: (...a) => m.add(...a),
  createPlaylistAndAdd: (...a) => m.create(...a),
}))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: AddToPlaylistModal } = await import('../../../src/components/AddToPlaylistModal/AddToPlaylistModal.jsx')

const VIDEO = { author: 'badadib', permlink: 'lake-day' }
const list = (id, name, items = [], extra = {}) => ({ id, name, access: 'public', items, ...extra })

function mount(props = {}) {
  const onClose = vi.fn()
  const r = renderWithProviders(<AddToPlaylistModal isOpen onClose={onClose} {...VIDEO} videoTitle="A day at the lake" {...props} />)
  return { ...r, onClose }
}

beforeEach(() => {
  m.query = { data: [list('wl', 'Watch Later', [], { access: 'private' }), list('p1', 'Trips', [{ author: 'other', permlink: 'x' }]), list('p2', 'Lakes', [VIDEO])], isLoading: false, refetch: vi.fn() }
  m.add = vi.fn(async () => {})
  m.create = vi.fn(async () => {})
  useAppStore.setState({ user: 'listener' })
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-1')
})

describe('saving a video to a playlist', () => {
  it('renders nothing while closed', () => {
    mount({ isOpen: false })
    expect(screen.queryByRole('heading', { name: 'Save to Playlist' })).not.toBeInTheDocument()
  })

  it('lists Watch Later first, then the member\'s playlists, marking where the video already is', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Save to Playlist' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').filter((b) => /Watch Later|Trips|Lakes/.test(b.textContent))
    expect(buttons.map((b) => b.textContent.match(/Watch Later|Trips|Lakes/)[0])).toEqual(['Watch Later', 'Trips', 'Lakes'])
    expect(within(buttons[1]).getByText('1 video')).toBeInTheDocument()
    expect(within(buttons[2]).getByText('Added')).toBeInTheDocument()
    expect(within(buttons[1]).queryByText('Added')).not.toBeInTheDocument()
  })

  it('adds the video to a playlist, confirms and closes', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: /Trips/ }))
    expect(m.add).toHaveBeenCalledWith('p1', 'badadib', 'lake-day', 0)
    expect(toastMessages(toast.success)).toEqual(['Added to "Trips"'])
    expect(onClose).toHaveBeenCalled()
  })

  it('does not add it twice', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: /Lakes/ }))
    expect(m.add).not.toHaveBeenCalled()
    expect(toastMessages(toast.info)).toEqual(['Video is already in this playlist'])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open and says why when adding fails', async () => {
    m.add = vi.fn(async () => { throw new Error('signature refused') })
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: /Trips/ }))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Failed to add: signature refused']))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('adds to an existing Watch Later', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Watch Later/ }))
    expect(m.add).toHaveBeenCalledWith('wl', 'badadib', 'lake-day', 0)
    expect(toastMessages(toast.success)).toEqual(['Added to Watch Later'])
  })

  it('creates Watch Later as a private playlist the first time', async () => {
    m.query.data = [list('p1', 'Trips')]
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Watch Later/ }))
    expect(m.create).toHaveBeenCalledWith('Watch Later', 'private', 'uuid-1', 'badadib', 'lake-day')
    expect(toastMessages(toast.success)).toEqual(['Created Watch Later and added video!'])
  })

  it('says when the video is in Watch Later already', async () => {
    m.query.data = [list('wl', 'Watch Later', [VIDEO])]
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Watch Later/ }))
    expect(m.add).not.toHaveBeenCalled()
    expect(toastMessages(toast.info)).toEqual(['Video is already in Watch Later'])
  })

  it('says it is loading the playlists', () => {
    m.query = { data: [], isLoading: true, refetch: vi.fn() }
    mount()
    expect(screen.getByText('Loading playlists...')).toBeInTheDocument()
  })

  it('creates a new playlist with tags and the video in it', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: /Create new playlist/ }))
    const create = screen.getByRole('button', { name: 'Create & Add' })
    expect(create).toBeDisabled()
    await user.type(screen.getByPlaceholderText('My awesome playlist'), '  Summer  ')
    await user.click(screen.getByRole('button', { name: 'Private' }))
    const tags = screen.getByPlaceholderText('Type a tag and press Enter')
    await user.type(tags, 'Travel{Enter}')
    await user.type(screen.getByPlaceholderText('Add more...'), 'lakes,')
    await user.type(screen.getByPlaceholderText('Add more...'), 'travel{Enter}')
    expect(screen.getAllByText(/^(travel|lakes)$/).map((n) => n.textContent)).toEqual(['travel', 'lakes'])
    await user.click(create)
    // A playlist made from a video starts as a video playlist.
    expect(m.create).toHaveBeenCalledWith('Summer', 'private', 'uuid-1', 'badadib', 'lake-day', ['travel', 'lakes'], { type: 'video', kind: null })
    expect(toastMessages(toast.success)).toEqual(['Created "Summer" and added video!'])
    expect(onClose).toHaveBeenCalled()
  })

  it('removes a tag with Backspace in an empty box', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Create new playlist/ }))
    await user.type(screen.getByPlaceholderText('Type a tag and press Enter'), 'one{Enter}')
    await user.type(screen.getByPlaceholderText('Add more...'), '{Backspace}')
    expect(screen.queryByText('one')).not.toBeInTheDocument()
  })

  it('offers to create a first playlist when there is none', async () => {
    m.query.data = []
    const { user } = mount()
    expect(screen.getByText("You don't have any other playlists yet")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Create a playlist/ }))
    expect(screen.getByPlaceholderText('My awesome playlist')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('My awesome playlist')).not.toBeInTheDocument()
  })

  it('closes from its X and from the backdrop, but not from a click inside', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('heading', { name: 'Save to Playlist' }))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(document.querySelector('.add-to-playlist-overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // BUG: the window is a plain <div> overlay (AddToPlaylistModal.jsx:166-167) with
  // no role="dialog" and no Escape key, and the create form's labels are not
  // tied to their fields (:248, :259, :278).
  it('BUG: is a dialog Escape closes, with labelled fields', async () => {
    const { user, onClose } = mount()
    expect(screen.getByRole('dialog', { name: 'Save to Playlist' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Create new playlist/ }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
