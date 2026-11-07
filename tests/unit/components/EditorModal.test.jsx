// @vitest-environment jsdom
// The editor popup (components/modal/EditorModal.jsx) in its two modes. Audio
// mode opens the editor with ?mode=audio, loads the track it was opened for,
// refuses an editor that predates the audio mode, and hands the edited MP3 back:
// to the audio upload's track (audio-editor-result) or, from the share menu, to
// a new audio upload (open-audio-upload). The video path stays as it was.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia, toastMessages } from './_render.jsx'

const EDITOR = 'https://editor.test'
const m = vi.hoisted(() => ({ stories: false }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  getEditorUrl: async () => EDITOR,
  storiesEnabledFor: () => m.stories,
  cameraRecordEnabledFor: () => false,
  STT_WS_URL: '',
}))
vi.mock('../../../src/utils/videoThumbnails', () => ({ generateVideoThumbnailsAt: async () => [] }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/context/EmbedUploadContext', () => {
  const noop = () => {}
  return {
    useEmbedUpload: () => new Proxy({ pickFirstThumbnail: () => false }, { get: (t, k) => (k in t ? t[k] : noop) }),
  }
})

const { toast } = await import('sonner')
const { default: EditorModal } = await import('../../../src/components/modal/EditorModal.jsx')

let posted
let events
const listen = (e) => events.push(e)

