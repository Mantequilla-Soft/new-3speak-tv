// @vitest-environment jsdom
// The audio upload's live waveform (components/AudioUploadModal/RecordWave.jsx):
// the mic level as bars while recording, and a warning when no sound comes in
// for a few seconds or the browser mutes the track, so a silent recording
// shows up while it is made. The recorder starts only once the mic delivers
// (waitForMic), on an audio context made in the record click (newRecordContext),
// and a reopened mic moves onto the same graph (attach).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import RecordWave, { openRecordGraph, newRecordContext, waitForMic } from '../../../src/components/AudioUploadModal/RecordWave.jsx'

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

  it('is null without Web Audio or a stream, and closes a context it cannot use', () => {
    expect(openRecordGraph({ id: 'mic' })).toBeNull()
    expect(newRecordContext()).toBeNull()
    const close = vi.fn()
    expect(openRecordGraph(null, { close })).toBeNull()
    expect(close).toHaveBeenCalled()
  })

  it('moves to a reopened mic on the same context', () => {
    const made = []
    const ctx = {
      createAnalyser: () => ({ fftSize: 0 }),
      createMediaStreamSource: (st) => { const n = { st, connect: vi.fn(), disconnect: vi.fn() }; made.push(n); return n },
      resume: async () => {},
      close: vi.fn(async () => {}),
    }
    const g = openRecordGraph({ id: 'first' }, ctx)
    g.attach({ id: 'second' })
    expect(made[0].disconnect).toHaveBeenCalled()
    expect(made[1].st).toEqual({ id: 'second' })
    expect(made[1].connect).toHaveBeenCalledWith(g.analyser)
    expect(ctx.close).not.toHaveBeenCalled()
  })

  it('uses the context made in the click', () => {
    const connect = vi.fn()
    const ctx = { createAnalyser: () => ({ fftSize: 0 }), createMediaStreamSource: () => ({ connect }), resume: vi.fn(async () => {}), close: vi.fn(async () => {}) }
    const g = openRecordGraph({ id: 'mic' }, ctx)
    expect(g.ctx).toBe(ctx)
    expect(connect).toHaveBeenCalled()
  })
})

describe('waitForMic', () => {
  const sleep = async () => {}
  const stream = (track) => ({ getAudioTracks: () => [track] })
  const graph = (state, samples) => {
    let n = 0
    return {
      ctx: { state: state(), resume: vi.fn(async () => {}) },
      analyser: { fftSize: 4, getByteTimeDomainData: (a) => a.fill(samples(n++)) },
    }
  }

  it('is ready once the track is live and the first samples are in', async () => {
    const g = graph(() => 'running', (n) => (n < 3 ? 128 : 130))
    await expect(waitForMic(stream({ muted: false, readyState: 'live' }), g, { sleep })).resolves.toBe(true)
  })

  it('waits while the track is muted, and gives up after the timeout', async () => {
    const track = { muted: true, readyState: 'live' }
    const g = graph(() => 'running', () => 130)
    await expect(waitForMic(stream(track), g, { sleep, timeoutMs: 200 })).resolves.toBe(false)
    track.muted = false
    await expect(waitForMic(stream(track), g, { sleep })).resolves.toBe(true)
  })

  it('wakes a suspended context instead of reading it', async () => {
    const g = graph(() => 'suspended', () => 130)
    await expect(waitForMic(stream({ muted: false, readyState: 'live' }), g, { sleep, timeoutMs: 100 })).resolves.toBe(false)
    expect(g.ctx.resume).toHaveBeenCalled()
  })

  it('tells a quiet room from a dead stream by its float samples', async () => {
    const floats = (v) => ({ ctx: { state: 'running' }, analyser: { fftSize: 4, getFloatTimeDomainData: (a) => a.fill(v), getByteTimeDomainData: (a) => a.fill(128) } })
    const tr = { muted: false, readyState: 'live' }
    // a quiet room rounds to the midpoint in 8 bits, but its floats are not zero
    await expect(waitForMic(stream(tr), floats(0.0004), { sleep })).resolves.toBe(true)
    await expect(waitForMic(stream(tr), floats(0), { sleep, timeoutMs: 100 })).resolves.toBe(false)
  })

  it('needs only a live track where there is no graph', async () => {
    await expect(waitForMic(stream({ muted: false, readyState: 'live' }), null, { sleep })).resolves.toBe(true)
  })
})
