// The query string every checker discovery feed appends (src/utils/feedParams.js).
import { describe, it, expect, vi } from 'vitest'

const store = vi.hoisted(() => ({ state: {} }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => store.state } }))

const { feedParams } = await import('../../../src/utils/feedParams.js')

const withState = (s) => { store.state = s; return feedParams() }

describe('feedParams', () => {
  it('is empty for a logged-out visitor with no interests', () => {
    expect(withState({})).toBe('')
    expect(withState({ interests: [], user: null })).toBe('')
  })

  it('sends the interests as one comma list', () => {
    expect(withState({ interests: ['music', 'film-tv'] })).toBe('&interests=music%2Cfilm-tv')
  })

  it('always sends currentuser when logged in, with hide-watched spelled out either way', () => {
    expect(withState({ user: 'alice', hideWatched: true })).toBe('&currentuser=alice&hidewatched=1')
    expect(withState({ user: 'alice', hideWatched: false })).toBe('&currentuser=alice&hidewatched=0')
    expect(withState({ user: 'alice' })).toBe('&currentuser=alice&hidewatched=0')
  })

  it('does not send hide-watched without a user', () => {
    expect(withState({ hideWatched: true })).toBe('')
  })

  it('asks for newest-first when the simple feed is on', () => {
    expect(withState({ simpleFeed: true })).toBe('&chrono=1')
    expect(withState({ interests: ['news'], user: 'bob', hideWatched: true, simpleFeed: true }))
      .toBe('&interests=news&currentuser=bob&hidewatched=1&chrono=1')
  })

  it('encodes values so they cannot add parameters', () => {
    expect(withState({ user: 'a&b=c', interests: ['x&y'] })).toBe('&interests=x%26y&currentuser=a%26b%3Dc&hidewatched=0')
  })

  it('ignores interests that are not a list', () => {
    expect(withState({ interests: 'music' })).toBe('')
  })
})
