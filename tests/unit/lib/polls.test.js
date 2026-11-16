// Polls (src/lib/polls.js) on the Hive Open Polls protocol: our metadata block
// and the protocol fields a poll snap carries, the percentages the bars show,
// a vote as a `polls` custom_json, and results read from the polls API
// (polls.hivehub.dev). fetch and the posting path are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cj = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('../../../src/hive-api/aioha', () => ({ customJsonWithAioha: (...a) => cj(...a) }))
const lib = await import('../../../src/lib/polls.js')

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
let fetchMock
beforeEach(() => {
  cj.mockClear()
  fetchMock = vi.fn(async () => reply([]))
  vi.stubGlobal('fetch', fetchMock)
})

describe('buildPollMeta', () => {
  const now = Date.parse('2026-11-15T10:00:00Z')
  it('2 to 4 distinct trimmed options and an end in days; a poll always ends', () => {
    expect(lib.buildPollMeta([' Music ', 'Code', ''], 3, now)).toEqual({ options: ['Music', 'Code'], ends_at: '2026-11-18T10:00:00.000Z' })
    expect(lib.buildPollMeta(['a', 'b'], 0, now).ends_at).toBe('2026-11-16T10:00:00.000Z')
    expect(lib.POLL_DURATIONS).not.toContain(0)
  })
  it('refuses one option, five, or duplicates', () => {
    expect(lib.buildPollMeta(['a'], 1)).toBeNull()
    expect(lib.buildPollMeta(['a', 'b', 'c', 'd', 'e'], 1)).toBeNull()
    expect(lib.buildPollMeta(['Yes', 'yes'], 1)).toBeNull()
  })
})

describe('openPollFields', () => {
  it('the protocol fields PeakD writes, from our block and the question', () => {
    const poll = { options: ['Music', 'Code'], ends_at: '2026-11-18T10:00:00.000Z' }
    expect(lib.openPollFields('  Which topic\nnext? ', poll)).toEqual({
      content_type: 'poll',
      version: 0.8,
      question: 'Which topic next?',
      choices: ['Music', 'Code'],
      preferred_interpretation: 'number_of_votes',
      end_time: Date.parse('2026-11-18T10:00:00Z') / 1000,
      max_choices_voted: 1,
      allow_vote_changes: true,
      filters: { account_age: 0 },
      ui_hide_res_until_voted: true,
      community_membership: [],
    })
    expect(lib.openPollFields('q', null)).toEqual({})
  })
})

describe('percents', () => {
  it('whole numbers that add up to 100', () => {
    expect(lib.percents([1, 1, 1])).toEqual([34, 33, 33])
    expect(lib.percents([0, 0])).toEqual([0, 0])
    expect(lib.percents([3, 1]).reduce((a, b) => a + b)).toBe(100)
  })
})

