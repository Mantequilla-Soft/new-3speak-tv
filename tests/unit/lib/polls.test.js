// Polls (src/lib/polls.js): the metadata block a poll snap carries, the
// percentages the bars show, and the checker calls (vote with the vouch,
// results with it only when signed in). fetch and the vouch are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(async (user) => ({ user, signature: 'SIG', timestamp: 7 })) }))
const lib = await import('../../../src/lib/polls.js')

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => reply({ success: true, results: {}, result: { counts: [1, 0], total: 1, closed: false, mine: 0 } }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('buildPollMeta', () => {
  const now = Date.parse('2026-11-15T10:00:00Z')
  it('2 to 4 distinct trimmed options and an end in days', () => {
    expect(lib.buildPollMeta([' Music ', 'Code', ''], 3, now)).toEqual({ options: ['Music', 'Code'], ends_at: '2026-11-18T10:00:00.000Z' })
    expect(lib.buildPollMeta(['a', 'b'], 0, now).ends_at).toBeNull()
  })
  it('refuses one option, five, or duplicates', () => {
    expect(lib.buildPollMeta(['a'], 1)).toBeNull()
    expect(lib.buildPollMeta(['a', 'b', 'c', 'd', 'e'], 1)).toBeNull()
    expect(lib.buildPollMeta(['Yes', 'yes'], 1)).toBeNull()
  })
})

describe('percents', () => {
  it('whole numbers that add up to 100', () => {
    expect(lib.percents([1, 1, 1])).toEqual([34, 33, 33])
    expect(lib.percents([0, 0])).toEqual([0, 0])
    expect(lib.percents([3, 1]).reduce((a, b) => a + b)).toBe(100)
  })
})

describe('checker calls', () => {
  it('a vote carries the vouch', async () => {
    await lib.votePoll('fan', 'badadib', 'poll-1', 1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ user: 'fan', author: 'badadib', permlink: 'poll-1', choice: 1, signature: 'SIG', timestamp: 7 })
  })
  it('a closed poll says so', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 409))
    await expect(lib.votePoll('fan', 'badadib', 'p', 0)).rejects.toMatchObject({ code: 'closed' })
  })
  it('results are asked without a vouch when signed out', async () => {
    await lib.fetchPollResults(['badadib/p'], null)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ keys: ['badadib/p'] })
  })
})
