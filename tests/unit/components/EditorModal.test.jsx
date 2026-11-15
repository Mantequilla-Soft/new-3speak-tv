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
const m = vi.hoisted(() => ({ stories: false, embed: [], stt: false }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  getEditorUrl: async () => EDITOR,
  storiesEnabledFor: () => m.stories,
  cameraRecordEnabledFor: () => false,
  get STT_WS_URL() { return m.stt ? 'wss://stt.test/stt' : '' },
  sttEnabledFor: () => m.stt,
}))
vi.mock('../../../src/utils/videoThumbnails', () => ({ generateVideoThumbnailsAt: async () => [] }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/context/EmbedUploadContext', () => {
  const noop = () => {}
  return {
    // every setter call is recorded (m.embed: [name, ...args])
    useEmbedUpload: () => new Proxy({ pickFirstThumbnail: () => false }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('set') ? (...args) => m.embed.push([k, ...args]) : noop)) }),
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
  m.embed = []
  m.stt = false
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
  // The iframe shows on render, but the component's message listener is added
  // in an effect after it. Let React run its pending effects first, or an
  // "editor-ready" sent at once can land before anyone listens (a flake under
  // load in CI, 2026-11-12).
  await act(async () => {})
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

  it('keeps where in the episode each audiogram starts (the podcast feed\'s soundbites)', async () => {
    stubMp3()
    await open({ mode: 'audio', audioFile: new File(['a'], 'a.wav'), audioTrackId: 'track-7' })
    await ready({ canEditAudio: true })
    const url = `${EDITOR}/rendered/audiogram-1f2e3d4c-aaaa-bbbb-cccc-123456789abc.mp4`
    // exactly what the editor's audiogramsToPost sends
    await fromEditor({
      type: 'post-to-3speak', mediaType: 'audio', outputUrl: `${EDITOR}/rendered/out.mp3`, fileName: 'Ep.mp3', durationSec: 600,
      audiograms: [{ url, description: 'Best bit', title: 'Teaser', duration: 42.5, start: 73, width: 1080, height: 1920 }],
    })
    await waitFor(() => expect(events).toHaveLength(1))
    expect(events[0].detail.audiograms).toEqual([{ url, description: 'Best bit', title: 'Teaser', duration: 42.5, start: 73 }])
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

describe('EditorModal: a Short\'s text in our post editor (edit-text)', () => {
  it('opens our editor with the text, says it is open, and hands the new text back on Done', async () => {
    const { user } = await open({ mode: 'audio' })
    await ready({ mode: 'audio', canEditAudio: true })
    await fromEditor({ type: 'edit-text', requestId: 'r1', value: 'Old text', maxLength: 5000 })
    const dialog = await screen.findByRole('dialog', { name: 'Text for the Short' })
    expect(posted).toContainEqual({ type: 'text-edit-open', requestId: 'r1' })
    const box = dialog.querySelector('textarea')
    expect(box).toHaveValue('Old text')
    await user.clear(box)
    await user.type(box, 'New **text**')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(posted).toContainEqual({ type: 'text-edited', requestId: 'r1', value: 'New **text**' })
    expect(screen.queryByRole('dialog', { name: 'Text for the Short' })).toBeNull()
  })

  it('Cancel leaves the text as it was', async () => {
    const { user } = await open({ mode: 'audio' })
    await fromEditor({ type: 'edit-text', requestId: 'r2', value: 'Keep me' })
    await screen.findByRole('dialog', { name: 'Text for the Short' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(posted).toContainEqual({ type: 'text-edit-cancelled', requestId: 'r2' })
    expect(posted.some((p) => p.type === 'text-edited')).toBe(false)
  })

  it('ignores a request without an id, and from another origin', async () => {
    await open({ mode: 'audio' })
    await fromEditor({ type: 'edit-text', value: 'x' })
    await fromEditor({ type: 'edit-text', requestId: 'r3', value: 'x' }, 'https://evil.test')
    expect(screen.queryByRole('dialog', { name: 'Text for the Short' })).toBeNull()
    expect(posted.some((p) => p.type === 'text-edit-open')).toBe(false)
  })
})

describe('EditorModal: a remix draft opened again', () => {
  const calls = (name) => m.embed.filter((c) => c[0] === name).map((c) => c.slice(1))
  // jsdom reads no media: a video reports its metadata as soon as it gets a src
  let savedSrc
  beforeEach(() => {
    const proto = HTMLMediaElement.prototype
    savedSrc = Object.getOwnPropertyDescriptor(proto, 'src')
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get() { return this.getAttribute('src') || '' },
      set(v) { this.setAttribute('src', v); queueMicrotask(() => this.onloadedmetadata?.()) },
    })
  })
  afterEach(() => {
    const proto = HTMLMediaElement.prototype
    if (savedSrc) Object.defineProperty(proto, 'src', savedSrc); else delete proto.src
  })

  it('posts under the original the editor names when it was not opened from the remix button', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({})
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, remixSource: { parentAuthor: 'Bob', parentPermlink: 'orig' } })
    await waitFor(() => expect(calls('setRemixChain')).toHaveLength(1))
    expect(calls('setOriginalAuthor')).toEqual([['bob']])
    expect(calls('setOriginalPermlink')).toEqual([['orig']])
    expect(calls('setRemixChain')[0][0]).toEqual([{ author: 'bob', permlink: 'orig' }])
    // the original's creator gets the remix share
    expect(calls('setList')[0][0].map((b) => b.account)).toContain('bob')
  })

  it('the remix button\'s own original wins; nonsense from the editor is ignored', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({ originalAuthor: 'carol', originalPermlink: 'first' })
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, remixSource: { parentAuthor: 'bob', parentPermlink: 'orig' } })
    await waitFor(() => expect(calls('setRemixChain')).toHaveLength(1))
    expect(calls('setOriginalAuthor')).toEqual([['carol']])
    m.embed = []
    await open({})
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, remixSource: { parentAuthor: '<b>', parentPermlink: '../x' } })
    await waitFor(() => expect(calls('setRemixChain')).toHaveLength(1))
    expect(calls('setOriginalAuthor')).toEqual([])
    expect(calls('setRemixChain')[0][0]).toEqual([])
  })
})

