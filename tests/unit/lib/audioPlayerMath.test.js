// The pure parts of the global audio player (src/components/GlobalAudioPlayer/playerMath.js):
// speed, skips, the sleep timer, chapter markers, timestamp and clip links, the
// skip-silence detector and the per-host CORS cache.
import { describe, it, expect } from 'vitest'
import {
  fmt, parseTimeParam, normalizeSpeed, formatSpeed, SPEEDS, skipTarget,
  startSleepTimer, sleepRemainingMs, sleepFadeFactor, SLEEP_FADE_MS,
  chapterMarkers, chapterIndexAt, chapterJumps,
  withTimestamp, clipRange, CLIP_MIN, CLIP_MAX,
  skipRate, levelDb, createSilenceDetector, savedMs, fmtSaved,
  corsKnown, rememberCors, CORS_CACHE_KEY, hostOf, isHlsTrack,
} from '../../../src/components/GlobalAudioPlayer/playerMath.js'

function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}

describe('time', () => {
  it('formats like the player always has', () => {
    expect(fmt(0)).toBe('0:00')
    expect(fmt(83.9)).toBe('1:23')
    expect(fmt(3723)).toBe('1:02:03')
  })

  it('reads t= and end= in the shapes people paste', () => {
    expect(parseTimeParam('83')).toBe(83)
    expect(parseTimeParam('83.5')).toBe(83.5)
    expect(parseTimeParam('1:23')).toBe(83)
    expect(parseTimeParam('1:02:03')).toBe(3723)
    expect(parseTimeParam('1h2m3s')).toBe(3723)
    expect(parseTimeParam('90s')).toBe(90)
    expect(parseTimeParam('')).toBeNull()
    expect(parseTimeParam(null)).toBeNull()
    expect(parseTimeParam('soon')).toBeNull()
    expect(parseTimeParam('-5')).toBeNull()
  })
})

describe('speed', () => {
  it('snaps to the offered speeds and falls back to 1', () => {
    expect(SPEEDS).toEqual([0.5, 0.8, 1, 1.2, 1.5, 1.8, 2])
    expect(normalizeSpeed('1.5')).toBe(1.5)
    expect(normalizeSpeed(1.45)).toBe(1.5)
    expect(normalizeSpeed(9)).toBe(2)
    // A 2.5x or 3x saved by an earlier build comes back as 2x.
    expect(normalizeSpeed(3)).toBe(2)
    expect(normalizeSpeed('nope')).toBe(1)
    expect(normalizeSpeed(null)).toBe(1)
    expect(normalizeSpeed(0)).toBe(1)
    expect(formatSpeed(1)).toBe('1×')
    expect(formatSpeed(2.5)).toBe('2.5×')
  })

  it('skips stay inside the episode', () => {
    expect(skipTarget(10, -15, 600)).toBe(0)
    expect(skipTarget(100, 30, 600)).toBe(130)
    expect(skipTarget(590, 30, 600)).toBe(600)
    expect(skipTarget(590, 30, NaN)).toBe(620)
  })
})

describe('sleep timer', () => {
  it('counts minutes down from when it was set', () => {
    const timer = startSleepTimer(15, 1000)
    expect(timer).toEqual({ mode: 'minutes', minutes: 15, endsAt: 1000 + 15 * 60000 })
    expect(sleepRemainingMs(timer, { now: 1000 + 60000 })).toBe(14 * 60000)
    expect(sleepRemainingMs(timer, { now: 1000 + 20 * 60000 })).toBe(0)
    expect(startSleepTimer(0, 1000)).toBeNull()
  })

  it('"end of episode" is the rest of the episode at the playing speed', () => {
    const timer = startSleepTimer('end', 0)
    expect(timer).toEqual({ mode: 'end' })
    expect(sleepRemainingMs(timer, { now: 0, currentTime: 500, duration: 600, rate: 1 })).toBe(100000)
    expect(sleepRemainingMs(timer, { now: 0, currentTime: 500, duration: 600, rate: 2 })).toBe(50000)
    expect(sleepRemainingMs(timer, { now: 0, currentTime: 500, duration: 0 })).toBeNull()
    expect(sleepRemainingMs(null, { now: 0 })).toBeNull()
  })

  it('fades over the last 8 seconds only', () => {
    expect(SLEEP_FADE_MS).toBe(8000)
    expect(sleepFadeFactor(60000)).toBe(1)
    expect(sleepFadeFactor(8000)).toBe(1)
    expect(sleepFadeFactor(4000)).toBe(0.5)
    expect(sleepFadeFactor(0)).toBe(0)
    expect(sleepFadeFactor(-50)).toBe(0)
    expect(sleepFadeFactor(null)).toBe(1)
  })
})

