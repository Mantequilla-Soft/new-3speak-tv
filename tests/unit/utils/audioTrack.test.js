// How the audio player names a track (src/utils/audioTrack.js): an outside
// episode by its show, a 3Speak upload by its @account.
import { describe, it, expect } from 'vitest'
import { trackArtist, nowPlayingLabel } from '../../../src/utils/audioTrack.js'

describe('trackArtist', () => {
  it.each([
    [{ external: true, show: 'The Show', owner: 'x' }, 'The Show'],
    [{ external: true }, ''],
    [{ owner: 'alice' }, '@alice'],
    [{}, ''],
    [null, ''],
  ])('%j -> %j', (item, artist) => {
    expect(trackArtist(item)).toBe(artist)
  })
})

describe('nowPlayingLabel', () => {
  it.each([
    [{ title: 'Song', owner: 'alice' }, 'Song · @alice'],
    [{ title: 'Ep 1', external: true, show: 'Show' }, 'Ep 1 · Show'],
    [{ title: 'Alone' }, 'Alone'],
    [{ owner: 'alice' }, ''],
    [undefined, ''],
  ])('%j -> %j', (item, label) => {
    expect(nowPlayingLabel(item)).toBe(label)
  })
})
