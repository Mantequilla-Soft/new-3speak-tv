// @vitest-environment jsdom
// The galaxy's generated background music (src/lib/galaxyAmbient.js). A fake
// Web Audio context records the graph it builds, and fake timers step through
// the chord changes and chimes, so no sound is ever made.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAmbient } from '../../../src/lib/galaxyAmbient.js'

const param = (value = 0) => ({
  value,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
})

function node(extra = {}) {
  return {
    connect: vi.fn((next) => next),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: param(),
    detune: param(),
    gain: param(1),
    Q: param(),
    pan: param(),
    ...extra,
  }
}

// A minimal AudioContext that keeps every node it hands out.
function fakeContextClass({ panner = true } = {}) {
  const made = []
  class FakeContext {
    constructor() {
      this.currentTime = 0
      this.sampleRate = 100
      this.destination = node()
      this.oscillators = []
      this.gains = []
      this.resume = vi.fn()
      this.close = vi.fn()
      if (panner) this.createStereoPanner = () => node()
      made.push(this)
    }
    createGain() { const n = node(); this.gains.push(n); return n }
    createOscillator() { const n = node(); this.oscillators.push(n); return n }
    createDynamicsCompressor() { return node() }
    createBiquadFilter() { return node() }
    createConvolver() { return node() }
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return { getChannelData: (ch) => data[ch] }
    }
  }
  return { FakeContext, made }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  delete window.AudioContext
  delete window.webkitAudioContext
})

describe('createAmbient', () => {
  it('answers a silent no-op player when Web Audio is missing', () => {
    const music = createAmbient()
    expect(music.supported).toBe(false)
    expect(() => { music.start(); music.stop(); music.dispose() }).not.toThrow()
  })

  it('builds the audio graph only on the first start and fades the master in', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    const music = createAmbient()
    expect(music.supported).toBe(true)
    expect(made).toHaveLength(0)

    music.start()
    expect(made).toHaveLength(1)
    const ctx = made[0]
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    const master = ctx.gains[0]
    expect(master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.16, 3)
  })

  it('plays a five note chord with two detuned oscillators per note', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    createAmbient().start()
    const ctx = made[0]
    // The filter LFO, then per note: two pad oscillators and a pan drift.
    const pads = ctx.oscillators.slice(1).filter((o) => o.detune.value !== 0)
    expect(pads).toHaveLength(10)
    expect(pads.map((o) => o.detune.value).sort()).toEqual([...Array(5).fill(-7), ...Array(5).fill(7)].sort())
    // D3 (midi 50) is the first chord's root.
    expect(pads[0].frequency.value).toBeCloseTo(440 * 2 ** ((50 - 69) / 12), 6)
  })

  it('moves to the next chord every 11 seconds, releasing the last one', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    createAmbient().start()
    const ctx = made[0]
    const firstChord = ctx.oscillators.slice(1, 16)
    ctx.currentTime = 11
    vi.advanceTimersByTime(11000)
    firstChord.forEach((o) => expect(o.stop).toHaveBeenCalledWith(11 + 6 + 0.1))
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(1 + 15 * 2)
  })

  it('rings a chime four seconds in and keeps chiming', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    vi.spyOn(Math, 'random').mockReturnValue(0)
    createAmbient().start()
    const ctx = made[0]
    const before = ctx.oscillators.length
    vi.advanceTimersByTime(4000)
    const chime = ctx.oscillators[before]
    // Math.random() = 0 picks the lowest chime, D5 (midi 74).
    expect(chime.frequency.value).toBeCloseTo(440 * 2 ** ((74 - 69) / 12), 6)
    expect(chime.stop).toHaveBeenCalledWith(3.6)
    vi.advanceTimersByTime(2500)
    expect(ctx.oscillators.length).toBe(before + 2)
  })

  it('ignores a second start while playing', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    const music = createAmbient()
    music.start()
    music.start()
    expect(made[0].resume).toHaveBeenCalledTimes(1)
  })

  it('stop fades out, releases the voices and stops scheduling', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    const music = createAmbient()
    music.start()
    const ctx = made[0]
    ctx.currentTime = 2
    music.stop()
    expect(ctx.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3.5)
    const count = ctx.oscillators.length
    vi.advanceTimersByTime(60000)
    expect(ctx.oscillators.length).toBe(count)
    // A second stop does nothing.
    expect(() => music.stop()).not.toThrow()
  })

  it('stop before any start does nothing', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    createAmbient().stop()
    expect(made).toHaveLength(0)
  })

  it('restarts on the same context after a stop and builds a new one after dispose', () => {
    const { FakeContext, made } = fakeContextClass()
    window.AudioContext = FakeContext
    const music = createAmbient()
    music.start()
    music.stop()
    music.start()
    expect(made).toHaveLength(1)
    music.dispose()
    expect(made[0].close).toHaveBeenCalled()
    music.start()
    expect(made).toHaveLength(2)
  })

  it('dispose without a context is safe', () => {
    const { FakeContext } = fakeContextClass()
    window.AudioContext = FakeContext
    expect(() => createAmbient().dispose()).not.toThrow()
  })

  it('works without a stereo panner (older Safari) through webkitAudioContext', () => {
    const { FakeContext, made } = fakeContextClass({ panner: false })
    window.webkitAudioContext = FakeContext
    const music = createAmbient()
    music.start()
    vi.advanceTimersByTime(4000)
    // No pan drift oscillators: LFO + 10 pad oscillators + 1 chime.
    expect(made[0].oscillators).toHaveLength(12)
  })

  it('fills the reverb with noise that fades to silence', () => {
    const { FakeContext, made } = fakeContextClass()
    let buffer
    FakeContext.prototype.createConvolver = function createConvolver() {
      const n = node()
      Object.defineProperty(n, 'buffer', { set(b) { buffer = b }, get() { return buffer } })
      return n
    }
    window.AudioContext = FakeContext
    createAmbient().start()
    expect(made).toHaveLength(1)
    const left = buffer.getChannelData(0)
    expect(left).toHaveLength(500)
    left.forEach((v) => expect(Math.abs(v)).toBeLessThanOrEqual(1))
    expect(Math.abs(left[499])).toBeLessThan(1e-4)
  })
})
