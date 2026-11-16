// Focus mode's background music (components/common/FocusWriter/focusMusic.js):
// the chosen track is remembered on the device (0 = off, anything else unknown
// is off), and without Web Audio there is simply no player.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

const { readMusicPref, saveMusicPref, createFocusMusic, MUSIC_TRACKS } = await import('../../../src/components/common/FocusWriter/focusMusic.js')

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
