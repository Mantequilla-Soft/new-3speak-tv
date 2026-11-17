// @vitest-environment jsdom
// Transcripts (src/utils/transcribe.js): the file is decoded in the browser,
// streamed to the speech-to-text server paced just under its speed, and the
// server's "final" phrases become sentences and paragraphs under the post text.
// The decoder, the WebSocket and the token fetch are fakes here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ EMBED_API_KEY: 'embed-key', STT_WS_URL: 'wss://stt.test/stt' }))

const T = await import('../../../src/utils/transcribe.js')

// A fake server: answers every binary frame with a partial, and says "final"
// with the next scripted phrase whenever a frame of silence arrives
let sockets
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.bufferedAmount = 0
    this.sent = []
    this.phrases = [...(FakeSocket.phrases || [])]
    this.heard = false
    sockets.push(this)
    setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
  }

  send(data) {
    this.sent.push(data)
    if (typeof data === 'string') {
      if (FakeSocket.knowsEof && JSON.parse(data).type === 'eof') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done' }) }), 0)
      return
    }
    const pcm = new Int16Array(data)
    const silent = pcm.every((v) => v === 0)
    if (FakeSocket.dropAfter && this.sent.length > FakeSocket.dropAfter) {
      FakeSocket.dropAfter = 0
      this.readyState = 3
      setTimeout(() => this.onclose?.({ code: 1011 }), 0)
      return
    }
    if (!silent) {
      this.heard = true
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'partial', text: 'some words' }) }), 0)
    } else if (this.heard && this.phrases.length) {
      this.heard = false
      const text = this.phrases.shift()
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'final', text }) }), 0)
    }
  }

  close() {
    this.readyState = 3
  }
}

const tone = (n, v = 1000) => Int16Array.from({ length: n }, () => v)

beforeEach(() => {
  sockets = []
  FakeSocket.phrases = []
  FakeSocket.dropAfter = 0
  FakeSocket.knowsEof = false
  globalThis.fetch = vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('stt-langs') ? { models: ['en-us'] } : { token: '123.abc' }),
  }))
})
afterEach(() => {
  delete window.OfflineAudioContext
})

describe('text', () => {
  it('turns a raw phrase into a sentence and drops noise', () => {
    expect(T.sentence('  so i think   three speak is great ')).toBe('So I think 3Speak is great.')
    expect(T.sentence("i'm here and i've seen it")).toBe("I'm here and I've seen it.")
    expect(T.sentence('the')).toBe('')
    expect(T.sentence('um')).toBe('')
    expect(T.sentence('')).toBe('')
    expect(T.sentence('yes')).toBe('Yes.')
  })

  it('groups sentences into paragraphs of about seventy words', () => {
    const long = `${'word '.repeat(39)}end.`
    const paras = T.paragraphs([long, long, 'Short one.', ''])
    expect(paras).toHaveLength(2)
    expect(paras[0]).toBe(`${long} ${long}`)
    expect(paras[1]).toBe('Short one.')
  })

  it('makes the block with a heading and cuts it at a paragraph to fit', () => {
    expect(T.transcriptBlock([], 'Transcript')).toEqual({ text: '', shortened: false })
    expect(T.transcriptBlock(['One.', 'Two.'], 'Transcript')).toEqual({ text: '**Transcript**\n\nOne.\n\nTwo.', shortened: false })
    const cut = T.transcriptBlock(['a'.repeat(30), 'b'.repeat(30)], 'T', 50)
    expect(cut.shortened).toBe(true)
    expect(cut.text).toBe(`**T**\n\n${'a'.repeat(30)}\n\n…`)
  })

  it('puts the transcript under the text, and replaces an earlier one in place', () => {
    expect(T.withTranscript('', '', '**T**\n\nHi.')).toBe('**T**\n\nHi.')
    expect(T.withTranscript('My episode', '', '**T**\n\nHi.')).toBe('My episode\n\n**T**\n\nHi.')
    const first = T.withTranscript('My episode', '', '**T**\n\nOld.')
    expect(T.withTranscript(`${first}\n\nFollow me!`, '**T**\n\nOld.', '**T**\n\nNew.')).toBe('My episode\n\n**T**\n\nNew.\n\nFollow me!')
    // the creator deleted the old one: the new one goes under the text
    expect(T.withTranscript('Edited', '**T**\n\nOld.', '**T**\n\nNew.')).toBe('Edited\n\n**T**\n\nNew.')
  })
})

