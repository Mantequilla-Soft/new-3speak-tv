// Season and episode numbers (src/utils/episodeNumbers.js): cleaned from what is
// typed or stored, written only when set, shown as "S2 E5".
import { describe, it, expect } from 'vitest'
import { cleanNumber, episodeNumbersOf, episodeNumbersOfMeta, episodeFields, episodeLabel, MAX_SEASON } from '../../../src/utils/episodeNumbers'

describe('episode numbers', () => {
  it('keeps whole numbers in range, typed or stored', () => {
    expect(cleanNumber('5', MAX_SEASON)).toBe(5)
    expect(cleanNumber(12, MAX_SEASON)).toBe(12)
    for (const bad of ['', '  ', '0', '-1', '1.5', 'x', null, undefined, 10000]) expect(cleanNumber(bad, MAX_SEASON)).toBeNull()
  })

  it('writes only the numbers that are set', () => {
    expect(episodeFields({ season: '2', episode: '5' })).toEqual({ season: 2, episode: 5 })
    expect(episodeFields({ season: '', episode: '7' })).toEqual({ episode: 7 })
    expect(episodeFields({ season: 'abc', episode: '' })).toEqual({})
  })

  it('reads them from a post (audio block first, then video) or an audio row', () => {
    expect(episodeNumbersOfMeta(JSON.stringify({ audio: { type: 'podcast', season: 2, episode: 5 } }))).toEqual({ season: 2, episode: 5 })
    expect(episodeNumbersOfMeta({ video: { episode: 3 } })).toEqual({ season: null, episode: 3 })
    expect(episodeNumbersOfMeta('not json')).toEqual({ season: null, episode: null })
    expect(episodeNumbersOf({ owner: 'badadib', season: 1, episode: 9 })).toEqual({ season: 1, episode: 9 })
  })

  it('labels them as S2 E5, E5 or S2', () => {
    expect(episodeLabel({ season: 2, episode: 5 })).toBe('S2 E5')
    expect(episodeLabel({ episode: '5' })).toBe('E5')
    expect(episodeLabel({ season: 2 })).toBe('S2')
    expect(episodeLabel({})).toBe('')
  })
})
