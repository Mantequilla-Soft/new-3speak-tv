// createSttStream (src/utils/sttClient.js): the teleprompter's speech-to-text
// stream. It taps the recording's own audio track through Web Audio, mints a
// short-lived token, opens the WebSocket with lang + token, forwards the
// worklet's PCM frames, hands transcripts back and tears everything down on
// stop(). Web Audio, MediaStream, WebSocket and fetch are all fakes here.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ EMBED_API_KEY: 'embed-key' }))

const { createSttStream } = await import('../../../src/utils/sttClient.js')

let contexts
let sockets
let worklets
let addModule

class FakeAudioContext {
  constructor() {
    this.destination = { name: 'speakers' }
    this.audioWorklet = { addModule: (url) => addModule(url) }
    this.source = { connect: vi.fn(), disconnect: vi.fn() }
    this.close = vi.fn()
    contexts.push(this)
  }

  createMediaStreamSource(stream) {
    this.source.stream = stream
    return this.source
  }
}

class FakeWorkletNode {
  constructor(ctx, name, options) {
    Object.assign(this, { ctx, name, options })
    this.port = {}
    this.connect = vi.fn()
    this.disconnect = vi.fn()
    worklets.push(this)
  }
}

class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.close = vi.fn()
    sockets.push(this)
  }

  send(data) { this.sent.push(data) }
}

class FakeMediaStream {
  constructor(tracks) { this.tracks = tracks }
}

let fetchMock
beforeEach(() => {
  contexts = []
  sockets = []
  worklets = []
  addModule = vi.fn(async () => {})
  vi.stubGlobal('window', { AudioContext: FakeAudioContext })
  vi.stubGlobal('MediaStream', FakeMediaStream)
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
  vi.stubGlobal('WebSocket', FakeSocket)
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ token: '123.abc' }) }))
  vi.stubGlobal('fetch', fetchMock)
})

const track = { kind: 'audio', id: 'mic-1' }
const URL_ = 'wss://stt.example/stream'

// Start a stream and wait until its socket exists.
async function connected(opts = {}) {
  const onTranscript = vi.fn()
  const onStatus = vi.fn()
  const handle = createSttStream({ track, url: URL_, lang: 'de-DE', onTranscript, onStatus, ...opts })
  await vi.waitFor(() => expect(sockets).toHaveLength(1))
  return { handle, onTranscript, onStatus, ws: sockets[0], ctx: contexts[0], worklet: worklets[0] }
}

describe('createSttStream: setting up', () => {
  it.each([
    ['the browser has no Web Audio', () => vi.stubGlobal('window', {}), track],
    ['there is no track to listen to', () => {}, null],
  ])('reports "audio unavailable" when %s', async (_label, arrange, t) => {
    arrange()
    const onStatus = vi.fn()
    createSttStream({ track: t, url: URL_, onStatus })
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', 'audio unavailable'))
    expect(sockets).toHaveLength(0)
  })

  it('uses the prefixed webkitAudioContext on older Safari', async () => {
    vi.stubGlobal('window', { webkitAudioContext: FakeAudioContext })
    await connected()
    expect(contexts).toHaveLength(1)
  })

  it('taps the given track and downsamples it to 16 kHz in the worklet', async () => {
    const { ctx, worklet } = await connected()
    expect(addModule).toHaveBeenCalledWith('/stt-downsampler.js')
    expect(ctx.source.stream.tracks).toEqual([track])
    expect(worklet.name).toBe('stt-downsampler')
    expect(worklet.options).toEqual({ processorOptions: { targetRate: 16000 } })
    expect(ctx.source.connect).toHaveBeenCalledWith(worklet)
    expect(worklet.connect).toHaveBeenCalledWith(ctx.destination)
  })

  it('mints a token with the session cookie and API key and puts it on the socket URL', async () => {
    const { ws, onStatus } = await connected()
    expect(fetchMock).toHaveBeenCalledWith('/api/stt-token', { credentials: 'include', headers: { 'X-API-Key': 'embed-key' } })
    const url = new URL(ws.url)
    expect(url.origin + url.pathname).toBe(URL_)
    expect(url.searchParams.get('lang')).toBe('de-DE')
    expect(url.searchParams.get('token')).toBe('123.abc')
    expect(ws.binaryType).toBe('arraybuffer')
    expect(onStatus).toHaveBeenCalledWith('connecting', undefined)
  })

  it.each([
    ['refuses', async () => ({ ok: false, json: async () => ({}) })],
    ['is unreachable', async () => { throw new TypeError('Failed to fetch') }],
    ['answers without a token', async () => ({ ok: true, json: async () => ({}) })],
  ])('still connects, without a token, when the token endpoint %s', async (_label, impl) => {
    fetchMock.mockImplementation(impl)
    const { ws } = await connected()
    expect(new URL(ws.url).searchParams.has('token')).toBe(false)
  })

  it('defaults the language to en-US', async () => {
    const { ws } = await connected({ lang: undefined })
    expect(new URL(ws.url).searchParams.get('lang')).toBe('en-US')
    ws.onopen()
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'start', lang: 'en-US' })
  })

  it('reports a worklet that fails to load', async () => {
    addModule = vi.fn(async () => { throw new Error('AbortError: module failed') })
    const onStatus = vi.fn()
    createSttStream({ track, url: URL_, onStatus })
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', 'AbortError: module failed'))
  })

  it('reports a generic failure for an error without a message', async () => {
    addModule = vi.fn(async () => { throw {} })
    const onStatus = vi.fn()
    createSttStream({ track, url: URL_, onStatus })
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('error', 'stt init failed'))
  })
})

