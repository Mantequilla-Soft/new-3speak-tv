// @vitest-environment jsdom
// The weekly Shorts challenge client (lib/shortsChallenge.js): weeks and tags,
// the theme in the reader's language, joining, and the checker calls (themes
// and entries live in the checker's Mongo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  weekIdOf, tagOf, challengeText, rememberJoin, takeJoin, withChallengeTag,
  fetchChallenges, fetchChallenge, fetchChallengeEntries,
} from '../../../src/lib/shortsChallenge'

const CH = {
  week: '2026-W48', tag: 'challenge2026w48', theme: 'workspace',
  texts: { en: { title: 'Your workspace', prompt: 'Show where you create.' }, pt: { title: 'Seu espaço', prompt: 'Mostre onde você cria.' } },
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

const stubFetch = (status, body) => {
  const f = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
  vi.stubGlobal('fetch', f)
  return f
}

describe('weeks and tags', () => {
  it('weeks run Sunday to Saturday in UTC, named after the ISO week of their Monday', () => {
    expect(weekIdOf(new Date('2026-11-21T23:59:59Z'))).toBe('2026-W47') // Saturday
    expect(weekIdOf(new Date('2026-11-22T00:00:00Z'))).toBe('2026-W48') // Sunday
    expect(weekIdOf(new Date('2026-11-28T23:59:59Z'))).toBe('2026-W48') // Saturday
    expect(weekIdOf(new Date('2026-11-29T00:00:00Z'))).toBe('2026-W49')
    expect(weekIdOf(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')
    expect(weekIdOf(new Date('2027-01-03T00:00:00Z'))).toBe('2027-W01')
  })
  it('gives each week its own tag', () => {
    expect(tagOf('2026-W48')).toBe('challenge2026w48')
  })
})

describe('challengeText', () => {
  it('the reader\'s language, then its base language, then English', () => {
    expect(challengeText(CH, 'title', 'pt')).toBe('Seu espaço')
    expect(challengeText(CH, 'title', 'pt-BR')).toBe('Seu espaço')
    expect(challengeText(CH, 'prompt', 'de')).toBe('Show where you create.')
    expect(challengeText(null, 'title', 'en')).toBe('')
  })
})

describe('joining', () => {
  it('adds and removes only the week\'s tag, keeping the others in order', () => {
    expect(withChallengeTag(['a', 'b'], '2026-W48', true)).toEqual(['a', 'b', 'challenge2026w48'])
    expect(withChallengeTag(['challenge2026w48', 'a'], '2026-W48', true)).toEqual(['a', 'challenge2026w48'])
    expect(withChallengeTag(['a', 'challenge2026w48', 'b'], '2026-W48', false)).toEqual(['a', 'b'])
    expect(withChallengeTag(undefined, '2026-W48', false)).toEqual([])
  })
  it('"Join with a Short" is remembered once, for that week only', () => {
    rememberJoin('2026-W48')
    expect(takeJoin('2026-W49')).toBe(false)
    expect(takeJoin('2026-W48')).toBe(false)
    rememberJoin('2026-W48')
    expect(takeJoin('2026-W48')).toBe(true)
    expect(takeJoin('2026-W48')).toBe(false)
  })
})

describe('checker calls', () => {
  it('this week, next week and the weeks before', async () => {
    const f = stubFetch(200, { success: true, week: '2026-W48', current: CH, next: null, past: [] })
    expect(await fetchChallenges()).toEqual({ week: '2026-W48', current: CH, next: null, past: [] })
    expect(f.mock.calls[0][0]).toMatch(/\/shorts-challenges$/)
  })
  it('one week; none that week is null, not an error', async () => {
    stubFetch(200, { success: true, challenge: CH })
    expect(await fetchChallenge('2026-W48')).toEqual(CH)
    stubFetch(404, { success: false })
    expect(await fetchChallenge('2031-W02')).toBeNull()
  })
  it('the checked entries of a week, paged', async () => {
    const f = stubFetch(200, { total: 1, totalPages: 1, videos: [{ author: 'badadib', permlink: 'one' }] })
    expect(await fetchChallengeEntries('2026-W48', { page: 2, limit: 10 })).toEqual({ total: 1, totalPages: 1, videos: [{ author: 'badadib', permlink: 'one' }] })
    expect(f.mock.calls[0][0]).toMatch(/\/shorts-challenges\/2026-W48\/entries\?page=2&limit=10$/)
  })
  it('a checker error is an error', async () => {
    stubFetch(500, {})
    await expect(fetchChallenges()).rejects.toThrow(/checker 500/)
  })
})
