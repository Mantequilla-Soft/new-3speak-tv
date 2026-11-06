// @vitest-environment jsdom
// One playlist's page (page/PlaylistView.jsx): loading, an error and "not found",
// a private list hidden from everyone but its owner, the videos with their date
// filter, and the owner's tools (remove, reorder, edit, delete). An all-audio
// playlist is drawn as a podcast show with Play and an embed code.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from '../components/_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('../components/_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('axios', () => {
  const axios = { get: (...a) => m.get(...a), post: async () => ({ data: {} }), interceptors: { request: { use: () => {} }, response: { use: () => {} } } }
  axios.create = () => axios
  return { default: axios }
})
vi.mock('../../../src/utils/playlistVideos', () => ({ fetchVideosForPlaylist: (...a) => m.videos(...a) }))
vi.mock('../../../src/utils/playlistOperations', () => ({
  executePlaylistChanges: (...a) => m.execute(...a),
  deletePlaylist: (...a) => m.remove(...a),
  updatePlaylist: (...a) => m.update(...a),
  PlaylistActionTypes: { REORDER: 'reorder', REMOVE: 'remove' },
}))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: (...a) => m.upload(...a) }))
vi.mock('../../../src/hooks/useHoverPreview', () => ({ default: () => ({ containerProps: {}, getCardProps: () => ({}), overlay: null }) }))
vi.mock('../../../src/components/Loader/BarLoader', () => ({ default: () => <div role="progressbar" aria-label="Loading" /> }))
vi.mock('../../../src/components/AudioTile/AudioTile', () => ({ default: ({ item }) => <div>Audio tile {item.title}</div> }))
vi.mock('../../../src/components/Podcasts/PlaylistEpisodeTile', () => ({
  default: ({ item, number, onOpen }) => <li><button type="button" onClick={onOpen}>{`${number}. ${item.title}`}</button></li>,
}))
vi.mock('../../../src/components/Podcasts/PlaylistFollowButton', () => ({ default: () => <button type="button">Follow</button> }))
vi.mock('../../../src/components/AddToPlaylistModal/AddToPlaylistModal', () => ({ default: () => null }))
vi.mock('../../../src/components/AudioItem/AudioItemView', () => ({ audioItemPath: (i) => `/audio?play=${i.owner}/${i.permlink}` }))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: PlaylistView } = await import('../../../src/page/PlaylistView.jsx')
const { default: EmbedCodeHost } = await import('../../../src/components/Embed/EmbedCodeModal.jsx')

// Pinned to a Wednesday midday (only Date; timers stay real). The page groups by
// calendar day, week and month while the fixtures are "minutes/days ago", so on a
// real clock the suite failed whenever it ran just after midnight or the 1st.
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00Z') })
afterAll(() => vi.useRealTimers())

const now = Math.floor(Date.now() / 1000)
const PLAYLIST = {
  id: 'pl-1', name: 'Best of badadib', owner: 'badadib', access: 'public', created_at: now - 86400 * 40,
  json_metadata: JSON.stringify({ tags: ['music', 'live'] }), items: [{ author: 'badadib', permlink: 'v1' }, { author: 'badadib', permlink: 'v2' }],
}
const VIDEOS = [
  { author: 'badadib', permlink: 'v1', title: 'First video', duration: 125, position: 0, added_at: now - 3600 },
  { author: 'badadib', permlink: 'v2', title: 'Second video', duration: 0, position: 1, added_at: now - 86400 * 60 },
]
const track = (n) => ({
  author: 'badadib', permlink: `a${n}`, title: `Track ${n}`, isAudio: true, position: n - 1,
  audioDoc: { _id: `t${n}`, owner: 'badadib', permlink: `a${n}`, title: `Track ${n}`, category: 'podcast', thumbnail_url: '' },
})

function mount() {
  return renderWithProviders(<><PlaylistView /><EmbedCodeHost /></>, { route: '/playlist/pl-1', path: '/playlist/:playlistId' })
}
const signIn = (user) => act(() => useAppStore.setState({ user }))

beforeEach(() => {
  m.playlist = PLAYLIST
  m.get = vi.fn(async (url) => {
    if (m.getError) throw m.getError
    return { data: url.endsWith('/playlists/pl-1') ? m.playlist : null }
  })
  m.getError = null
  m.videos = vi.fn(async () => VIDEOS)
  m.execute = vi.fn(async () => ({ failed: [] }))
  m.remove = vi.fn(async () => {})
  m.update = vi.fn(async () => {})
  m.upload = vi.fn(async () => 'https://img.example/cover.jpg')
  useAppStore.setState({ user: null, audioCurrent: null })
})

