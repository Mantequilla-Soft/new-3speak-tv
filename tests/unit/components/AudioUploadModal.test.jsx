// @vitest-environment jsdom
// The audio upload (components/AudioUploadModal/AudioUploadModal.jsx) with the
// audio editor and the cover designer:
//  - "Edit audio" on a track opens it in the audio editor (open-audio-editor),
//    and the edited MP3 that comes back (audio-editor-result) takes the place of
//    that track's audio, marked "Edited"; audio made in the editor from the share
//    menu arrives as a new, edited track
//  - the chosen playlist's cover starts as the post cover and follows the
//    playlist until the creator picks, designs or clears one; track covers are
//    left to fall back to the playlist art
//  - every cover picker opens the cover designer
//  - songs from the editor's library are credited in the published post, with
//    the 5% split for a 3Speak sound creator
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ editor: true, playlists: [], duration: 125 }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  get FEATURE_EDITOR() { return m.editor },
  ENABLE_PPL: false,
  CHECKER_API_KEY: '',
  adsEnabledFor: () => false,
}))
vi.mock('../../../src/hooks/useMyPlaylists', () => ({
  useMyPlaylists: () => ({ data: m.playlists, isLoading: false, refetch: vi.fn() }),
}))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/utils/audioUpload', () => ({
  uploadAudioTo3Speak: vi.fn(async () => ({ permlink: 'aud-1', playUrl: 'https://audio.3speak.tv/play?a=aud-1' })),
  getSnapsContainer: vi.fn(async () => ({ author: 'peak.snaps', permlink: 'snaps-1' })),
  linkAudioToPost: vi.fn(async () => {}),
  audioFormatFor: () => 'webm',
}))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn(async () => 'https://images.hive.blog/DQmMine/mine.jpg') }))
vi.mock('../../../src/utils/postingAuthority', () => ({ hasThreespeakPostingAuth: async () => true, addThreespeakToPostingAuth: async () => {} }))
vi.mock('../../../src/utils/rcCheck', async (importOriginal) => ({ ...(await importOriginal()), checkPostingRc: async () => ({ ok: true }) }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchCreatorAdPrefs: async () => ({}), syncAudioAdChoice: async () => {} }))
vi.mock('../../../src/lib/uploadGate', () => ({ fetchUploadGateAd: async () => null, confirmUploadGatePost: () => {}, gateSessionId: () => null }))
vi.mock('../../../src/components/HiveAvatar/AccountImg', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Community_modal', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/Beneficiary_modal', () => ({ default: () => null }))
vi.mock('../../../src/components/AudioUploadModal/CoverDesigner', () => ({
  default: ({ src, onDone, onClose }) => (
    <div role="dialog" aria-label="Cover editor">
      <span data-testid="designer-src">{src || 'blank'}</span>
      <button type="button" onClick={() => onDone('https://images.hive.blog/DQmDesigned/designed.jpg')}>Designer done</button>
      <button type="button" onClick={onClose}>Designer close</button>
    </div>
  ),
}))

const { toast } = await import('sonner')
const aioha = await import('../../../src/hive-api/aioha')
const { uploadThumbnail } = await import('../../../src/utils/uploadThumbnail')
const { useAppStore } = await import('../../../src/lib/store')
const { default: AudioUploadModal } = await import('../../../src/components/AudioUploadModal/AudioUploadModal.jsx')

// jsdom reads no media: every <audio> reports m.duration as soon as it gets a src.
let savedSrc
let savedDuration
beforeAll(() => {
  const proto = HTMLMediaElement.prototype
  savedSrc = Object.getOwnPropertyDescriptor(proto, 'src')
  savedDuration = Object.getOwnPropertyDescriptor(proto, 'duration')
  Object.defineProperty(proto, 'src', {
    configurable: true,
    get() { return this.getAttribute('src') || '' },
    set(v) { this.setAttribute('src', v); queueMicrotask(() => this.onloadedmetadata?.()) },
  })
  Object.defineProperty(proto, 'duration', { configurable: true, get: () => m.duration })
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:audio-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
})
afterAll(() => {
  const proto = HTMLMediaElement.prototype
  if (savedSrc) Object.defineProperty(proto, 'src', savedSrc); else delete proto.src
  if (savedDuration) Object.defineProperty(proto, 'duration', savedDuration); else delete proto.duration
})

