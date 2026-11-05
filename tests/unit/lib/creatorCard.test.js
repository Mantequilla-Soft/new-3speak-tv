// The stories row's creator hover card (src/lib/creatorCard.js): its queries
// share keys and URLs with the profile page, so both read one cached request.
// axios and the Hive client are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), call: vi.fn() }))
vi.mock('axios', () => ({ default: { get: h.get } }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ call: h.call }) }))

import {
  profileCountsQuery, audioCountQuery, hiveProfileQuery, newestShortQuery, creatorCardQueries,
} from '../../../src/lib/creatorCard.js'

beforeEach(() => {
  h.get.mockReset().mockResolvedValue({ data: { ok: 1 } })
  h.call.mockReset()
})

describe('query options', () => {
  it.each([
    [profileCountsQuery, ['profile-counts', 'a b']],
    [audioCountQuery, ['audio-count', 'a b']],
    [hiveProfileQuery, ['creator-card-profile', 'a b']],
    [newestShortQuery, ['creator-card-newest-short', 'a b']],
  ])('%o is keyed by user, cached five minutes, retried once', (build, key) => {
    expect(build('a b')).toMatchObject({ queryKey: key, enabled: true, staleTime: 300000, retry: 1 })
    expect(build('').enabled).toBe(false)
  })

  it('counts and audio read the same checker URLs as the profile page', async () => {
    expect(await profileCountsQuery('a b').queryFn()).toEqual({ ok: 1 })
    await audioCountQuery('a b').queryFn()
    expect(h.get.mock.calls.map((c) => c[0])).toEqual([
      'https://checker.example/user/a%20b/counts',
      'https://checker.example/audio?owner=a%20b&limit=1',
    ])
  })
})

describe('hiveProfileQuery', () => {
  it('reads name, bio, reputation and followers from bridge', async () => {
    h.call.mockResolvedValue({ metadata: { profile: { name: ' Alice ', about: ' Hi ' } }, reputation: 63.9, stats: { followers: '120' } })
    expect(await hiveProfileQuery('alice').queryFn()).toEqual({ name: 'Alice', about: 'Hi', reputation: 63, followers: 120 })
    expect(h.call).toHaveBeenCalledWith('bridge', 'get_profile', { account: 'alice' })
  })

  it.each([
    ['an empty profile', {}],
    ['no profile at all', null],
    ['a zero reputation', { reputation: 0 }],
  ])('has safe defaults for %s', async (_name, p) => {
    h.call.mockResolvedValue(p)
    expect(await hiveProfileQuery('alice').queryFn()).toEqual({ name: '', about: '', reputation: null, followers: 0 })
  })
})

describe('newestShortQuery', () => {
  it('returns when the newest short went up, or null', async () => {
    h.get.mockResolvedValueOnce({ data: { shorts: [{ createdAt: '2026-11-01' }] } }).mockResolvedValueOnce({ data: {} })
    expect(await newestShortQuery('alice').queryFn()).toBe('2026-11-01')
    expect(await newestShortQuery('alice').queryFn()).toBeNull()
    expect(h.get).toHaveBeenCalledWith('https://checker.example/shorts/alice', { params: { limit: 1 } })
  })
})

describe('creatorCardQueries', () => {
  it('a plain creator also asks for the newest short; a story creator does not', () => {
    expect(creatorCardQueries('alice').map((q) => q.queryKey[0])).toEqual(['creator-card-profile', 'profile-counts', 'audio-count', 'creator-card-newest-short'])
    expect(creatorCardQueries('alice', { story: true })).toHaveLength(3)
  })
})
