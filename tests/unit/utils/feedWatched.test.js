// Dropping a just-watched video out of the loaded feeds, in place
// (src/utils/feedWatched.js), and the per-page-load watched shorts filter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const store = vi.hoisted(() => ({ state: {} }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: { getState: () => store.state } }))

const load = async () => {
  vi.resetModules()
  return import('../../../src/utils/feedWatched.js')
}

const v = (author, permlink, extra = {}) => ({ author, permlink, ...extra })

beforeEach(() => { store.state = { hideWatched: true, watchHistoryEnabled: true } })

describe('dropWatchedFromFeeds', () => {
  const seed = () => {
    const qc = new QueryClient()
    qc.setQueryData(['home-grouped'], { pages: [[v('alice', 'one'), v('bob', 'two')], [v('carol', 'three')]], pageParams: [0, 1] })
    qc.setQueryData(['trending', 'week'], [v('alice', 'one'), v('dave', 'four')])
    qc.setQueryData(['newcontent-grouped'], [v('alice', 'one')])
    qc.setQueryData(['featured'], [v('alice', 'one'), v('erin', 'five')])
    qc.setQueryData(['comments', 'alice/one'], [v('alice', 'one')])
    return qc
  }

  it('removes the watched video from every hide-watched feed and leaves the rest in place', async () => {
    const { dropWatchedFromFeeds } = await load()
    const qc = seed()
    dropWatchedFromFeeds(qc, { author: 'Alice', permlink: 'ONE' })
    expect(qc.getQueryData(['home-grouped']).pages).toEqual([[v('bob', 'two')], [v('carol', 'three')]])
    expect(qc.getQueryData(['home-grouped']).pageParams).toEqual([0, 1])
    expect(qc.getQueryData(['trending', 'week'])).toEqual([v('dave', 'four')])
    expect(qc.getQueryData(['featured'])).toEqual([v('erin', 'five')])
  })

  it('never touches the New feed or caches that are not feeds', async () => {
    const { dropWatchedFromFeeds } = await load()
    const qc = seed()
    dropWatchedFromFeeds(qc, { author: 'alice', permlink: 'one' })
    expect(qc.getQueryData(['newcontent-grouped'])).toEqual([v('alice', 'one')])
    expect(qc.getQueryData(['comments', 'alice/one'])).toEqual([v('alice', 'one')])
  })

  it('with hide-watched off only the featured video moves on', async () => {
    store.state = { hideWatched: false }
    const { dropWatchedFromFeeds } = await load()
    const qc = seed()
    dropWatchedFromFeeds(qc, { author: 'alice', permlink: 'one' })
    expect(qc.getQueryData(['featured'])).toEqual([v('erin', 'five')])
    expect(qc.getQueryData(['trending', 'week'])).toHaveLength(2)
  })

  it('with watch history off nothing but the featured video changes', async () => {
    store.state = { hideWatched: true, watchHistoryEnabled: false }
    const { dropWatchedFromFeeds } = await load()
    const qc = seed()
    dropWatchedFromFeeds(qc, { author: 'alice', permlink: 'one' })
    expect(qc.getQueryData(['trending', 'week'])).toHaveLength(2)
  })

  it('matches an embed by its uploader as well as its Hive author', async () => {
    const { dropWatchedFromFeeds } = await load()
    const qc = new QueryClient()
    qc.setQueryData(['discover-grouped'], [v('hive-author', 'clip', { owner: 'uploader' }), v('uploader', 'other')])
    dropWatchedFromFeeds(qc, { author: 'uploader', permlink: 'clip' })
    expect(qc.getQueryData(['discover-grouped'])).toEqual([v('uploader', 'other')])
  })

  it('never removes another video by the same creator', async () => {
    const { dropWatchedFromFeeds } = await load()
    const qc = new QueryClient()
    qc.setQueryData(['trending'], [v('alice', 'two'), v('bob', 'one')])
    dropWatchedFromFeeds(qc, { author: 'alice', permlink: 'one' })
    expect(qc.getQueryData(['trending'])).toHaveLength(2)
  })

  it('keeps the same data object when nothing matched, so nothing re-renders', async () => {
    const { dropWatchedFromFeeds } = await load()
    const qc = seed()
    const before = qc.getQueryData(['home-grouped'])
    const list = qc.getQueryData(['trending', 'week'])
    dropWatchedFromFeeds(qc, { author: 'zed', permlink: 'nope' })
    expect(qc.getQueryData(['home-grouped'])).toBe(before)
    expect(qc.getQueryData(['trending', 'week'])).toBe(list)
  })

  it('does nothing without a client, author or permlink', async () => {
    const { dropWatchedFromFeeds } = await load()
    const qc = seed()
    expect(() => dropWatchedFromFeeds(null, { author: 'alice', permlink: 'one' })).not.toThrow()
    dropWatchedFromFeeds(qc, { author: 'alice' })
    dropWatchedFromFeeds(qc)
    expect(qc.getQueryData(['trending', 'week'])).toHaveLength(2)
  })
})

describe('dropWatchedShorts', () => {
  it('drops shorts watched this page load, by asset or Hive permlink', async () => {
    const { rememberWatchedShort, dropWatchedShorts } = await load()
    rememberWatchedShort({ author: 'Alice', permlink: 'asset1', hivePermlink: 'hive1' })
    const list = [v('alice', 'asset1'), v('alice', 'x', { hivePermlink: 'hive1' }), v('bob', 'asset1'), v('carol', 'c')]
    expect(dropWatchedShorts(list)).toEqual([v('bob', 'asset1'), v('carol', 'c')])
  })

  it('never empties a first page, but may empty a later one', async () => {
    const { rememberWatchedShort, dropWatchedShorts } = await load()
    rememberWatchedShort({ author: 'alice', permlink: 'a' })
    const list = [v('alice', 'a')]
    expect(dropWatchedShorts(list)).toBe(list)
    expect(dropWatchedShorts(list, { allowEmpty: true })).toEqual([])
  })

  it('leaves the list alone with hide-watched off or nothing watched', async () => {
    let m = await load()
    const list = [v('alice', 'a'), v('bob', 'b')]
    expect(m.dropWatchedShorts(list)).toBe(list)
    m.rememberWatchedShort({ author: 'alice', permlink: 'a' })
    store.state = { hideWatched: false }
    expect(m.dropWatchedShorts(list)).toBe(list)
    m = await load()
    expect(m.dropWatchedShorts(null)).toBeNull()
    expect(m.dropWatchedShorts([])).toEqual([])
  })

  it('ignores a watch without an author', async () => {
    const { rememberWatchedShort, dropWatchedShorts } = await load()
    rememberWatchedShort({ permlink: 'a' })
    const list = [v('', 'a'), v('bob', 'b')]
    expect(dropWatchedShorts(list)).toBe(list)
  })
})