describe('EditorModal: a Short made with "Use this sound"', () => {
  const calls = (name) => m.embed.filter((c) => c[0] === name).map((c) => c.slice(1))
  const SOUND = {
    url: 'https://play.test/hls?u=480',
    name: 'My beat',
    credit: { id: 'short_badadib_beat-1', title: 'My beat', artist: '@badadib', source: '3speak', account: 'badadib', sourceUrl: 'https://3speak.tv/sound/short_badadib_beat-1' },
  }
  let savedSrc
  beforeEach(() => {
    const proto = HTMLMediaElement.prototype
    savedSrc = Object.getOwnPropertyDescriptor(proto, 'src')
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get() { return this.getAttribute('src') || '' },
      set(v) { this.setAttribute('src', v); queueMicrotask(() => this.onloadedmetadata?.()) },
    })
  })
  afterEach(() => {
    const proto = HTMLMediaElement.prototype
    if (savedSrc) Object.defineProperty(proto, 'src', savedSrc); else delete proto.src
  })

  it('loads the sound on the music track with its credit, once, into an editor that says canLoadSound', async () => {
    await open({ sound: SOUND })
    await ready({ canLoadSound: true })
    await ready({ canLoadSound: true })
    const loads = posted.filter((p) => p.type === 'load-media')
    expect(loads).toEqual([{ type: 'load-media', url: SOUND.url, name: 'My beat', mediaType: 'audio', music: true, credit: SOUND.credit }])
  })

  it('an editor that does not say canLoadSound gets no sound, says so, and nothing is credited', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({ sound: SOUND })
    await ready()
    expect(posted.filter((p) => p.type === 'load-media')).toHaveLength(0)
    expect(toastMessages(toast.warning)).toContain("The sound could not be added to the editor yet. Add music from the editor's music library instead.")
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, musicCredits: [{ id: 'calm', title: 'Calm', artist: 'Kevin MacLeod', source: 'incompetech' }] })
    await waitFor(() => expect(calls('setMusicCredits')).toHaveLength(1))
    expect(calls('setMusicCredits')[0][0].map((c) => c.id)).toEqual(['calm'])
  })

  it('the sound still on the timeline is credited first, and its creator gets the 5% split', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({ sound: SOUND })
    await ready({ canLoadSound: true })
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, musicCredits: [{ id: 'calm', title: 'Calm', artist: 'Kevin MacLeod', source: 'incompetech' }, SOUND.credit] })
    await waitFor(() => expect(calls('setMusicCredits')).toHaveLength(1))
    expect(calls('setMusicCredits')[0][0].map((c) => c.id)).toEqual(['short_badadib_beat-1', 'calm'])
    expect(calls('setList')[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ account: 'badadib', percent: 5 })]))
  })

  it('an editor that keeps credits (canLoadSound) is trusted: a sound taken off the timeline is not credited', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({ sound: SOUND })
    await ready({ canLoadSound: true })
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, musicCredits: [] })
    await waitFor(() => expect(calls('setMusicCredits')).toHaveLength(1))
    expect(calls('setMusicCredits')[0][0]).toEqual([])
  })
})

