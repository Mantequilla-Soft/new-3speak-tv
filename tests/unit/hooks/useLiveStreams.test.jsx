// Live streams shown as feed cards (src/hooks/useLiveStreams.js): only live
// sessions, Hive-only rooms hidden from guests, excluded hosts left out of
// discovery feeds, the Follow feed limited to followed hosts, and a refresh every
// 30 seconds that stops on unmount.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const store = vi.hoisted(() => ({ user: 'badadib', authenticated: true }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(store) }))
const deps = vi.hoisted(() => ({ fetchAllEndpoints: vi.fn(), getFollowing: vi.fn() }))
vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ fetchAllEndpoints: (...a) => deps.fetchAllEndpoints(...a) }))
vi.mock('../../../src/utils/hiveUtils', () => ({ getFollowing: (...a) => deps.getFollowing(...a) }))
vi.mock('../../../src/utils/config', () => ({ FEED_EXCLUDED_HOSTS: new Set(['spam.host']) }))
const { useLiveStreams } = await import('../../../src/hooks/useLiveStreams.js')

const room = (over) => ({ live: true, name: 'r1', host: 'badadib', title: 'Live!', thumbnail: 't.jpg', createdAt: 'c', viewers: 4, visibility: 'public', ...over })
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const names = (r) => r.current.map((s) => s.roomName)

beforeEach(() => {
  vi.useFakeTimers()
  store.user = 'badadib'
  store.authenticated = true
  deps.fetchAllEndpoints.mockReset().mockResolvedValue([])
  deps.getFollowing.mockReset().mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('useLiveStreams', () => {
  it('maps a live stream to a Card3 tile', async () => {
    deps.fetchAllEndpoints.mockResolvedValue([room()])
    const { result } = renderHook(() => useLiveStreams())
    await flush()
    expect(deps.fetchAllEndpoints).toHaveBeenCalledWith('/streams')
    expect(result.current).toEqual([{
      _liveStream: true, _openpodRoom: false, roomName: 'r1', permlink: 'r1', author: 'badadib', owner: 'badadib',
      title: 'Live!', thumbnail: 't.jpg', created_at: 'c', views: 4,
    }])
  })

  it('marks a conference as an OpenPods room and counts no viewers as 0', async () => {
    deps.fetchAllEndpoints.mockResolvedValue([room({ mode: 'conference', viewers: undefined })])
    const { result } = renderHook(() => useLiveStreams())
    await flush()
    expect(result.current[0]).toMatchObject({ _openpodRoom: true, views: 0 })
  })

  it('leaves out streams that are not live, and a malformed answer is empty', async () => {
    deps.fetchAllEndpoints.mockResolvedValueOnce([room({ name: 'on' }), room({ name: 'off', live: false })])
    const { result } = renderHook(() => useLiveStreams())
    await flush()
    expect(names(result)).toEqual(['on'])
    deps.fetchAllEndpoints.mockResolvedValueOnce({ error: 'x' })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(result.current).toEqual([])
  })

  it('with standby, keeps rooms that are open but not live yet, marked _standby', async () => {
    deps.fetchAllEndpoints.mockResolvedValue([room({ name: 'on' }), room({ name: 'off', live: false })])
    const { result } = renderHook(() => useLiveStreams({ standby: true }))
    await flush()
    expect(result.current.map((s) => [s.roomName, s._standby])).toEqual([['on', false], ['off', true]])
  })

  it('hides Hive-only rooms from guests', async () => {
    store.authenticated = false
    deps.fetchAllEndpoints.mockResolvedValue([room({ name: 'pub' }), room({ name: 'hive', visibility: 'hive-internal' })])
    const { result } = renderHook(() => useLiveStreams())
    await flush()
    expect(names(result)).toEqual(['pub'])
  })

  it('keeps excluded hosts out of discovery feeds but not out of the pager', async () => {
    deps.fetchAllEndpoints.mockResolvedValue([room({ name: 'ok' }), room({ name: 'spam', host: 'SPAM.host' })])
    const feed = renderHook(() => useLiveStreams())
    const pager = renderHook(() => useLiveStreams({ includeAllHosts: true }))
    await flush()
    expect(names(feed.result)).toEqual(['ok'])
    expect(names(pager.result)).toEqual(['ok', 'spam'])
  })

  it('the Follow feed shows only followed hosts, and nothing until the list loads', async () => {
    let resolveFollowing
    deps.getFollowing.mockImplementation(() => new Promise((r) => { resolveFollowing = r }))
    deps.fetchAllEndpoints.mockResolvedValue([room({ name: 'a', host: 'alice' }), room({ name: 'b', host: 'bob' })])
    const { result } = renderHook(() => useLiveStreams({ following: true }))
    await flush()
    expect(result.current).toEqual([])
    expect(deps.getFollowing).toHaveBeenCalledWith('badadib', '', 1000)
    await act(async () => { resolveFollowing(['bob']) })
    expect(names(result)).toEqual(['b'])
  })

  it('the Follow feed is empty for a guest or when the follow list fails', async () => {
    deps.fetchAllEndpoints.mockResolvedValue([room()])
    deps.getFollowing.mockRejectedValue(new Error('node down'))
    const signedIn = renderHook(() => useLiveStreams({ following: true }))
    store.user = null
    const guest = renderHook(() => useLiveStreams({ following: true }))
    await flush()
    expect(signedIn.result.current).toEqual([])
    expect(guest.result.current).toEqual([])
  })

  it('a failed refresh empties the list rather than showing stale streams', async () => {
    deps.fetchAllEndpoints.mockResolvedValueOnce([room()]).mockRejectedValueOnce(new Error('down'))
    const { result } = renderHook(() => useLiveStreams())
    await flush()
    expect(result.current).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(result.current).toEqual([])
  })

  it('stops refreshing once unmounted', async () => {
    const { unmount } = renderHook(() => useLiveStreams())
    await flush()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(90000) })
    expect(deps.fetchAllEndpoints).toHaveBeenCalledTimes(1)
  })
})
