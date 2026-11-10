// @vitest-environment jsdom
// The audio upload's teleprompter (components/AudioUploadModal/AudioTeleprompter.jsx):
// write the script before recording, read it while recording. It follows the
// voice through the speech-to-text server (on the recorder's own mic track)
// when the server is there and knows the script's language, else it moves on
// at a steady words-per-minute pace that - / + change.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { act, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({ stt: false, langs: ['en-US'], streams: [] }))
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  STT_WS_URL: 'wss://stt.test/stt',
  sttEnabledFor: () => m.stt,
}))
vi.mock('../../../src/utils/transcribe', () => ({ transcriptLanguages: async () => m.langs }))
vi.mock('../../../src/utils/sttClient', () => ({
  createSttStream: vi.fn((opts) => {
    const s = { opts, stop: vi.fn() }
    m.streams.push(s)
    return s
  }),
}))

const { default: AudioTeleprompter } = await import('../../../src/components/AudioUploadModal/AudioTeleprompter.jsx')

const track = { kind: 'audio' }
const streamRef = { current: { getAudioTracks: () => [track] } }
const SCRIPT = 'Hello and welcome to the show today'

function view(recording) {
  return <AudioTeleprompter recording={recording} streamRef={streamRef} user="alice" />
}
// Recording starts and stops with a button, so the teleprompter stays mounted
function Harness() {
  const [recording, setRecording] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setRecording((r) => !r)}>toggle recording</button>
      {view(recording)}
    </>
  )
}
const toggle = () => act(() => { fireEvent.click(screen.getByRole('button', { name: 'toggle recording' })) })
const current = () => document.querySelector('.audio-tp-word.current')?.textContent.trim()

beforeEach(() => {
  localStorage.clear()
  m.stt = false
  m.langs = ['en-US']
  m.streams = []
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('AudioTeleprompter', () => {
  it('opens a script field that is kept for next time', async () => {
    const { user, unmount } = renderWithProviders(view(false))
    await user.click(screen.getByRole('button', { name: /Teleprompter/ }))
    await user.type(screen.getByPlaceholderText(/Write or paste what you will say/), SCRIPT)
    expect(localStorage.getItem('audio-tp-script')).toBe(SCRIPT)
    unmount()
    renderWithProviders(view(false))
    // a saved script opens it straight away
    expect(screen.getByPlaceholderText(/Write or paste what you will say/)).toHaveValue(SCRIPT)
  })

  it('shows nothing while recording without a script', () => {
    renderWithProviders(view(true))
    expect(document.querySelector('.audio-tp')).toBeNull()
  })

  it('without the speech server: moves on at the steady pace, and + speeds it up', async () => {
    vi.useFakeTimers()
    localStorage.setItem('audio-tp-script', SCRIPT)
    localStorage.setItem('audio-tp-wpm', '60')
    renderWithProviders(<Harness />)
    expect(screen.getByText('Moves on at a steady pace')).toBeTruthy()
    toggle()
    expect(current()).toBe('Hello')
    // 60 words a minute: one word a second
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(current()).toBe('welcome')
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }))
    expect(screen.getByText('70 words a minute')).toBeTruthy()
    expect(m.streams).toHaveLength(0)
  })

  it('with the speech server: follows the voice on the recorder\'s own track', async () => {
    m.stt = true
    localStorage.setItem('audio-tp-script', SCRIPT)
    renderWithProviders(<Harness />)
    expect(await screen.findByText('Follows your voice')).toBeTruthy()
    toggle()
    expect(m.streams).toHaveLength(1)
    const { opts } = m.streams[0]
    expect(opts.track).toBe(track)
    expect(opts.lang).toBe('en-US')
    act(() => opts.onTranscript('hello and welcome', false))
    expect(current()).toBe('to')
    expect(screen.getByText(/3\/7/)).toBeTruthy()
    toggle()
    expect(m.streams[0].stop).toHaveBeenCalled()
  })

  it('goes on at the steady pace from where the voice got to when the server drops', async () => {
    m.stt = true
    localStorage.setItem('audio-tp-script', SCRIPT)
    renderWithProviders(<Harness />)
    await screen.findByText('Follows your voice')
    toggle()
    const { opts } = m.streams[0]
    act(() => opts.onTranscript('hello and', true))
    act(() => opts.onStatus('error', 'closed'))
    expect(screen.getByText('Voice following stopped, moving on at a steady pace')).toBeTruthy()
    expect(current()).toBe('welcome')
  })

  it('uses the steady pace for a script in a language the server does not have', async () => {
    m.stt = true
    localStorage.setItem('audio-tp-script', 'Hallo und willkommen zu der Sendung, das ist die erste Folge und wir sind hier')
    renderWithProviders(<Harness />)
    await act(async () => {})
    expect(screen.getByText('Moves on at a steady pace')).toBeTruthy()
    toggle()
    expect(m.streams).toHaveLength(0)
  })
})