beforeEach(() => {
  posted = []
  events = []
  m.stories = false
  stubMatchMedia(true)
  window.addEventListener('audio-editor-result', listen)
  window.addEventListener('open-audio-upload', listen)
})
afterEach(() => {
  window.removeEventListener('audio-editor-result', listen)
  window.removeEventListener('open-audio-upload', listen)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function open(props) {
  const onClose = vi.fn()
  const utils = renderWithProviders(<EditorModal isOpen onClose={onClose} {...props} />)
  const iframe = await waitFor(() => {
    const el = document.querySelector('iframe.editor-iframe')
    if (!el) throw new Error('no iframe yet')
    return el
  })
  vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation((msg) => posted.push(msg))
  return { ...utils, onClose, iframe }
}

// A message from the editor's origin, as the iframe would send it
const fromEditor = (data, origin = EDITOR) => act(async () => {
  window.dispatchEvent(new MessageEvent('message', { origin, data: { source: '3speak-editor', ...data } }))
})

const ready = (extra = {}) => fromEditor({ type: 'editor-ready', canSaveDrafts: false, canLoadFile: true, ...extra })

function stubMp3({ ok = true, type = 'audio/mpeg' } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 502,
    headers: { get: () => type },
    blob: async () => new Blob(['ID3 mp3 bytes'], { type }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('EditorModal in audio mode', () => {
  it('opens the editor with mode=audio and an audio title', async () => {
    const { iframe } = await open({ mode: 'audio' })
    expect(iframe.getAttribute('src')).toBe(`${EDITOR}?compact=true&mode=audio`)
    expect(iframe).toHaveAttribute('title', '3Speak Audio Editor')
  })

  it('loads the track it was opened for, as the File itself, once', async () => {
    const file = new File(['abc'], 'episode-12.wav', { type: 'audio/wav' })
    await open({ mode: 'audio', audioFile: file, audioTrackId: 't1' })
    await ready({ mode: 'audio', canEditAudio: true })
    await ready({ mode: 'audio', canEditAudio: true })
    const loads = posted.filter((p) => p.type === 'load-media')
    expect(loads).toHaveLength(1)
    expect(loads[0]).toMatchObject({ type: 'load-media', name: 'episode-12.wav', mediaType: 'audio' })
    expect(loads[0].file).toBe(file)
  })

  it('opens empty from the share menu', async () => {
    await open({ mode: 'audio' })
    await ready({ mode: 'audio', canEditAudio: true })
    expect(posted.filter((p) => p.type === 'load-media')).toHaveLength(0)
    expect(posted.some((p) => p.type === 'set-theme')).toBe(true)
  })

  it('says so and closes when the deployed editor has no audio mode yet', async () => {
    const { onClose } = await open({ mode: 'audio', audioFile: new File(['a'], 'a.mp3') })
    await ready()
    expect(onClose).toHaveBeenCalled()
    expect(toastMessages(toast.warning)).toContain('The audio editor is not available yet. Please try again later.')
    expect(toast.warning.mock.calls[0][0]).toBe('Audio')
    expect(posted.filter((p) => p.type === 'load-media')).toHaveLength(0)
  })

  it('ignores messages from any other origin', async () => {
    const file = new File(['abc'], 'x.mp3', { type: 'audio/mpeg' })
    await open({ mode: 'audio', audioFile: file })
    await fromEditor({ type: 'editor-ready', canEditAudio: true }, 'https://evil.example')
    expect(posted).toHaveLength(0)
  })

  it('hands the edited MP3 back to the audio upload track it came from', async () => {
    const fetchMock = stubMp3()
    const { onClose } = await open({ mode: 'audio', audioFile: new File(['a'], 'a.wav'), audioTrackId: 'track-7' })
    await ready({ canEditAudio: true })
    await fromEditor({
      type: 'post-to-3speak', mediaType: 'audio', outputUrl: `${EDITOR}/rendered/out.mp3`, fileName: 'My episode.mp3', durationSec: 61.5,
      musicCredits: [{ id: 'song1', title: 'Calm', artist: 'Kevin MacLeod', source: 'incompetech', license: 'CC BY 4.0' }, 'junk'],
      chapters: [{ start: 0, end: 30, title: 'Intro' }, { start: 30, end: 61.5, title: '**Questions**' }, 'junk'],
    })
    await waitFor(() => expect(events).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledWith(`${EDITOR}/rendered/out.mp3`)
    const [e] = events
    expect(e.type).toBe('audio-editor-result')
    expect(e.detail.trackId).toBe('track-7')
    expect(e.detail.durationSec).toBe(61.5)
    expect(e.detail.file).toBeInstanceOf(File)
    expect(e.detail.file.name).toBe('My episode.mp3')
    expect(e.detail.file.type).toBe('audio/mpeg')
    expect(e.detail.musicCredits).toEqual([expect.objectContaining({ title: 'Calm', artist: 'Kevin MacLeod' })])
    expect(e.detail.chapters).toEqual([{ start: 0, title: 'Intro' }, { start: 30, title: 'Questions' }])
    expect(onClose).toHaveBeenCalled()
    // Not the video path: no short/story chooser, no studio
    expect(screen.queryByText('Post it as')).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('opens a new audio upload with it when opened from the share menu', async () => {
    stubMp3()
    await open({ mode: 'audio' })
    await ready({ canEditAudio: true })
    await fromEditor({ type: 'post-to-3speak', mediaType: 'audio', outputUrl: `${EDITOR}/rendered/x.mp3`, fileName: '../evil/../name.wav', chapters: [{ start: 0, title: 'Intro' }] })
    await waitFor(() => expect(events).toHaveLength(1))
    const [e] = events
    expect(e.type).toBe('open-audio-upload')
    expect(e.detail).toMatchObject({ filename: 'edited-audio.mp3', type: null, source: 'editor', musicCredits: [], chapters: [{ start: 0, title: 'Intro' }] })
    expect(e.detail.blob).toBeInstanceOf(File)
    expect(e.detail.blob.type).toBe('audio/mpeg')
  })

  it('keeps the editor open with a message when the MP3 cannot be fetched', async () => {
    stubMp3({ ok: false })
    const { onClose } = await open({ mode: 'audio', audioTrackId: 't' })
    await ready({ canEditAudio: true })
    await fromEditor({ type: 'post-to-3speak', mediaType: 'audio', outputUrl: `${EDITOR}/rendered/x.mp3` })
    expect(await screen.findByText('Could not take over the edited audio. Please download it in the editor instead.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('refuses an HTML error page in place of the MP3', async () => {
    stubMp3({ type: 'text/html' })
    await open({ mode: 'audio', audioTrackId: 't' })
    await ready({ canEditAudio: true })
    await fromEditor({ type: 'post-to-3speak', mediaType: 'audio', outputUrl: `${EDITOR}/x` })
    expect(await screen.findByText(/Could not take over the edited audio/)).toBeInTheDocument()
    expect(events).toHaveLength(0)
  })
})

describe('EditorModal in video mode (unchanged)', () => {
  it('opens the shorts editor without a mode', async () => {
    const { iframe } = await open({})
    expect(iframe.getAttribute('src')).toBe(`${EDITOR}?compact=true`)
    expect(iframe).toHaveAttribute('title', '3Speak Video Editor')
  })

  it('loads the uploader video as a video, whatever the editor says about audio', async () => {
    const file = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
    await open({ videoFile: file })
    await ready()
    expect(posted.find((p) => p.type === 'load-media')).toMatchObject({ mediaType: 'video', file })
  })

  it('still offers story or short for a rendered video', async () => {
    m.stories = true
    stubMp3()
    await open({})
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4` })
    expect(await screen.findByText('Post it as')).toBeInTheDocument()
    expect(events).toHaveLength(0)
  })
})
