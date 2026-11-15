// Collab posts (src/lib/collabs.js): the collaborator's beneficiary weight is a
// share of what the creator keeps and respects Hive's limits; registering a
// post retries while it propagates; answering carries the vouch.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(async (user) => ({ user, signature: 'SIG', timestamp: 7 })) }))
const lib = await import('../../../src/lib/collabs.js')

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async () => reply({ success: true, collaborators: ['fan'], invites: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('collabWeight', () => {
  it('a share of what is left after the other beneficiaries', () => {
    expect(lib.collabWeight([{ account: 'threespeakfund', weight: 1000 }, { account: 'encoder.pay', weight: 100 }], 50)).toBe(4450)
    expect(lib.collabWeight([], 25)).toBe(2500)
  })
  it('no room: Hive\'s 8 beneficiaries already used, or nothing left', () => {
    expect(lib.collabWeight(Array.from({ length: 8 }, (_, i) => ({ account: `a${i}`, weight: 100 })), 50)).toBeNull()
    expect(lib.collabWeight([{ account: 'x', weight: 10000 }], 50)).toBeNull()
  })
  it('collaboratorsOf reads the card field', () => {
    expect(lib.collaboratorsOf({ collaborators: ['fan', ''] })).toEqual(['fan'])
    expect(lib.collaboratorsOf({})).toEqual([])
  })
})

describe('checker calls', () => {
  it('registers a post, retrying while the post is not on Hive yet', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 404))
    expect(await lib.registerCollab('badadib', 'p1', { delayMs: 0 })).toEqual(['fan'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ author: 'badadib', permlink: 'p1' })
  })
  it('a refusal other than not-found stops at once', async () => {
    fetchMock.mockResolvedValue(reply({}, 400))
    expect(await lib.registerCollab('badadib', 'p1', { delayMs: 0 })).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('an answer carries the vouch', async () => {
    await lib.respondToCollab('fan', 'badadib', 'p1', true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/collabs\/respond$/)
    expect(JSON.parse(init.body)).toEqual({ author: 'badadib', permlink: 'p1', accept: true, user: 'fan', signature: 'SIG', timestamp: 7 })
  })
})
