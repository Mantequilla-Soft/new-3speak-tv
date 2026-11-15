// The math behind press-and-drag scrubbing on the audio timelines (lib/timelineScrub.js).
import { describe, it, expect } from 'vitest'
import { fractionAt, shouldLiveSeek, isLocalSource, LIVE_SEEK_MS } from '../../../src/lib/timelineScrub'

describe('where the pointer is on the bar', () => {
  const rect = { left: 100, width: 200 }
  it('is a fraction of the width, clamped to the ends', () => {
    expect(fractionAt(100, rect)).toBe(0)
    expect(fractionAt(150, rect)).toBe(0.25)
    expect(fractionAt(300, rect)).toBe(1)
    expect(fractionAt(20, rect)).toBe(0)
    expect(fractionAt(900, rect)).toBe(1)
  })
  it('is 0 for a bar with no size or no position', () => {
    expect(fractionAt(150, { left: 0, width: 0 })).toBe(0)
    expect(fractionAt(NaN, rect)).toBe(0)
    expect(fractionAt(150, null)).toBe(0)
  })
})

describe('live seeking while dragging', () => {
  it('only for a file in this browser, and not more often than the throttle', () => {
    expect(shouldLiveSeek({ local: false, now: 10_000, lastAt: 0 })).toBe(false)
    expect(shouldLiveSeek({ local: true, now: 10_000, lastAt: 0 })).toBe(true)
    expect(shouldLiveSeek({ local: true, now: 10_000, lastAt: 10_000 - LIVE_SEEK_MS + 1 })).toBe(false)
    expect(shouldLiveSeek({ local: true, now: 10_000, lastAt: 10_000 - LIVE_SEEK_MS })).toBe(true)
  })
  it('knows a local source from a network one', () => {
    expect(isLocalSource('blob:https://3speak.tv/1234')).toBe(true)
    expect(isLocalSource('data:audio/mp3;base64,AAA')).toBe(true)
    expect(isLocalSource('https://ipfs-audio.3speak.tv/ipfs/x')).toBe(false)
    expect(isLocalSource(undefined)).toBe(false)
  })
})