describe('EditorModal: the editor\'s auto captions become the Short\'s subtitles', () => {
  const calls = (name) => m.embed.filter((c) => c[0] === name).map((c) => c.slice(1))
  const SUBS = {
    language: 'de', vttUrl: `${EDITOR}/rendered/j.vtt`, srtUrl: `${EDITOR}/rendered/j.srt`, burnedIn: true,
    cues: [{ start: 0, end: 1.2, text: 'Hallo badadib Fans' }, { start: 1.2, end: 2, text: 'Los geht es' }],
  }
  // jsdom loads no media: the duration probe of the rendered video answers at once
  let savedSrc
  beforeEach(() => {
    const proto = HTMLMediaElement.prototype
    savedSrc = Object.getOwnPropertyDescriptor(proto, 'src')
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get() { return this.getAttribute('src') || '' },
      set(v) { this.setAttribute('src', v); queueMicrotask(() => this.onloadedmetadata?.()) },
    })
  })
  afterEach(() => {
    const proto = HTMLMediaElement.prototype
    if (savedSrc) Object.defineProperty(proto, 'src', savedSrc); else delete proto.src
  })

  it('hands the checked captions to the publish step', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({})
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, subtitles: SUBS })
    await waitFor(() => expect(calls('setEditorSubtitles')).toHaveLength(1))
    expect(calls('setEditorSubtitles')[0][0]).toEqual({ language: 'de', cues: SUBS.cues, burnedIn: true })
  })

  it('through the short-or-story choice too; none sent = none kept', async () => {
    m.stories = true
    stubMp3({ type: 'video/mp4' })
    await open({})
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, subtitles: { ...SUBS, burnedIn: false } })
    const asShort = (await screen.findByText('Stays on your channel')).closest('button')
    await act(async () => { asShort.click() })
    await waitFor(() => expect(calls('setEditorSubtitles')).toHaveLength(1))
    expect(calls('setEditorSubtitles')[0][0]).toMatchObject({ language: 'de', burnedIn: false })
  })

  it('an editor without captions: nothing to save', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({})
    await ready()
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4` })
    await waitFor(() => expect(calls('setEditorSubtitles')).toHaveLength(1))
    expect(calls('setEditorSubtitles')[0][0]).toBeNull()
  })
})

describe('EditorModal: speech-to-text for the editor teleprompter', () => {
  function stubSttFetch() {
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes('stt-langs') ? { models: ['en-us'] } : { token: '99.sig' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('hands the editor the server, a fresh token and the languages, for any user', async () => {
    m.stt = true
    const fetchMock = stubSttFetch()
    await open({ mode: 'audio' })
    await fromEditor({ type: 'stt-config-request', requestId: 's1' })
    await waitFor(() => expect(posted.find((p) => p.type === 'stt-config')).toBeTruthy())
    expect(posted.find((p) => p.type === 'stt-config')).toMatchObject({ requestId: 's1', url: 'wss://stt.test/stt', token: '99.sig', models: ['en-us'] })
    expect(fetchMock).toHaveBeenCalledWith('/api/stt-token', expect.anything())
  })

  it('answers with an empty url where no server is set', async () => {
    const fetchMock = stubSttFetch()
    await open({ mode: 'audio' })
    await fromEditor({ type: 'stt-config-request', requestId: 's2' })
    await waitFor(() => expect(posted.find((p) => p.type === 'stt-config')).toBeTruthy())
    expect(posted.find((p) => p.type === 'stt-config')).toMatchObject({ requestId: 's2', url: '', token: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('EditorModal: the shape the editor reports decides Short or normal video', () => {
  const calls = (name) => m.embed.filter((c) => c[0] === name).map((c) => c.slice(1))
  // jsdom loads no media: the duration probe of the rendered video answers at once
  let savedSrc
  beforeEach(() => {
    const proto = HTMLMediaElement.prototype
    savedSrc = Object.getOwnPropertyDescriptor(proto, 'src')
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get() { return this.getAttribute('src') || '' },
      set(v) { this.setAttribute('src', v); queueMicrotask(() => this.onloadedmetadata?.()) },
    })
  })
  afterEach(() => {
    const proto = HTMLMediaElement.prototype
    if (savedSrc) Object.defineProperty(proto, 'src', savedSrc); else delete proto.src
  })

  it('opens a landscape project with ?aspect=, and nothing for a Short or a made-up shape', async () => {
    const { iframe } = await open({ aspect: '16:9' })
    expect(iframe.getAttribute('src')).toBe(`${EDITOR}?compact=true&aspect=16%3A9`)
  })

  it('a made-up shape opens the editor as before', async () => {
    const { iframe } = await open({ aspect: '21:9' })
    expect(iframe.getAttribute('src')).toBe(`${EDITOR}?compact=true`)
  })

  it('a 16:9 render goes to the normal video uploader, with no story question', async () => {
    m.stories = true
    stubMp3({ type: 'video/mp4' })
    await open({ aspect: '16:9' })
    await ready({ canFormat: true })
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, format: { aspect: '16:9', short: false, durationSec: 300 } })
    await waitFor(() => expect(calls('setFromStories')).toEqual([[false]]))
    expect(screen.queryByText('Post it as')).toBeNull()
    expect(calls('setVideoMode')).toEqual([['longform']])
    expect(calls('setIsStory')).toEqual([[false]])
    expect(calls('setVideoFile')[0][0].name).toBe('edited-video.mp4')
  })

  it('a 9:16 render from a format-aware editor is still a Short', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({})
    await ready({ canFormat: true })
    await fromEditor({ type: 'post-to-3speak', outputUrl: `${EDITOR}/rendered/v.mp4`, format: { aspect: '9:16', short: true } })
    await waitFor(() => expect(calls('setFromStories')).toEqual([[true]]))
    expect(calls('setVideoMode')).toEqual([])
  })

  it('the audio editor\'s video podcast is posted as a normal video with its title and chapters', async () => {
    stubMp3({ type: 'video/mp4' })
    await open({ mode: 'audio' })
    await ready({ mode: 'audio', canEditAudio: true, canVideoPodcast: true })
    await fromEditor({
      type: 'post-to-3speak', mediaType: 'video', outputUrl: `${EDITOR}/rendered/video-podcast-1.mp4`, durationSec: 3600,
      format: { aspect: '16:9', short: false }, title: 'Episode 12',
      chapters: [{ start: 0, end: 600, title: 'Intro' }, { start: 600, end: 3600, title: 'The talk' }],
    })
    await waitFor(() => expect(calls('setFromStories')).toEqual([[false]]))
    expect(events).toHaveLength(0) // not handed to the audio upload
    expect(calls('setTitle')).toEqual([['Episode 12']])
    expect(calls('setChapters')[0][0].map(({ start, title }) => ({ start, title }))).toEqual([{ start: 0, title: 'Intro' }, { start: 600, title: 'The talk' }])
  })
})
