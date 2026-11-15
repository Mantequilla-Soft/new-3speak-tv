// Live captions (H11): the studio's speech-to-text source keeps ONE session to
// the teleprompter's speech server open, reconnects when the server closes it
// (its session time limit), backs off, and gives up after a run of failures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLiveCaptionSource, captionLanguages, BACKOFF_MS, MAX_FAILS } from '../../../src/utils/liveCaptionSource'

function fakeConnect() {
  const sessions = []
  const connect = vi.fn((opts) => {
    const s = { opts, stop: vi.fn() }
    sessions.push(s)
    return s
  })
  return { connect, sessions }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createLiveCaptionSource', () => {
  it('opens one session on the track with the language and passes text through', () => {
    const { connect, sessions } = fakeConnect()
    const onText = vi.fn()
    const onStatus = vi.fn()
    const track = { id: 'mic' }
    createLiveCaptionSource({ url: 'wss://stt.example/stt', connect })(track, { lang: 'en-us', onText, onStatus })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(sessions[0].opts).toMatchObject({ track, url: 'wss://stt.example/stt', lang: 'en-us' })
    sessions[0].opts.onStatus('connected')
    sessions[0].opts.onTranscript('hello there', false)
    sessions[0].opts.onTranscript('hello there', true)
    expect(onStatus).toHaveBeenCalledWith('connected', undefined)
    expect(onText.mock.calls).toEqual([['hello there', false], ['hello there', true]])
  })

  it('reconnects after the server closes the session, once per close', () => {
    const { connect, sessions } = fakeConnect()
    createLiveCaptionSource({ url: 'wss://x', connect })({}, { lang: 'en-us', onText: vi.fn() })
    // The time limit: an error message, then the socket close. One reconnect.
    sessions[0].opts.onStatus('error', 'session time limit reached')
    sessions[0].opts.onStatus('error', 'closed')
    expect(sessions[0].stop).toHaveBeenCalled()
    vi.advanceTimersByTime(BACKOFF_MS[0])
    expect(connect).toHaveBeenCalledTimes(2)
    // Late text from the closed session is dropped.
    const onText = vi.fn()
    expect(() => sessions[0].opts.onTranscript('late', true)).not.toThrow()
    expect(onText).not.toHaveBeenCalled()
  })

  it('backs off on repeated failures and gives up after MAX_FAILS without any text', () => {
    const { connect, sessions } = fakeConnect()
    const onStatus = vi.fn()
    createLiveCaptionSource({ url: 'wss://x', connect })({}, { lang: 'en-us', onText: vi.fn(), onStatus })
    for (let i = 0; i < MAX_FAILS - 1; i += 1) {
      sessions[i].opts.onStatus('error', 'closed')
      vi.advanceTimersByTime(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)])
    }
    expect(connect).toHaveBeenCalledTimes(MAX_FAILS)
    sessions[MAX_FAILS - 1].opts.onStatus('error', 'connection failed')
    expect(onStatus).toHaveBeenLastCalledWith('error', 'connection failed')
    vi.advanceTimersByTime(60000)
    expect(connect).toHaveBeenCalledTimes(MAX_FAILS)
  })

  it('words in between reset the failure count', () => {
    const { connect, sessions } = fakeConnect()
    const onStatus = vi.fn()
    createLiveCaptionSource({ url: 'wss://x', connect })({}, { lang: 'en-us', onText: vi.fn(), onStatus })
    for (let i = 0; i < MAX_FAILS + 3; i += 1) {
      sessions[i].opts.onTranscript('still talking', true)
      sessions[i].opts.onStatus('error', 'closed')
      vi.advanceTimersByTime(BACKOFF_MS[0])
    }
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything())
  })

  it('stop closes the session and cancels a pending reconnect', () => {
    const { connect, sessions } = fakeConnect()
    const handle = createLiveCaptionSource({ url: 'wss://x', connect })({}, { lang: 'en-us', onText: vi.fn() })
    sessions[0].opts.onStatus('error', 'closed')
    handle.stop()
    vi.advanceTimersByTime(60000)
    expect(connect).toHaveBeenCalledTimes(1)
    const h2 = createLiveCaptionSource({ url: 'wss://x', connect })({}, { lang: 'en-us', onText: vi.fn() })
    h2.stop()
    expect(sessions[1].stop).toHaveBeenCalled()
    // Status from a stopped source is ignored.
    sessions[1].opts.onStatus('error', 'closed')
    vi.advanceTimersByTime(60000)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})

describe('captionLanguages', () => {
  it('names the speech models in the site language and drops junk', () => {
    expect(captionLanguages(['en-us', 'de', 'not a code', 5], 'en')).toEqual([
      { code: 'en-us', label: 'American English' },
      { code: 'de', label: 'German' },
    ])
    expect(captionLanguages(['en-us'], 'de')[0].label).toMatch(/Englisch/)
    expect(captionLanguages(null, 'en')).toEqual([])
  })
})