describe('on Hive and the polls API', () => {
  const row = {
    status: 'Active', end_time: '2026-11-18T10:00:00',
    poll_choices: [{ choice_num: 2, votes: { total_votes: 3 } }, { choice_num: 1, votes: { total_votes: 1 } }],
    poll_voters: [{ name: 'fan', choices: [2] }],
  }

  it('a vote is a polls custom_json with the choice counted from 1', async () => {
    await lib.votePoll('badadib', 'poll-1', 1)
    expect(cj).toHaveBeenCalledWith('posting', 'polls', JSON.stringify({ poll: 'badadib/poll-1', action: 'vote', choices: [2] }), 'Vote in a poll')
  })

  it('a rejected broadcast is an error', async () => {
    cj.mockResolvedValueOnce({ success: false })
    await expect(lib.votePoll('badadib', 'poll-1', 0)).rejects.toThrow()
  })

  it('reads one poll by author and permlink, null until the API has it', async () => {
    expect(await lib.fetchOpenPoll('badadib', 'poll-1')).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe('https://polls.hivehub.dev/rpc/poll?author=eq.badadib&permlink=eq.poll-1')
  })

  it('turns the API row into counts per option, the total and the viewer\'s vote', () => {
    expect(lib.resultFromApi(row, 2, 'fan')).toEqual({ counts: [1, 3], total: 4, closed: false, ends_at: '2026-11-18T10:00:00Z', mine: 1 })
    expect(lib.resultFromApi(row, 2, 'someone').mine).toBeNull()
    expect(lib.resultFromApi({ ...row, status: 'Ended' }, 2, null).closed).toBe(true)
    expect(lib.resultFromApi(null, 3, 'fan')).toEqual({ counts: [0, 0, 0], total: 0, closed: false, ends_at: null, mine: null })
  })

  it('a vote shows at once: moved from the old choice to the new one', () => {
    const before = { counts: [1, 3], total: 4, closed: false, mine: 1 }
    expect(lib.withVote(before, 0)).toMatchObject({ counts: [2, 2], total: 4, mine: 0 })
    expect(lib.withVote({ counts: [0, 0], total: 0, mine: null }, 1)).toMatchObject({ counts: [0, 1], total: 1, mine: 1 })
  })

  it('a creator\'s polls, newest first, with options in choice order', async () => {
    fetchMock.mockResolvedValueOnce(reply([{ ...row, author: 'badadib', permlink: 'poll-1', question: 'Which?', poll_choices: [
      { choice_num: 2, choice_text: 'Code', votes: { total_votes: 3 } }, { choice_num: 1, choice_text: 'Music', votes: { total_votes: 1 } },
    ] }]))
    const [p] = await lib.fetchCreatorPolls('badadib')
    expect(fetchMock.mock.calls[0][0]).toBe('https://polls.hivehub.dev/rpc/poll?author=eq.badadib&order=created.desc&limit=20')
    expect(p).toEqual({ key: 'badadib/poll-1', author: 'badadib', permlink: 'poll-1', question: 'Which?', options: ['Music', 'Code'], counts: [1, 3], total: 4, closed: false })
  })
})

describe('polls on posts, Shorts and comments', () => {
  it('reads the poll a post carries: ours, else the protocol fields (PeakD, Ecency)', () => {
    expect(lib.pollFromMeta({ poll: { options: ['A', 'B'], ends_at: '2026-11-18T10:00:00.000Z' } })).toEqual({ options: ['A', 'B'], ends_at: '2026-11-18T10:00:00.000Z' })
    expect(lib.pollFromMeta(JSON.stringify({ content_type: 'poll', choices: ['si', 'no'], end_time: 1795389312 })))
      .toEqual({ options: ['si', 'no'], ends_at: new Date(1795389312 * 1000).toISOString() })
    expect(lib.pollFromMeta({ app: '3speak/new-version' })).toBeNull()
    expect(lib.pollFromMeta({ content_type: 'poll', choices: ['only one'] })).toBeNull()
    expect(lib.pollFromMeta('not json')).toBeNull()
    expect(lib.pollQuestionFromMeta({ question: 'Which?' })).toBe('Which?')
    expect(lib.pollQuestionFromMeta(null)).toBe('')
  })

  it('finds the polls among loaded Shorts in one request', async () => {
    fetchMock.mockResolvedValueOnce(reply([
      { author: 'badadib', permlink: 's1', question: 'Cats?', end_time: '2026-11-18T10:00:00', poll_choices: [{ choice_num: 2, choice_text: 'No' }, { choice_num: 1, choice_text: 'Yes' }] },
      { author: 'someone-else', permlink: 's2', question: 'x', poll_choices: [] },
    ]))
    const found = await lib.fetchPollsAmong([{ author: 'badadib', permlink: 's1' }, { author: 'badadib', permlink: 's2' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toBe('https://polls.hivehub.dev/rpc/poll?permlink=in.("s1","s2")')
    // only the ones asked for, by author too
    expect([...found.keys()]).toEqual(['badadib/s1'])
    expect(found.get('badadib/s1')).toEqual({ poll: { options: ['Yes', 'No'], ends_at: '2026-11-18T10:00:00Z' }, question: 'Cats?' })
    expect(await lib.fetchPollsAmong([])).toEqual(new Map())
  })
})