describe('createSttStream: talking to the server', () => {
  it('announces the language once the socket opens', async () => {
    const { ws, onStatus } = await connected()
    ws.onopen()
    expect(onStatus).toHaveBeenCalledWith('connected', undefined)
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'start', lang: 'de-DE' })
  })

  it.each([
    [{ type: 'partial', text: 'hello wor' }, ['hello wor', false]],
    [{ type: 'final', text: 'hello world' }, ['hello world', true]],
    [{ type: 'final' }, ['', true]],
  ])('passes %o on as a transcript', async (msg, args) => {
    const { ws, onTranscript } = await connected()
    ws.onmessage({ data: JSON.stringify(msg) })
    expect(onTranscript).toHaveBeenCalledWith(...args)
  })

  it.each([
    [{ type: 'error', message: 'quota exceeded' }, 'quota exceeded'],
    [{ type: 'error' }, 'server error'],
  ])('reports a server error message %o', async (msg, text) => {
    const { ws, onStatus, onTranscript } = await connected()
    ws.onmessage({ data: JSON.stringify(msg) })
    expect(onStatus).toHaveBeenCalledWith('error', text)
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('ignores frames that are not JSON or of an unknown type', async () => {
    const { ws, onStatus, onTranscript } = await connected()
    onStatus.mockClear()
    ws.onmessage({ data: 'ping' })
    ws.onmessage({ data: JSON.stringify({ type: 'stats' }) })
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('forwards PCM frames from the worklet only while the socket is open', async () => {
    const { ws, worklet } = await connected()
    const frame = new ArrayBuffer(640)
    worklet.port.onmessage({ data: frame })
    expect(ws.sent).toEqual([])
    ws.readyState = 1
    worklet.port.onmessage({ data: frame })
    expect(ws.sent).toEqual([frame])
  })

  it.each([
    [4401, 'unauthorized'],
    [1006, 'closed'],
  ])('reports a close with code %i as "%s"', async (code, text) => {
    const { ws, onStatus } = await connected()
    ws.onclose({ code })
    expect(onStatus).toHaveBeenLastCalledWith('error', text)
  })

  it('reports a socket error as a failed connection', async () => {
    const { ws, onStatus } = await connected()
    ws.onerror()
    expect(onStatus).toHaveBeenLastCalledWith('error', 'connection failed')
  })

  it('keeps working when the status callback throws', async () => {
    const onStatus = vi.fn(() => { throw new Error('ui gone') })
    const { ws, onTranscript } = await connected({ onStatus })
    ws.onopen()
    ws.onmessage({ data: JSON.stringify({ type: 'final', text: 'ok' }) })
    expect(onTranscript).toHaveBeenCalledWith('ok', true)
  })
})

describe('createSttStream: stop()', () => {
  it('closes the socket, the audio graph and the context', async () => {
    const { handle, ws, ctx, worklet } = await connected()
    handle.stop()
    expect(ws.close).toHaveBeenCalled()
    expect(ctx.source.disconnect).toHaveBeenCalled()
    expect(worklet.disconnect).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
  })

  it('does not report the close it caused itself', async () => {
    const { handle, ws, onStatus } = await connected()
    handle.stop()
    onStatus.mockClear()
    ws.onclose({ code: 1000 })
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('stopped while the worklet loads, closes the context and never connects', async () => {
    let finishLoading
    addModule = vi.fn(() => new Promise((r) => { finishLoading = r }))
    const handle = createSttStream({ track, url: URL_ })
    await vi.waitFor(() => expect(addModule).toHaveBeenCalled())
    handle.stop()
    finishLoading()
    await vi.waitFor(() => expect(contexts[0].close).toHaveBeenCalled())
    expect(worklets).toHaveLength(0)
    expect(sockets).toHaveLength(0)
  })

  it('stopped while the token is minted, never opens the socket', async () => {
    let answer
    fetchMock.mockImplementation(() => new Promise((r) => { answer = r }))
    const handle = createSttStream({ track, url: URL_ })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    handle.stop()
    answer({ ok: true, json: async () => ({ token: 't' }) })
    await vi.waitFor(() => expect(contexts[0].close).toHaveBeenCalledTimes(2))
    expect(sockets).toHaveLength(0)
  })

  it('is safe to call before anything was set up, and twice', () => {
    const handle = createSttStream({ track, url: URL_ })
    expect(() => { handle.stop(); handle.stop() }).not.toThrow()
  })
})
