// Comment inbox data (src/lib/commentInbox.js): the vouched checker calls and
// the filters the inbox page offers.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionVouch = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch }))
const { fetchCommentInbox, setCommentDone, filterInbox, flagCounts } = await import('../../../src/lib/commentInbox.js')

const C = 'https://checker.3speak.tv'
const item = (permlink, over = {}) => ({ author: 'fan', permlink, answered: false, done: false, question: false, firstTime: false, supporter: false, ...over })

beforeEach(() => {
  sessionVouch.mockReset()
  sessionVouch.mockResolvedValue({ user: 'badadib', signature: 'sig', timestamp: 123 })
})

describe('checker calls', () => {
  it('lists with the session vouch in the body', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, days: 90, items: [item('a')] }) })
    vi.stubGlobal('fetch', f)
    const r = await fetchCommentInbox('badadib')
    expect(r).toEqual({ days: 90, items: [item('a')] })
    expect(f).toHaveBeenCalledWith(`${C}/creator-inbox`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ user: 'badadib', signature: 'sig', timestamp: 123 }) }))
  })

  it('marks done and undone', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', f)
    await setCommentDone('badadib', 'fan', 're-1', false)
    expect(f.mock.calls[0][0]).toBe(`${C}/creator-inbox/done`)
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ user: 'badadib', signature: 'sig', timestamp: 123, author: 'fan', permlink: 're-1', done: false })
  })

  it('without a session nothing is asked', async () => {
    sessionVouch.mockResolvedValue(null)
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(fetchCommentInbox('badadib')).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })

  it('a checker error is an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(fetchCommentInbox('badadib')).rejects.toThrow('503')
  })
})

describe('filters', () => {
  const items = [
    item('a', { question: true }),
    item('b', { answered: true, supporter: true }),
    item('c', { done: true, question: true }),
    item('d', { firstTime: true, question: true, supporter: true }),
  ]

  it('unanswered (default) leaves out answered and done ones', () => {
    expect(filterInbox(items).map((i) => i.permlink)).toEqual(['a', 'd'])
  })

  it('all is everything not done; done is only the done ones', () => {
    expect(filterInbox(items, { view: 'all' }).map((i) => i.permlink)).toEqual(['a', 'b', 'd'])
    expect(filterInbox(items, { view: 'done' }).map((i) => i.permlink)).toEqual(['c'])
  })

  it('every picked flag has to hold', () => {
    expect(filterInbox(items, { view: 'all', flags: ['supporter'] }).map((i) => i.permlink)).toEqual(['b', 'd'])
    expect(filterInbox(items, { view: 'all', flags: ['supporter', 'question'] }).map((i) => i.permlink)).toEqual(['d'])
  })

  it('the chips count within the view', () => {
    expect(flagCounts(items, 'unanswered')).toEqual({ question: 2, firstTime: 1, supporter: 1 })
  })
})