describe('decoding', () => {
  it('knows MP3s by type or name and measures an ID3 tag', () => {
    expect(T.isMp3({ type: 'audio/mpeg' })).toBe(true)
    expect(T.isMp3({ type: '' }, 'show.MP3')).toBe(true)
    expect(T.isMp3({ type: 'audio/webm' }, 'rec.webm')).toBe(false)
    // "ID3", version, flags, syncsafe size 0x0101 = 129
    expect(T.id3Size(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 1, 1]))).toBe(10 + 129)
    expect(T.id3Size(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 5]))).toBe(10 + 5 + 10)
    expect(T.id3Size(Uint8Array.from([0xff, 0xfb, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0)
  })

  it('mixes channels down to 16-bit mono, clipping at full scale', () => {
    const buf = {
      length: 3,
      numberOfChannels: 2,
      getChannelData: (c) => (c === 0 ? Float32Array.from([0.5, 1, -1]) : Float32Array.from([0.5, 1, -0.5])),
    }
    expect(Array.from(T.toPcm16(buf))).toEqual([16384, 32767, -24575])
  })

  it('decodes a big MP3 slice by slice after its tag, and skips a slice that fails', async () => {
    const calls = []
    window.OfflineAudioContext = class {
      constructor(ch, len, rate) { expect(rate).toBe(16000) }
      decodeAudioData(ab) {
        calls.push(ab.byteLength)
        if (calls.length === 2) return Promise.reject(new Error('bad slice'))
        return Promise.resolve({ length: 4, numberOfChannels: 1, getChannelData: () => Float32Array.from([0.1, 0.1, 0.1, 0.1]) })
      }
    }
    const tag = new Uint8Array(10 + 100)
    tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 100])
    const body = new Uint8Array(5 * 1024 * 1024)
    const blob = new Blob([tag, body], { type: 'audio/mpeg' })
    const pieces = []
    for await (const p of T.decodePieces(blob)) pieces.push(p)
    expect(calls).toEqual([2 * 1024 * 1024, 2 * 1024 * 1024, 1024 * 1024])
    expect(pieces).toHaveLength(2)
  })
})

