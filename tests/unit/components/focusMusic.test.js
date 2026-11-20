// Focus mode's background music (components/common/FocusWriter/focusMusic.js):
// the chosen track is remembered on the device (0 = off, anything else unknown
// is off), and without Web Audio there is simply no player. Notes sit on the
// audio clock, so a mood also renders offline (renderFocusMusic, the narrated
// posts' music beds) with every note placed up front.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { readMusicPref, saveMusicPref, createFocusMusic, renderFocusMusic, MUSIC_TRACKS } = await import('../../../src/components/common/FocusWriter/focusMusic.js')

beforeEach(() => localStorage.clear())

describe('focus music', () => {
  it('three tracks, off by default', () => {
    expect(MUSIC_TRACKS).toEqual([1, 2, 3])
    expect(readMusicPref()).toBe(0)
  })
  it('remembers the track, and reads anything else as off', () => {
    saveMusicPref(2)
    expect(readMusicPref()).toBe(2)
    localStorage.setItem('focusWriterMusic', '7')
    expect(readMusicPref()).toBe(0)
    saveMusicPref(0)
    expect(readMusicPref()).toBe(0)
  })
  it('no Web Audio, no player', () => {
    expect(window.AudioContext).toBeUndefined()
    expect(createFocusMusic()).toBeNull()
  })
})

// A stand-in audio context: records when each source starts.
function fakeContext() {
  const starts = []
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} })
  const node = (extra = {}) => ({ connect(n) { return n }, disconnect() {}, gain: param(), frequency: param(), Q: param(), detune: param(), pan: param(), delayTime: param(), ...extra })
  const source = () => node({ start(at = 0) { starts.push(at) }, stop() {} })
  class Ctx {
    constructor(channels, length, sampleRate) {
      this.sampleRate = sampleRate
      this.length = length
      this.currentTime = 0
      this.destination = node()
      this.starts = starts
      Ctx.last = this
    }
    createGain() { return node() }
    createDynamicsCompressor() { return node() }
    createConvolver() { return node() }
    createBiquadFilter() { return node() }
    createStereoPanner() { return node() }
    createDelay() { return node() }
    createOscillator() { return source() }
    createBufferSource() { return source() }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) } }
    suspend(t) { return new Promise((ok) => { (this.suspends ||= []).push({ t, ok }) }) }
    resume() { return Promise.resolve() }
    // Renders: each suspend point in order, letting its callback place notes.
    async startRendering() {
      for (const s of (this.suspends || []).sort((a, b) => a.t - b.t)) {
        this.currentTime = s.t
        s.ok()
        await new Promise((r) => setTimeout(r, 0))
      }
      return { length: this.length }
    }
  }
  return Ctx
}

describe('offline render (narration music beds)', () => {
  it('places the notes a stretch ahead while rendering, to the whole length', async () => {
    const Ctx = fakeContext()
    const pending = renderFocusMusic(2, 60, { sampleRate: 100, OfflineCtx: Ctx })
    // Before rendering: only the first stretch.
    expect(Math.max(0, ...Ctx.last.starts)).toBeLessThan(2.3)
    const out = await pending
    expect(out.length).toBe(6000)
    const notes = Ctx.last.starts.filter((t) => t > 0)
    // Night piano: a note every 0.7 to 2.2 s, three partials each.
    expect(notes.length).toBeGreaterThanOrEqual(27 * 3)
    expect(Math.max(...notes)).toBeLessThan(60)
    expect(Math.max(...notes)).toBeGreaterThan(55)
  })

  it('rain and fireplace fill the whole length too', async () => {
    for (const n of [1, 3]) {
      const Ctx = fakeContext()
      await renderFocusMusic(n, 30, { sampleRate: 100, OfflineCtx: Ctx })
      const late = Ctx.last.starts.filter((t) => t > 25)
      expect(late.length).toBeGreaterThan(10)
    }
  })

  it('no such mood, no length, or no offline audio: nothing', () => {
    const Ctx = fakeContext()
    expect(renderFocusMusic(4, 60, { OfflineCtx: Ctx })).toBeNull()
    expect(renderFocusMusic(1, 0, { OfflineCtx: Ctx })).toBeNull()
    expect(renderFocusMusic(1, 60)).toBeNull()
  })
})

describe('live player', () => {
  it('tops up the schedule from the audio clock, and stops with off', () => {
    vi.useFakeTimers()
    const Ctx = fakeContext()
    window.AudioContext = class extends Ctx {
      constructor() { super(2, 0, 100); this.state = 'running' }
      close() { return Promise.resolve() }
    }
    try {
      const music = createFocusMusic()
      music.play(2)
      const ctx = Ctx.last
      const before = ctx.starts.length
      ctx.currentTime = 30
      vi.advanceTimersByTime(100)
      const placed = ctx.starts.filter((t) => t > 0)
      expect(ctx.starts.length).toBeGreaterThan(before)
      // Never further ahead than the lookahead.
      expect(Math.max(...placed)).toBeLessThan(30.3)
      music.play(0)
      const count = ctx.starts.length
      ctx.currentTime = 60
      vi.advanceTimersByTime(1000)
      expect(ctx.starts.length).toBe(count)
      music.close()
    } finally {
      delete window.AudioContext
      vi.useRealTimers()
    }
  })
})