let opened
const onOpenEditor = (e) => opened.push(e.detail)

beforeEach(() => {
  vi.clearAllMocks()
  m.editor = true
  m.duration = 125
  m.playlists = [
    { id: 'p1', name: 'Show A', thumbnail: 'https://images.hive.blog/DQmA/a.jpg', items: [] },
    { id: 'p2', name: 'Show B', metadata: { album: { thumbnail: 'https://images.hive.blog/DQmB/b.jpg' } }, items: [] },
    { id: 'p3', name: 'No cover', items: [] },
  ]
  opened = []
  localStorage.setItem('addToBlog', '0')
  useAppStore.setState({ user: 'alice' })
  window.addEventListener('open-audio-editor', onOpenEditor)
})
afterEach(() => {
  window.removeEventListener('open-audio-editor', onOpenEditor)
  useAppStore.setState({ user: null })
})

function openModal(props = {}) {
  return renderWithProviders(<AudioUploadModal isOpen onClose={vi.fn()} {...props} />)
}

async function addFile(user, name = 'Episode 12.wav', type = 'audio/wav') {
  const file = new File(['RIFF....'], name, { type })
  const input = await waitFor(() => {
    const el = document.querySelector('input[type="file"][multiple]')
    if (!el) throw new Error('no picker yet')
    return el
  })
  await user.upload(input, file)
  await screen.findByText(name)
  return file
}

const next = (user) => user.click(screen.getByRole('button', { name: /Next/ }))
const back = (user) => user.click(screen.getByRole('button', { name: /Back/ }))
const row = (name) => screen.getByText(name).closest('.audio-upload-track-row')
const cover = () => document.querySelector('.audio-upload-post-form .audio-upload-album-thumb')

// source -> mode (Standalone post) -> playlist (name) -> post
async function toPostStep(user, playlistName) {
  await next(user)
  await user.click(screen.getByRole('button', { name: /Standalone post/ }))
  await next(user)
  if (playlistName) await user.click(screen.getByRole('button', { name: new RegExp(playlistName) }))
  await next(user)
  await screen.findByPlaceholderText('Title (required)')
}

const result = (detail) => act(async () => {
  window.dispatchEvent(new CustomEvent('audio-editor-result', { detail }))
})