describe('streaming', () => {
  it('sends start, the audio and a silent tail, and returns the finals once the server goes quiet', async () => {
    FakeSocket.phrases = ['hello there']
    const sent = []
    const finals = await T.runSession({
      pcm: tone(16000), url: 'wss://stt.test/stt', lang: 'en-US', token: 't0k',
      WebSocketImpl: FakeSocket, idleMs: 60, onSent: (n) => sent.push(n),
    })
    expect(finals).toEqual(['hello there'])
    const ws = sockets[0]
    expect(ws.url).toBe('wss://stt.test/stt?lang=en-US&token=t0k')
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'start', lang: 'en-US' })
    const samples = ws.sent.filter((b) => typeof b !== 'string').reduce((n, b) => n + b.byteLength / 2, 0)
    expect(JSON.parse(ws.sent.at(-1))).toEqual({ type: 'eof' })
    expect(samples).toBe(16000 + 24000) // the audio + 1.5 s of silence
    expect(sent.at(-1)).toBe(16000)
  })

  it('says eof at the end, and a server that answers done ends the session at once', async () => {
    FakeSocket.knowsEof = true
    FakeSocket.phrases = ['quick one']
    const t0 = Date.now()
    const finals = await T.runSession({ pcm: tone(1600), url: 'wss://x/stt', lang: 'en-US', WebSocketImpl: FakeSocket, idleMs: 5000 })
    expect(finals).toEqual(['quick one'])
    expect(JSON.parse(sockets[0].sent.at(-1))).toEqual({ type: 'eof' })
    expect(Date.now() - t0).toBeLessThan(2000) // not the 5 s idle wait
  })

  it('paces the audio at ten times real time', async () => {
    const t0 = Date.now()
    await T.runSession({ pcm: tone(16000 * 2), url: 'wss://x/stt', lang: 'en-US', WebSocketImpl: FakeSocket, idleMs: 20 })
    // 2 s of audio + 1.5 s of tail at 10x: about 350 ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250)
  })

  it('keeps a trailing partial the server never closed', async () => {
    const finals = await T.runSession({ pcm: tone(1600), url: 'wss://x/stt', lang: 'en-US', WebSocketImpl: FakeSocket, idleMs: 40 })
    expect(finals).toEqual(['some words'])
  })

  it('stops on abort', async () => {
    const ctrl = new AbortController()
    const p = T.runSession({ pcm: tone(16000 * 5), url: 'wss://x/stt', lang: 'en-US', WebSocketImpl: FakeSocket, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 30)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('transcribe(): decodes, streams with a fresh token and hands back sentences', async () => {
    window.OfflineAudioContext = class {
      decodeAudioData() {
        return Promise.resolve({ length: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(8000).fill(0.2) })
      }
    }
    FakeSocket.phrases = ['welcome to the show']
    const progress = []
    const out = await T.transcribe(new Blob([new Uint8Array(100)], { type: 'audio/webm' }), {
      durationSec: 0.5, WebSocketImpl: FakeSocket, idleMs: 40, onProgress: (p) => progress.push(p),
    })
    expect(out).toEqual(['Welcome to the show.'])
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/stt-token', expect.anything())
    expect(sockets[0].url).toContain('token=123.abc')
    expect(progress[0].phase).toBe('decoding')
    expect(progress.some((p) => p.phase === 'listening')).toBe(true)
    expect(Math.max(...progress.map((p) => p.done))).toBeLessThan(1)
  })

  it('transcribe(): goes on after a dropped connection, keeping what came back', async () => {
    window.OfflineAudioContext = class {
      decodeAudioData() {
        return Promise.resolve({ length: 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(16000).fill(0.2) })
      }
    }
    FakeSocket.dropAfter = 3
    FakeSocket.phrases = ['second try']
    const out = await T.transcribe(new Blob([new Uint8Array(100)], { type: 'audio/webm' }), {
      durationSec: 1, WebSocketImpl: FakeSocket, idleMs: 40,
    })
    expect(sockets.length).toBe(2)
    expect(out).toEqual(['Second try.'])
  }, 10000)

  it('lists the server languages as tags', async () => {
    expect(await T.transcriptLanguages()).toEqual(['en-US'])
    expect(await T.liveLanguages()).toEqual(['en-US'])
  })
})

// A fake Whisper socket (/transcribe): takes the audio in, says how far it got
// once a second of audio has come, and answers eof with the rest and done
class FakeWhisper {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.bufferedAmount = 0
    this.sent = []
    this.samples = 0
    this.texts = [...(FakeWhisper.texts || [])]
    sockets.push(this)
    setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
  }

  say(msg) { setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0) }

  send(data) {
    this.sent.push(data)
    if (typeof data === 'string') {
      if (JSON.parse(data).type === 'eof') {
        this.texts.forEach((text) => this.say({ type: 'final', text }))
        this.say({ type: 'progress', sec: this.samples / 16000 })
        this.say({ type: 'done' })
      }
      return
    }
    this.samples += data.byteLength / 2
    if (FakeWhisper.dropAt && this.samples >= FakeWhisper.dropAt) {
      FakeWhisper.dropAt = 0
      this.say({ type: 'final', text: 'First part.' })
      this.say({ type: 'progress', sec: 0.5 })
      setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1011 }) }, 5)
    }
  }

  close() { this.readyState = 3 }
}

const decoder = (n) => class {
  decodeAudioData() {
    return Promise.resolve({ length: n, numberOfChannels: 1, getChannelData: () => new Float32Array(n).fill(0.2) })
  }
}