describe('a playlist page', () => {
  it('shows a loader while the playlist loads', () => {
    m.get = vi.fn(() => new Promise(() => {}))
    mount()
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()
  })

  it('says what went wrong when the playlist cannot be loaded', async () => {
    m.getError = new Error('Network Error')
    mount()
    expect(await screen.findByText('Error loading playlist: Network Error')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Home/ })).toHaveAttribute('href', '/')
  })

  it('says so when there is no such playlist', async () => {
    m.playlist = null
    mount()
    expect(await screen.findByText('Playlist not found')).toBeInTheDocument()
  })

  it('keeps a private playlist from anyone but its owner, worded like "not found"', async () => {
    m.playlist = { ...PLAYLIST, access: 'private' }
    signIn('someone-else')
    mount()
    expect(await screen.findByText('This playlist is private')).toBeInTheDocument()
    expect(screen.queryByText('First video')).not.toBeInTheDocument()
  })

  it('shows a private playlist to its owner, whatever the letter case', async () => {
    m.playlist = { ...PLAYLIST, access: 'private' }
    signIn('BadAdib')
    mount()
    expect(await screen.findByRole('heading', { name: 'Best of badadib' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Podcast feed/ })).not.toBeInTheDocument()
  })

  it('shows the name, owner, count, tags, feed and the videos linked into the playlist', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Best of badadib' })).toBeInTheDocument()
    expect(m.get).toHaveBeenCalledWith(expect.stringMatching(/\/playlists\/pl-1$/))
    expect(screen.getByRole('link', { name: '@badadib' })).toHaveAttribute('href', '/@badadib')
    expect(await screen.findByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('music')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Podcast feed/ })).toHaveAttribute('href', '/rss/playlist/pl-1.xml')
    const first = await screen.findByRole('link', { name: /First video/ })
    expect(first).toHaveAttribute('href', '/@badadib/v1?playlist=pl-1&pos=0')
    expect(within(first).getByText('2:05')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('filters the videos by when they were added', async () => {
    const { user } = mount()
    await screen.findByRole('link', { name: /First video/ })
    await user.click(screen.getByRole('button', { name: 'This Month' }))
    expect(screen.queryByRole('link', { name: /Second video/ })).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 items')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('link', { name: /First video/ })).toBeInTheDocument()
  })

  it('says when a playlist has no videos', async () => {
    m.playlist = { ...PLAYLIST, items: [] }
    mount()
    expect(await screen.findByText('No videos in this playlist')).toBeInTheDocument()
  })
})

