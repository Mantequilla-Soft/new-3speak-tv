// The voice-driven teleprompter (src/hooks/useVoiceTeleprompter.js): the
// recognizer set up for continuous partial results, the pointer advancing as the
// script is read (never re-counting words of the same utterance), restarts while
// active, a blocked microphone stopping it, and a server transcript feeding the
// same matcher. The real matcher (utils/scriptMatcher) is used.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let recognizers
class FakeRecognition {
  constructor() { this.start = vi.fn(() => this.onstart?.()); this.stop = vi.fn(); recognizers.push(this) }
  say(transcript, isFinal = false) {
    const results = [Object.assign([{ transcript }], { isFinal })]
    act(() => this.onresult({ results }))
  }
}

const SCRIPT = 'Hello and welcome to my channel\n\nToday we bake bread'
let useVoiceTeleprompter

beforeEach(async () => {
  recognizers = []
  window.SpeechRecognition = FakeRecognition
  vi.resetModules()
  useVoiceTeleprompter = (await import('../../../src/hooks/useVoiceTeleprompter.js')).default
})
afterEach(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })

describe('the script', () => {
  it('is split into words, nothing read yet', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    expect(result.current).toMatchObject({ supported: true, listening: false, matchedCount: 0, totalWords: 10, error: '' })
    expect(result.current.words[6]).toMatchObject({ text: 'Today', br: 2 })
  })

  it('a changed script starts from the top', () => {
    const { result, rerender } = renderHook(({ s }) => useVoiceTeleprompter(s), { initialProps: { s: SCRIPT } })
    act(() => result.current.ingestTranscript('hello and welcome', true))
    expect(result.current.matchedCount).toBe(3)
    rerender({ s: 'A different script' })
    expect(result.current).toMatchObject({ matchedCount: 0, totalWords: 3, interimText: '' })
  })
})

describe('listening', () => {
  it('starts a continuous recognizer with partial results in the chosen language', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT, { lang: 'de-DE' }))
    act(() => result.current.start())
    const rec = recognizers[0]
    expect(rec).toMatchObject({ continuous: true, interimResults: true, lang: 'de-DE' })
    expect(result.current.listening).toBe(true)
    act(() => result.current.start())
    expect(recognizers).toHaveLength(1)
  })

  it('defaults to US English', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    expect(recognizers[0].lang).toBe('en-US')
  })

  it('advances as words are read, without re-counting the same utterance', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    const rec = recognizers[0]
    rec.say('hello and')
    expect(result.current.matchedCount).toBe(2)
    rec.say('hello and welcome to')
    expect(result.current.matchedCount).toBe(4)
    expect(result.current.interimText).toBe('hello and welcome to')
    rec.say('hello and welcome to my channel', true)
    expect(result.current.matchedCount).toBe(6)
    rec.say('today we')
    expect(result.current.matchedCount).toBe(8)
  })

  it('shows only the tail of a long partial', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.ingestTranscript('word '.repeat(40)))
    expect(result.current.interimText.startsWith('…')).toBe(true)
    expect(result.current.interimText).toHaveLength(91)
  })

  it('restarts by itself when the browser ends the session while active', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    const rec = recognizers[0]
    act(() => rec.onend())
    expect(rec.start).toHaveBeenCalledTimes(2)
    expect(result.current.listening).toBe(true)
  })

  it('a blocked microphone reports the error and stops listening', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    const rec = recognizers[0]
    act(() => rec.onerror({ error: 'not-allowed' }))
    expect(result.current.error).toBe('not-allowed')
    act(() => rec.onend())
    expect(rec.start).toHaveBeenCalledTimes(1)
    expect(result.current.listening).toBe(false)
  })

  it('a passing error keeps listening, and is cleared by the next words', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    const rec = recognizers[0]
    act(() => rec.onerror({}))
    expect(result.current.error).toBe('error')
    act(() => rec.onend())
    expect(rec.start).toHaveBeenCalledTimes(2)
    rec.say('hello')
    expect(result.current.error).toBe('')
  })

  it('stopping stops the recognizer for good', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    const rec = recognizers[0]
    act(() => result.current.stop())
    expect(rec.stop).toHaveBeenCalled()
    expect(rec.onend).toBeNull()
    expect(result.current.listening).toBe(false)
  })

  it('unmounting stops the recognizer', () => {
    const { result, unmount } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    unmount()
    expect(recognizers[0].stop).toHaveBeenCalled()
  })

  it('an empty result event changes nothing', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.start())
    act(() => recognizers[0].onresult({ results: [] }))
    expect(result.current.matchedCount).toBe(0)
  })
})

describe('reset and the server transcript', () => {
  it('reset goes back to the first word', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.ingestTranscript('hello and welcome', true))
    act(() => result.current.reset())
    expect(result.current).toMatchObject({ matchedCount: 0, interimText: '' })
  })

  it('a server transcript drives the same pointer', () => {
    const { result } = renderHook(() => useVoiceTeleprompter(SCRIPT))
    act(() => result.current.ingestTranscript('hello and welcome'))
    act(() => result.current.ingestTranscript('hello and welcome to my', true))
    expect(result.current.matchedCount).toBe(5)
  })
})

describe('a browser without speech recognition', () => {
  it('says so instead of starting', async () => {
    delete window.SpeechRecognition
    vi.resetModules()
    const hook = (await import('../../../src/hooks/useVoiceTeleprompter.js')).useVoiceTeleprompter
    const { result } = renderHook(() => hook(SCRIPT))
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.error).toBe('unsupported')
  })

  it('uses the webkit-prefixed recognizer where that is all there is', async () => {
    delete window.SpeechRecognition
    window.webkitSpeechRecognition = FakeRecognition
    vi.resetModules()
    const hook = (await import('../../../src/hooks/useVoiceTeleprompter.js')).default
    const { result } = renderHook(() => hook(SCRIPT))
    act(() => result.current.start())
    expect(recognizers).toHaveLength(1)
  })
})