describe('Whisper', () => {
  beforeEach(() => { FakeWhisper.texts = []; FakeWhisper.dropAt = 0 })

  it('keeps its punctuation, and splits its stretches of speech at the sentence ends', () => {
    expect(T.whisperSentences(['Hello there. This is', 'the show! Is it?', '  ', '大家好。欢迎'])).toEqual([
      'Hello there.', 'This is the show!', 'Is it?', '大家好。', '欢迎',
    ])
  })

  it('reports how far the server says it recognized, and a drop carries it', async () => {
    const heard = []
    FakeWhisper.dropAt = 16000
    const err = await T.runSession({
      pcm: tone(32000), url: 'wss://x/transcribe', lang: 'de-DE', WebSocketImpl: FakeWhisper, idleMs: 5000, onHeard: (n) => heard.push(n),
    }).catch((e) => e)
    expect(heard).toEqual([8000])
    expect(err).toMatchObject({ code: 'connection', heard: 8000, finals: ['First part.'] })
  })

  it('transcribe(): Whisper sentences, the progress follows recognition, and a drop goes on from what was recognized', async () => {
    window.OfflineAudioContext = decoder(32000)
    FakeWhisper.texts = ['Second part, with commas.']
    FakeWhisper.dropAt = 16000
    const progress = []
    const out = await T.transcribe(new Blob([new Uint8Array(100)], { type: 'audio/webm' }), {
      durationSec: 2, url: 'wss://x/transcribe', engine: 'whisper', WebSocketImpl: FakeWhisper, idleMs: 5000,
      onProgress: (p) => progress.push(p),
    })
    expect(out).toEqual(['First part.', 'Second part, with commas.'])
    expect(sockets).toHaveLength(2)
    // the second session starts at the half second Whisper had recognized
    // (the silent tail starts at the next whole frame: 1600 samples less)
    const audio = sockets[1].sent.filter((b) => typeof b !== 'string').reduce((n, b) => n + b.byteLength / 2, 0)
    expect(audio).toBe(32000 - 8000 + 24000 - 1600)
    const listening = progress.filter((p) => p.phase === 'listening').map((p) => p.done)
    expect(listening[0]).toBeCloseTo(0.25, 2)
  }, 10000)
})

describe('speech server offers', () => {
  it('passes the stream captions offer (/live) beside the transcripts one', async () => {
    vi.resetModules()
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: ['en-us'], transcribe: null, live: { engine: 'whisper', langs: ['en', 'de'] } }),
    }))
    const W = await import('../../../src/utils/transcribe.js')
    const info = await W.speechInfo()
    expect(info.live).toEqual({ engine: 'whisper', langs: ['en', 'de'] })
    expect(info.transcribe).toBeNull()
  })

  it('uses Whisper on /transcribe when the server has it, for the site languages; the teleprompter keeps the live models', async () => {
    vi.resetModules()
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes('stt-langs')
        ? { models: ['en-us', 'de'], transcribe: { engine: 'whisper', langs: ['en', 'de', 'tl'] } }
        : { token: '123.abc' }),
    }))
    const W = await import('../../../src/utils/transcribe.js')
    expect(await W.transcriptLanguages()).toEqual(['en-US', 'de-DE', 'fil-PH'])
    expect(await W.liveLanguages()).toEqual(['en-US', 'de-DE'])
    window.OfflineAudioContext = decoder(8000)
    FakeWhisper.texts = ['Hallo zusammen.']
    const out = await W.transcribe(new Blob([new Uint8Array(100)], { type: 'audio/webm' }), {
      lang: 'de-DE', durationSec: 0.5, WebSocketImpl: FakeWhisper, idleMs: 5000,
    })
    expect(sockets[0].url).toBe('wss://stt.test/transcribe?lang=de-DE&token=123.abc')
    expect(out).toEqual(['Hallo zusammen.'])
  })

  it('makes the transcript on the live socket when /transcribe never opens', async () => {
    vi.resetModules()
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes('stt-langs')
        ? { models: ['en-us'], transcribe: { engine: 'whisper', langs: ['en'] } }
        : { token: '123.abc' }),
    }))
    const W = await import('../../../src/utils/transcribe.js')
    window.OfflineAudioContext = decoder(8000)
    FakeSocket.phrases = ['plain words']
    class Router {
      constructor(url) {
        if (!url.includes('/transcribe')) return new FakeSocket(url)
        sockets.push(this)
        this.url = url
        setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1006 }) }, 0)
      }

      close() {}
    }
    const out = await W.transcribe(new Blob([new Uint8Array(100)], { type: 'audio/webm' }), {
      durationSec: 0.5, WebSocketImpl: Router, idleMs: 40,
    })
    expect(sockets.map((x) => new URL(x.url).pathname)).toEqual(['/transcribe', '/stt'])
    expect(out).toEqual(['Plain words.'])
  })
})