describe('chapters', () => {
  const chapters = [
    { start: 0, title: 'Intro' },
    { start: 60, title: 'One' },
    { start: 300, title: 'Two' },
    { start: 900, title: 'Past the end' },
  ]

  it('marks where each chapter starts, not the first and not past the end', () => {
    expect(chapterMarkers(chapters, 600)).toEqual([0.1, 0.5])
    expect(chapterMarkers(chapters, 0)).toEqual([])
    expect(chapterMarkers(null, 600)).toEqual([])
  })

  it('knows the chapter playing and where previous and next go', () => {
    expect(chapterIndexAt(chapters, 30)).toBe(0)
    expect(chapterIndexAt(chapters, 60)).toBe(1)
    expect(chapterIndexAt([], 60)).toBe(-1)
    // Early in a chapter: previous is the one before.
    expect(chapterJumps(chapters, 61)).toEqual({ index: 1, prev: 0, next: 300 })
    // Further in: previous restarts this one.
    expect(chapterJumps(chapters, 120)).toEqual({ index: 1, prev: 60, next: 300 })
    expect(chapterJumps(chapters, 950).next).toBeNull()
    expect(chapterJumps([], 10)).toEqual({ index: -1, prev: null, next: null })
  })
})

describe('timestamp and clip links', () => {
  it('adds t= (and end=) with the right separator', () => {
    expect(withTimestamp('https://3speak.tv/audio?play=a/b', 83.7)).toBe('https://3speak.tv/audio?play=a/b&t=83')
    expect(withTimestamp('https://x.test/ep', 83, 113.2)).toBe('https://x.test/ep?t=83&end=114')
    expect(withTimestamp('https://x.test/ep', 0)).toBe('https://x.test/ep')
    expect(withTimestamp('https://x.test/ep?a=1', 0, 30)).toBe('https://x.test/ep?a=1&end=30')
    expect(withTimestamp('https://x.test/ep', 50, 40)).toBe('https://x.test/ep?t=50')
  })

  it('keeps a clip to 15..90 seconds and inside the episode', () => {
    expect([CLIP_MIN, CLIP_MAX]).toEqual([15, 90])
    expect(clipRange(100.4, 30, 600)).toEqual({ start: 100, end: 130 })
    expect(clipRange(100, 5, 600)).toEqual({ start: 100, end: 115 })
    expect(clipRange(100, 500, 600)).toEqual({ start: 100, end: 190 })
    expect(clipRange(590, 30, 600)).toEqual({ start: 590, end: 600 })
    expect(clipRange(10, 30, 0)).toEqual({ start: 10, end: 40 })
  })
})

