// A stream VOD's chat replay: the mirrored live-chat comments, the polls from
// the hangouts server, and the timeline they share.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ call: vi.fn() }) }))

const { parseChatReplay, replayTimeline, currentIndex, pollOutcome, fetchStreamPolls } = await import('../../../src/lib/streamChatReplay.js')

const mirrored = (author, text, at, permlink = `re-${at}`) => ({
  author, permlink, created: `2026-11-15T10:00:${String(at % 60).padStart(2, '0')}`,
  body: `${text}\n<br><sup>said at [00:${String(at).padStart(2, '0')}](https://3speak.tv/watch?v=badadib/s1) during the live stream</sup>`,
  json_metadata: JSON.stringify({ app: '3speak/new-version', parentTimestamp: at }),
})

describe('parseChatReplay', () => {
  it('keeps mirrored chat lines, strips the footer and sorts by time', () => {
    const lines = parseChatReplay([
      mirrored('fan', 'second', 20),
      mirrored('badadib', 'first', 5),
      { author: 'fan', permlink: 'c', body: 'a normal comment', json_metadata: '{"parentTimestamp":3}' },
      { author: 'fan', permlink: 'd', body: 'no time\n<br><sup>said at [00:01](x) during the live stream</sup>', json_metadata: '{}' },
      { ...mirrored('fan', '   ', 7) },
      { ...mirrored('fan', 'obj meta', 9), json_metadata: { parentTimestamp: 9.7 } },
      { ...mirrored('fan', 'bad meta', 1), json_metadata: '{oops' },
    ])
    expect(lines.map((l) => [l.user, l.text, l.offset])).toEqual([
      ['badadib', 'first', 5], ['fan', 'obj meta', 9], ['fan', 'second', 20],
    ])
    expect(lines[0].id).toBe('badadib/re-5')
    expect(parseChatReplay(null)).toEqual([])
  })
})

describe('the timeline', () => {
  const lines = [{ id: 'a', offset: 5 }, { id: 'b', offset: 30 }]
  const polls = [{ id: 'p', offset: 12, question: 'Q?', options: [] }, { id: 'q', offset: null, question: 'Early?', options: [] }]

  it('puts polls among the lines by stream time', () => {
    const items = replayTimeline(lines, polls)
    expect(items.map((i) => i.key)).toEqual(['poll-q', 'a', 'poll-p', 'b'])
  })

  it('finds the last item at or before the playhead', () => {
    const items = replayTimeline(lines, polls)
    expect(currentIndex(items, -1)).toBe(-1)
    expect(currentIndex(items, 5)).toBe(1)
    expect(currentIndex(items, 29)).toBe(2)
    expect(currentIndex(items, 999)).toBe(3)
    expect(currentIndex([], 10)).toBe(-1)
  })
})

describe('pollOutcome', () => {
  it('the resolved outcome, else the most votes, nothing for a cancelled or empty one', () => {
    expect(pollOutcome({ status: 'resolved', winner: 1, options: [{}, {}] })).toBe(1)
    expect(pollOutcome({ kind: 'poll', status: 'closed', options: [{ votes: 1 }, { votes: 4 }] })).toBe(1)
    expect(pollOutcome({ kind: 'prediction', status: 'closed', options: [{ points: 9 }, { points: 4 }] })).toBe(0)
    expect(pollOutcome({ status: 'cancelled', options: [{ votes: 3 }] })).toBeNull()
    expect(pollOutcome({ kind: 'poll', status: 'closed', options: [{ votes: 0 }] })).toBeNull()
  })
})

describe('fetchStreamPolls', () => {
  it('asks each deployment until one knows the stream', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.startsWith('https://a')) return { ok: false }
      if (url.startsWith('https://b')) return { ok: true, json: async () => ({ polls: [{ id: 'p', question: 'Q?', options: [] }, { bad: 1 }] }) }
      throw new Error('not reached')
    })
    vi.stubGlobal('fetch', fetchMock)
    const polls = await fetchStreamPolls('badadib-s1', [{ api: 'https://a' }, { api: 'https://b' }, { api: 'https://c' }])
    expect(polls.map((p) => p.id)).toEqual(['p'])
    expect(fetchMock).toHaveBeenCalledWith('https://b/rooms/badadib-s1/polls')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('nothing anywhere: an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchStreamPolls('x', [{ api: 'https://a' }])).toEqual([])
    vi.unstubAllGlobals()
  })
})