describe('AudioUploadModal: Edit audio', () => {
  it('opens a track in the audio editor with its own file', async () => {
    const { user } = openModal()
    const file = await addFile(user)
    await user.click(within(row('Episode 12.wav')).getByRole('button', { name: /Edit audio/ }))
    expect(opened).toHaveLength(1)
    expect(opened[0].file).toBe(file)
    expect(opened[0].name).toBe('Episode 12')
    expect(typeof opened[0].trackId).toBe('string')
  })

  it('has no Edit audio without the editor feature', async () => {
    m.editor = false
    const { user } = openModal()
    await addFile(user)
    expect(screen.queryByRole('button', { name: /Edit audio/ })).toBeNull()
  })

  it('puts the edited MP3 in place of the track audio, marked Edited', async () => {
    const { user } = openModal()
    await addFile(user)
    await user.click(screen.getByRole('button', { name: /Edit audio/ }))
    const { trackId } = opened[0]
    const edited = new File(['ID3'], 'Episode 12.mp3', { type: 'audio/mpeg' })
    await result({ trackId, file: edited, durationSec: 42 })
    const r = await waitFor(() => row('Episode 12.mp3'))
    expect(within(r).getByText('Edited')).toBeInTheDocument()
    expect(within(r).getByText('0:42')).toBeInTheDocument()
    expect(screen.queryByText('Episode 12.wav')).toBeNull()
    expect(toastMessages(toast.success)).toContain('"Episode 12" now uses the edited audio')
    // Editing again sends the edited file
    await user.click(within(r).getByRole('button', { name: /Edit audio/ }))
    expect(opened[1].file).toBe(edited)
  })

  it('reads the length from the file when the editor sends none', async () => {
    const { user } = openModal()
    await addFile(user)
    await user.click(screen.getByRole('button', { name: /Edit audio/ }))
    m.duration = 3725
    await result({ trackId: opened[0].trackId, file: new File(['ID3'], 'cut.mp3', { type: 'audio/mpeg' }) })
    expect(await screen.findByText('1:02:05')).toBeInTheDocument()
  })

  it('ignores a result for a track that is not there', async () => {
    const { user } = openModal()
    await addFile(user)
    await result({ trackId: 'nope', file: new File(['x'], 'other.mp3') })
    expect(screen.getByText('Episode 12.wav')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('takes audio made in the editor from the share menu as a new, edited track', async () => {
    const blob = new File(['ID3'], 'edited-audio.mp3', { type: 'audio/mpeg' })
    openModal({ initialTrack: { blob, filename: 'edited-audio.mp3', type: null, source: 'editor' } })
    const r = await waitFor(() => row('edited-audio.mp3'))
    expect(within(r).getByText('Edited')).toBeInTheDocument()
  })

  it('keeps an OpenPods hand-off a recording, as before', async () => {
    openModal({ initialTrack: { blob: new Blob(['x'], { type: 'audio/ogg' }), filename: 'openpod.ogg', type: 'podcast' } })
    const r = await waitFor(() => row('openpod.ogg'))
    expect(within(r).queryByText('Edited')).toBeNull()
    expect(within(r).getByTitle('Recorded')).toBeInTheDocument()
  })
})

describe('AudioUploadModal: covers', () => {
  it('starts the post cover as the playlist cover and follows the playlist', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, 'Show A')
    expect(within(cover()).getByRole('img')).toHaveAttribute('src', 'https://images.hive.blog/DQmA/a.jpg')
    expect(within(cover()).getByText('From playlist')).toBeInTheDocument()

    await back(user)
    await user.click(screen.getByRole('button', { name: /Show B/ }))
    await next(user)
    expect(within(cover()).getByRole('img')).toHaveAttribute('src', 'https://images.hive.blog/DQmB/b.jpg')

    await back(user)
    await user.click(screen.getByRole('button', { name: /No cover/ }))
    await next(user)
    expect(within(cover()).queryByRole('img')).toBeNull()
    expect(within(cover()).getByText('Add cover image')).toBeInTheDocument()
  })

  it('never replaces a cover the creator uploaded', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, 'Show A')
    const input = cover().querySelector('input[type="file"]')
    await user.upload(input, new File(['png'], 'mine.png', { type: 'image/png' }))
    await waitFor(() => expect(within(cover()).getByRole('img')).toHaveAttribute('src', 'https://images.hive.blog/DQmMine/mine.jpg'))
    expect(within(cover()).queryByText('From playlist')).toBeNull()

    await back(user)
    await user.click(screen.getByRole('button', { name: /Show B/ }))
    await next(user)
    expect(within(cover()).getByRole('img')).toHaveAttribute('src', 'https://images.hive.blog/DQmMine/mine.jpg')
  })

  it('keeps a cleared cover cleared', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, 'Show A')
    await user.click(within(cover()).getByRole('button', { name: 'Remove cover' }))
    await back(user)
    await user.click(screen.getByRole('button', { name: /Show B/ }))
    await next(user)
    expect(within(cover()).queryByRole('img')).toBeNull()
  })

  it('designs on the playlist cover and uses the result', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, 'Show A')
    await user.click(within(cover()).getByRole('button', { name: /Edit cover/ }))
    expect(screen.getByTestId('designer-src')).toHaveTextContent('https://images.hive.blog/DQmA/a.jpg')
    // The designer's clicks stay inside the modal: the upload is still open
    await user.click(screen.getByRole('button', { name: 'Designer done' }))
    expect(screen.queryByRole('dialog', { name: 'Cover editor' })).toBeNull()
    expect(within(cover()).getByRole('img')).toHaveAttribute('src', 'https://images.hive.blog/DQmDesigned/designed.jpg')
    expect(within(cover()).queryByText('From playlist')).toBeNull()
    expect(screen.getByPlaceholderText('Title (required)')).toBeInTheDocument()
  })

  it('designs from scratch where there is no cover', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, null)
    await user.click(within(cover()).getByRole('button', { name: /Design a cover/ }))
    expect(screen.getByTestId('designer-src')).toHaveTextContent('blank')
    await user.click(screen.getByRole('button', { name: 'Designer close' }))
    expect(within(cover()).queryByRole('img')).toBeNull()
    // Opening the designer did not open the file picker for an upload
    expect(uploadThumbnail).not.toHaveBeenCalled()
  })

  it('closes only the designer on Esc, not the whole upload', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, 'Show A')
    await user.click(within(cover()).getByRole('button', { name: /Edit cover/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Discard upload?')).toBeNull()
    // Without the designer, Esc asks before throwing the upload away (as before)
    await user.click(screen.getByRole('button', { name: 'Designer close' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByText('Discard upload?')).toBeInTheDocument()
  })

  it('leaves track covers to the playlist art, and designs one per track', async () => {
    const { user } = openModal()
    await addFile(user, 'one.wav')
    await addFile(user, 'two.wav')
    await next(user) // mode: snaps by default
    await next(user)
    await user.click(screen.getByRole('button', { name: /Show A/ }))
    await next(user) // tracks
    const cards = await waitFor(() => {
      const list = [...document.querySelectorAll('.audio-upload-title-card')].filter((c) => c.querySelector('.audio-upload-track-text'))
      if (list.length !== 2) throw new Error('no track cards yet')
      return list
    })
    for (const c of cards) expect(within(c).queryByRole('img')).toBeNull()
    await user.click(within(cards[1]).getByRole('button', { name: /Design a cover/ }))
    await user.click(screen.getByRole('button', { name: 'Designer done' }))
    expect(within(cards[1]).getByRole('img')).toHaveAttribute('src', 'https://images.hive.blog/DQmDesigned/designed.jpg')
    expect(within(cards[0]).queryByRole('img')).toBeNull()
    // Each track card can go to the audio editor too
    await user.click(within(cards[0]).getByRole('button', { name: /Edit audio/ }))
    expect(opened.at(-1).name).toBe('one')
  })
})

describe('AudioUploadModal: songs from the editor', () => {
  it('credits a library song in the post and gives its 3Speak creator 5%', async () => {
    const blob = new File(['ID3'], 'Episode.mp3', { type: 'audio/mpeg' })
    const { user } = openModal({
      initialTrack: {
        blob, filename: 'Episode.mp3', type: null, source: 'editor',
        musicCredits: [{ id: 's1', title: 'Night Beat', source: '3speak', account: 'bob', sourceUrl: 'https://3speak.tv/audio/bob/beat' }],
      },
    })
    await waitFor(() => row('Episode.mp3'))
    await toPostStep(user, 'Show A')
    await next(user) // review
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(aioha.broadcastWithAioha).toHaveBeenCalled())
    const ops = aioha.broadcastWithAioha.mock.calls.map(([o]) => o).find((o) => o[0][0] === 'comment')
    const [, post] = ops[0]
    expect(post.body).toContain('![Episode](https://images.hive.blog/DQmA/a.jpg)')
    expect(post.body).toContain('*Sound: ["Night Beat"](https://3speak.tv/audio/bob/beat) by [@bob](https://3speak.tv/user/bob)*')
    const meta = JSON.parse(post.json_metadata)
    expect(meta.audio.sound).toMatchObject({ title: 'Night Beat', account: 'bob' })
    expect(meta.image).toEqual(['https://images.hive.blog/DQmA/a.jpg'])
    const options = ops.find((o) => o[0] === 'comment_options')[1]
    expect(options.extensions[0][1].beneficiaries).toEqual(expect.arrayContaining([{ account: 'bob', weight: 500 }]))
  })

  it('posts no credit line for an audio without library songs', async () => {
    const { user } = openModal()
    await addFile(user)
    await toPostStep(user, null)
    await next(user)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(aioha.broadcastWithAioha).toHaveBeenCalled())
    const ops = aioha.broadcastWithAioha.mock.calls.map(([o]) => o).find((o) => o[0][0] === 'comment')
    expect(ops[0][1].body).not.toContain('Sound:')
    expect(JSON.parse(ops[0][1].json_metadata).audio.sound).toBeUndefined()
  })
})
