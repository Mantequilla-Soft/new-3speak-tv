// @vitest-environment jsdom
// The audio upload's live waveform (components/AudioUploadModal/RecordWave.jsx):
// the mic level as bars while recording, and a warning when no sound comes in
// for a few seconds or the browser mutes the track, so a silent recording
// shows up while it is made.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import RecordWave, { openRecordGraph } from '../../../src/components/AudioUploadModal/RecordWave.jsx'

// An analyser whose samples swing `level` around the 128 midpoint
function fakeAnalyser(state) {
  return {
    fftSize: 32,
    getByteTimeDomainData: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = 128 + (i % 2 ? 1 : -1) * Math.round(state.level * 127) },
  }
}

describe('RecordWave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('stays quiet while sound comes in', () => {
    const state = { level: 0.3 }
    renderWithProviders(<RecordWave analyser={fakeAnalyser(state)} track={{ muted: false }} />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByRole('img', { name: 'Microphone level' })).toBeInTheDocument()
    expect(screen.queryByText(/No sound is coming in/)).toBeNull()
  })

  it('warns after three seconds of silence, and the warning goes once sound comes', () => {
    const state = { level: 0 }
    renderWithProviders(<RecordWave analyser={fakeAnalyser(state)} track={{ muted: false }} />)
    act(() => { vi.advanceTimersByTime(2500) })
    expect(screen.queryByText(/No sound is coming in/)).toBeNull()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status')).toHaveTextContent(/No sound is coming in/)
    state.level = 0.5
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText(/No sound is coming in/)).toBeNull()
  })

  it('warns at once when the browser mutes the track', () => {
    renderWithProviders(<RecordWave analyser={fakeAnalyser({ level: 0.5 })} track={{ muted: true }} />)
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByText(/No sound is coming in/)).toBeInTheDocument()
  })

  it('draws nothing and warns about nothing without an analyser', () => {
    renderWithProviders(<RecordWave analyser={null} track={null} />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByText(/No sound is coming in/)).toBeNull()
  })
})

describe('openRecordGraph', () => {
  afterEach(() => { delete window.AudioContext })

  it('hangs an analyser on the stream and closes its context', () => {
    const connect = vi.fn()
    const close = vi.fn(async () => {})
    const analyser = { fftSize: 0 }
    window.AudioContext = vi.fn(function Ctx() {
      return { createAnalyser: () => analyser, createMediaStreamSource: () => ({ connect }), resume: async () => {}, close }
    })
    const g = openRecordGraph({ id: 'mic' })
    expect(g.analyser).toBe(analyser)
    expect(analyser.fftSize).toBe(1024)
    expect(connect).toHaveBeenCalledWith(analyser)
    g.close()
    expect(close).toHaveBeenCalled()
  })

  it('is null without Web Audio or a stream', () => {
    expect(openRecordGraph({ id: 'mic' })).toBeNull()
    window.AudioContext = vi.fn()
    expect(openRecordGraph(null)).toBeNull()
  })
})