describe('a playlist page: the owner\'s tools', () => {
  beforeEach(() => signIn('badadib'))

  it('removes a video and saves the change', async () => {
    const { user } = mount()
    const first = await screen.findByRole('link', { name: /First video/ })
    await user.click(within(first).getByRole('button', { name: 'Remove from playlist' }))
    expect(screen.queryByRole('link', { name: /First video/ })).not.toBeInTheDocument()
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/playlist/pl-1')

    await user.click(screen.getByRole('button', { name: /Save Changes/ }))
    expect(m.execute).toHaveBeenCalledWith('pl-1', [{ type: 'remove', author: 'badadib', permlink: 'v1' }], expect.any(Function))
    await waitFor(() => expect(toastMessages(toast.success)).toContain('All changes saved! They may take a moment to appear.'))
    expect(screen.queryByText('1 unsaved change')).not.toBeInTheDocument()
  })

  it('says how many changes failed', async () => {
    m.execute = vi.fn(async () => ({ failed: [{}, {}] }))
    const { user } = mount()
    const first = await screen.findByRole('link', { name: /First video/ })
    await user.click(within(first).getByRole('button', { name: 'Remove from playlist' }))
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('2 operations failed'))
  })

  it('discards unsaved changes', async () => {
    const { user } = mount()
    const first = await screen.findByRole('link', { name: /First video/ })
    await user.click(within(first).getByRole('button', { name: 'Remove from playlist' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('link', { name: /First video/ })).toBeInTheDocument()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it('reorders by dragging a video onto another place', async () => {
    const { user } = mount()
    await screen.findByRole('link', { name: /First video/ })
    await user.click(screen.getByRole('button', { name: /Reorder/ }))
    expect(screen.getByRole('button', { name: /Done/ })).toBeInTheDocument()
    const rows = () => [...document.querySelectorAll('.video-item')]
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(rows()[0], { dataTransfer })
    fireEvent.dragOver(rows()[1], { dataTransfer })
    fireEvent.drop(rows()[1], { dataTransfer })
    expect(rows().map((r) => within(r).getByRole('heading').textContent)).toEqual(['Second video', 'First video'])
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))
    expect(m.execute.mock.calls[0][1]).toEqual([{ type: 'reorder', author: 'badadib', permlink: 'v1', newPosition: 1 }])
  })

  it('edits the name, visibility and tags', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    expect(screen.getByRole('heading', { name: 'Edit Playlist' })).toBeInTheDocument()
    const name = screen.getByPlaceholderText('Playlist name')
    expect(name).toHaveValue('Best of badadib')
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.click(screen.getByRole('button', { name: /Private/ }))
    await user.type(screen.getByPlaceholderText('Add more...'), 'Jazz{Enter}')
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))
    // The type goes along: top-level for the indexer, and in json_metadata as the owner's choice.
    expect(m.update).toHaveBeenCalledWith('pl-1', { name: 'Renamed', access: 'private', type: 'video', audio_kind: '', json_metadata: JSON.stringify({ tags: ['music', 'live', 'jazz'], type: 'video' }) })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Playlist' })).not.toBeInTheDocument())
    expect(toastMessages(toast.success)).toContain('Playlist updated! Changes may take a moment to appear.')
  })

  it('will not save an empty name', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    await user.clear(screen.getByPlaceholderText('Playlist name'))
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeDisabled()
  })

  it('uploads a new cover and sends it with the album details', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    const file = new File(['x'], 'cover.png', { type: 'image/png' })
    await user.upload(document.querySelector('input[type="file"]'), file)
    expect(m.upload).toHaveBeenCalledWith(file)
    expect(await screen.findByRole('img', { name: 'Cover' })).toHaveAttribute('src', 'https://img.example/cover.jpg')
    // Album details (genre, year, label, credits) belong to music playlists only.
    expect(screen.queryByPlaceholderText('1996')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Audio' }))
    await user.click(screen.getByRole('button', { name: 'Music' }))
    await user.type(screen.getByPlaceholderText('1996'), '2024')
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))
    const fields = m.update.mock.calls[0][1]
    expect(fields.thumbnail).toBe('https://img.example/cover.jpg')
    expect(fields.metadata).toEqual({ album: { year: 2024, thumbnail: 'https://img.example/cover.jpg' } })
  })

  it('deletes the playlist after a confirmation, then goes to the owner\'s profile', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Delete Playlist/ }))
    expect(screen.getByText('Are you sure you want to delete "Best of badadib"? This action cannot be undone.')).toBeInTheDocument()
    const confirm = screen.getAllByRole('button', { name: /Delete Playlist/ }).at(-1)
    await user.click(confirm)
    expect(m.remove).toHaveBeenCalledWith('pl-1')
    expect(toastMessages(toast.success)).toContain('Playlist deleted! Redirecting...')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/@badadib'), { timeout: 2500 })
  })

  it('cancelling the confirmation deletes nothing', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Delete Playlist/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/This action cannot be undone/)).not.toBeInTheDocument()
    expect(m.remove).not.toHaveBeenCalled()
  })

  // BUG: the edit window's labels are not tied to their fields (bare <label>
  // without htmlFor, PlaylistView.jsx:900, :1000 and on), so "Name", "Year" and the
  // rest are not the fields' accessible names; the tag chips' remove buttons
  // hold only an icon (:935).
  it('BUG: every field of the edit window has a label', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    expect(screen.getByLabelText('Name')).toHaveValue('Best of badadib')
    await user.click(screen.getByRole('button', { name: 'Audio' }))
    await user.click(screen.getByRole('button', { name: 'Music' }))
    expect(screen.getByLabelText('Year')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove.*music/i })).toBeInTheDocument()
  })

  // BUG: the delete confirmation and the edit window are plain <div> overlays,
  // without role="dialog" and without an Escape key (PlaylistView.jsx:878, :896).
  it('BUG: the delete confirmation is a dialog that Escape closes', async () => {
    const { user } = mount()
    await screen.findByRole('heading', { name: 'Best of badadib' })
    await user.click(screen.getByRole('button', { name: /Delete Playlist/ }))
    expect(screen.getByRole('dialog', { name: 'Delete Playlist?' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/This action cannot be undone/)).not.toBeInTheDocument()
  })
})

describe('an all-audio playlist', () => {
  beforeEach(() => {
    m.playlist = { ...PLAYLIST, name: 'Daily Voice', json_metadata: JSON.stringify({ type: 'audio' }) }
    m.videos = vi.fn(async () => [track(1), track(2)])
  })

  it('is shown as a podcast show with its episodes', async () => {
    const { user } = mount()
    expect(await screen.findByRole('heading', { name: 'Daily Voice' })).toBeInTheDocument()
    expect(screen.getByText('Podcast')).toBeInTheDocument()
    expect(await screen.findByText('2 episodes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1. Track 1' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/audio?play=badadib/a1')
  })

  it('Play starts the first episode with the others queued behind it', async () => {
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    const s = useAppStore.getState()
    expect(s.audioCurrent).toMatchObject({ _id: 't1' })
    expect(s.audioAutoplayList.map((t) => t._id)).toEqual(['t1', 't2'])
  })

  it('gives an embed code for the whole playlist', async () => {
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Embed/ }))
    const dialog = screen.getByRole('dialog', { name: 'Embed this playlist' })
    expect(within(dialog).getByRole('textbox', { name: 'Embed code' }).value).toContain('play?list=pl-1')
  })
})