describe('skip silence', () => {
  it('rushes at 2.5 times the speed, never past 4×', () => {
    expect(skipRate(1)).toBe(2.5)
    expect(skipRate(1.5)).toBe(3.75)
    expect(skipRate(3)).toBe(4)
  })

  it('measures loudness and corrects for the volume', () => {
    expect(levelDb(new Float32Array(64).fill(0))).toBe(-Infinity)
    expect(levelDb(new Float32Array(64).fill(1))).toBeCloseTo(0, 5)
    expect(levelDb(new Float32Array(64).fill(0.1))).toBeCloseTo(-20, 5)
    // At half volume the same signal reads 6 dB louder than it sounds.
    expect(levelDb(new Float32Array(64).fill(0.05), 0.5)).toBeCloseTo(-20, 5)
    expect(levelDb(new Float32Array(64).fill(0.5), 0)).toBe(-Infinity)
  })

  it('rushes only after 300 ms under the threshold, until sound returns', () => {
    const d = createSilenceDetector({ thresholdDb: -45, holdMs: 300 })
    expect(d.update(-20, 0)).toBe(false)
    expect(d.update(-60, 100)).toBe(false)
    expect(d.update(-60, 350)).toBe(false)
    // Sound in between resets the wait.
    expect(d.update(-20, 360)).toBe(false)
    expect(d.update(-60, 400)).toBe(false)
    expect(d.update(-60, 700)).toBe(true)
    expect(d.skipping).toBe(true)
    // Just above the threshold is not enough to stop (headroom), clearly above is.
    expect(d.update(-44, 750)).toBe(true)
    expect(d.update(-30, 800)).toBe(false)
    d.update(-60, 900); d.update(-60, 1300)
    d.reset()
    expect(d.skipping).toBe(false)
  })

  it('counts the time saved', () => {
    expect(savedMs(1000, 2.5, 1)).toBe(1500)
    expect(savedMs(1000, 1, 1)).toBe(0)
    expect(savedMs(1000, 4, 2)).toBe(1000)
    expect(fmtSaved(12400)).toBe('12 s')
    expect(fmtSaved(184000)).toBe('3 min 4 s')
    expect(fmtSaved(3720000)).toBe('1 h 2 min')
  })
})

describe('CORS per host', () => {
  it('knows our own sources and blob URLs', () => {
    expect(corsKnown('blob:https://3speak.tv/abc')).toBe(true)
    expect(corsKnown('https://ipfs-audio.3speak.tv/ipfs/Qm1')).toBe(true)
    expect(corsKnown('https://ipfs-3speak.b-cdn.net/ipfs/Qm1')).toBe(true)
    expect(corsKnown('https://3speak.tv/x.mp3', { origin: 'https://3speak.tv' })).toBe(true)
    expect(corsKnown('')).toBe(false)
    expect(corsKnown('not a url')).toBe(false)
  })

  it('remembers each host, and forgets old answers', () => {
    const storage = memoryStorage()
    const day = 86400000
    expect(corsKnown('https://cdn.pod.test/ep1.mp3', { storage, now: 0 })).toBeNull()
    rememberCors('https://cdn.pod.test/ep1.mp3', true, { storage, now: 0 })
    rememberCors('https://other.test/a.mp3', false, { storage, now: 0 })
    // Same host, another episode: the same answer.
    expect(corsKnown('https://cdn.pod.test/ep2.mp3?x=1', { storage, now: day })).toBe(true)
    expect(corsKnown('https://other.test/b.mp3', { storage, now: day })).toBe(false)
    // A "no" is tried again after a few days, a "yes" lasts a month.
    expect(corsKnown('https://other.test/b.mp3', { storage, now: 4 * day })).toBeNull()
    expect(corsKnown('https://cdn.pod.test/ep2.mp3', { storage, now: 29 * day })).toBe(true)
    expect(corsKnown('https://cdn.pod.test/ep2.mp3', { storage, now: 31 * day })).toBeNull()
    expect(JSON.parse(storage.getItem(CORS_CACHE_KEY))['cdn.pod.test']).toEqual({ ok: true, at: 0 })
  })

  it('survives broken or missing storage', () => {
    const storage = memoryStorage()
    storage.setItem(CORS_CACHE_KEY, '{nope')
    expect(corsKnown('https://cdn.pod.test/ep1.mp3', { storage })).toBeNull()
    expect(corsKnown('https://cdn.pod.test/ep1.mp3', {})).toBeNull()
    expect(() => rememberCors('https://cdn.pod.test/ep1.mp3', true, {})).not.toThrow()
    expect(hostOf('https://CDN.Pod.test:8443/x')).toBe('cdn.pod.test:8443')
  })
})

describe('live streams', () => {
  it('tells an HLS stream by its type or address', () => {
    expect(isHlsTrack({ live: true, mime: 'application/x-mpegURL', src: 'https://live.test/s' })).toBe(true)
    expect(isHlsTrack({ live: true, src: 'https://live.test/s/index.m3u8?token=1' })).toBe(true)
    expect(isHlsTrack({ live: true, mime: 'audio/mpeg', src: 'https://live.test/s.mp3' })).toBe(false)
    expect(isHlsTrack(null)).toBe(false)
  })
})
