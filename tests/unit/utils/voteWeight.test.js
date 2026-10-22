// The remembered vote-weight slider, kept separately for posts, shorts and
// comments (src/utils/voteWeight.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSavedVoteWeight, saveVoteWeight, DEFAULT_VOTE_WEIGHT } from '../../../src/utils/voteWeight.js'

beforeEach(() => localStorage.clear())

describe('vote weight memory', () => {
  it('starts at 100% when nothing is stored', () => {
    expect(DEFAULT_VOTE_WEIGHT).toBe(100)
    expect(getSavedVoteWeight('post')).toBe(100)
  })

  it('remembers posts, shorts and comments separately', () => {
    saveVoteWeight('post', 100)
    saveVoteWeight('short', 20)
    saveVoteWeight('comment', 50)
    expect(getSavedVoteWeight('post')).toBe(100)
    expect(getSavedVoteWeight('short')).toBe(20)
    expect(getSavedVoteWeight('comment')).toBe(50)
  })

  it('an unknown kind shares the post slot', () => {
    saveVoteWeight('whatever', 42)
    expect(getSavedVoteWeight('post')).toBe(42)
    expect(getSavedVoteWeight(undefined)).toBe(42)
  })

  it('clamps to the slider range 1-100 and rounds', () => {
    saveVoteWeight('post', 250)
    expect(getSavedVoteWeight('post')).toBe(100)
    saveVoteWeight('post', 0)
    expect(getSavedVoteWeight('post')).toBe(1)
    saveVoteWeight('post', -40)
    expect(getSavedVoteWeight('post')).toBe(1)
    saveVoteWeight('post', 33.6)
    expect(getSavedVoteWeight('post')).toBe(34)
  })

  it('ignores a non-numeric weight instead of storing it', () => {
    saveVoteWeight('post', 30)
    saveVoteWeight('post', 'abc')
    saveVoteWeight('post', NaN)
    expect(getSavedVoteWeight('post')).toBe(30)
  })

  it('falls back to the default for a garbage or out-of-range stored value', () => {
    localStorage.setItem('3speak_vote_weight_post', 'nonsense')
    expect(getSavedVoteWeight('post')).toBe(100)
    localStorage.setItem('3speak_vote_weight_post', '500')
    expect(getSavedVoteWeight('post')).toBe(100)
  })

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(getSavedVoteWeight('short')).toBe(100)
    expect(() => saveVoteWeight('short', 10)).not.toThrow()
  })
})
