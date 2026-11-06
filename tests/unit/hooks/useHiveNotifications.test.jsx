// Hive notifications (src/hooks/useHiveNotifications.js): the list and the
// on-chain unread count from bridge, paging further back, polling every minute
// and on tab focus, and marking read with the same `notify` / setLastRead
// custom_json every Hive frontend uses (the exact operation handed to the signer
// is checked; nothing is broadcast).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const http = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: http }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://node.test' }))
vi.mock('../../../src/utils/config', () => ({ HIVE_API_URL: 'https://hive.test' }))
const signer = vi.hoisted(() => ({ customJsonWithAioha: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ customJsonWithAioha: (...a) => signer.customJsonWithAioha(...a) }))
vi.mock('@aioha/aioha', () => ({ KeyTypes: { Posting: 'posting', Active: 'active' } }))
const { useHiveNotifications, NOTIF_CATEGORIES } = await import('../../../src/hooks/useHiveNotifications.js')

const NOW = new Date('2026-11-05T18:00:00Z')
const notif = (id, date, type = 'vote') => ({ id, type, date, msg: `n${id}`, url: '@badadib/p' })
let pages
let unread

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const rpc = (method) => http.post.mock.calls.filter(([, body]) => body.method === method)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  pages = { first: [notif(3, '2026-11-05T17:04:21'), notif(2, '2026-11-05T16:00:00'), notif(1, '2026-11-04T10:00:00')], older: [] }
  unread = { lastread: '2026-11-05T15:00:00', unread: 2 }
  http.post.mockReset().mockImplementation(async (_url, body) => {
    if (body.method === 'bridge.unread_notifications') return { data: { result: unread } }
    return { data: { result: body.params.last_id ? pages.older : pages.first } }
  })
  signer.customJsonWithAioha.mockReset().mockResolvedValue({ success: true })
})
afterEach(() => vi.useRealTimers())

describe('the filter categories', () => {
  it('group the bridge types', () => {
    expect(NOTIF_CATEGORIES.replies.types).toEqual(['reply', 'reply_comment'])
    expect(NOTIF_CATEGORIES.all.types).toBeNull()
  })
})

describe('loading', () => {
  it('reads the notifications and the unread state for the account', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib', { limit: 3 }))
    expect(result.current.loading).toBe(true)
    await flush()
    expect(rpc('bridge.account_notifications')[0][1]).toEqual({ jsonrpc: '2.0', method: 'bridge.account_notifications', params: { account: 'badadib', limit: 3 }, id: 1 })
    expect(rpc('bridge.unread_notifications')[0][1].params).toEqual({ account: 'badadib' })
    expect(result.current).toMatchObject({ loading: false, hasMore: true, unreadCount: 2, lastRead: '2026-11-05T15:00:00', error: null })
    expect(result.current.notifications.map((n) => n.id)).toEqual([3, 2, 1])
  })

  it('fewer than a page means there is nothing older', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    expect(result.current.hasMore).toBe(false)
  })

  it('a node error is surfaced and the list stays empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    http.post.mockImplementation(async (_u, body) => (body.method === 'bridge.account_notifications'
      ? { data: { error: { message: 'Internal Error' } } } : { data: { result: unread } }))
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    expect(result.current.error).toEqual(new Error('Internal Error'))
    expect(result.current).toMatchObject({ notifications: [], loading: false })
  })

  it('a failed unread read keeps the defaults', async () => {
    http.post.mockImplementation(async (_u, body) => {
      if (body.method === 'bridge.unread_notifications') throw new Error('down')
      return { data: { result: [] } }
    })
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    expect(result.current).toMatchObject({ unreadCount: 0, lastRead: '1970-01-01T00:00:00' })
  })

  it('nobody signed in asks nothing', async () => {
    const { result } = renderHook(() => useHiveNotifications(null))
    await flush()
    expect(http.post).not.toHaveBeenCalled()
    expect(result.current.notifications).toEqual([])
    await act(async () => { await result.current.refetch() })
    expect(http.post).not.toHaveBeenCalled()
  })

  it('switching account starts over, and the old account\'s answer is dropped', async () => {
    let slow
    http.post.mockImplementationOnce(() => new Promise((r) => { slow = r }))
    const { result, rerender } = renderHook(({ u }) => useHiveNotifications(u, { poll: false }), { initialProps: { u: 'badadib' } })
    rerender({ u: 'badadib.test' })
    await flush()
    await act(async () => { slow({ data: { result: [notif(99, '2026-11-05T10:00:00')] } }) })
    expect(result.current.notifications.map((n) => n.id)).toEqual([3, 2, 1])
  })
})

describe('paging further back', () => {
  it('asks for what is older than the last one and appends without duplicates', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib', { limit: 3 }))
    await flush()
    pages.older = [notif(1, '2026-11-04T10:00:00'), notif(0, '2026-11-03T10:00:00')]
    await act(async () => { await result.current.loadMore() })
    expect(rpc('bridge.account_notifications').at(-1)[1].params).toEqual({ account: 'badadib', limit: 3, last_id: 1 })
    expect(result.current.notifications.map((n) => n.id)).toEqual([3, 2, 1, 0])
    expect(result.current).toMatchObject({ hasMore: false, loadingMore: false })
  })

  it('an explicit id overrides the last one', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib', { limit: 3 }))
    await flush()
    await act(async () => { await result.current.loadMore(42) })
    expect(rpc('bridge.account_notifications').at(-1)[1].params.last_id).toBe(42)
  })

  it('does nothing once there is nothing older', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    expect(result.current.hasMore).toBe(false)
    const before = http.post.mock.calls.length
    await act(async () => { await result.current.loadMore() })
    expect(http.post.mock.calls.length).toBe(before)
  })

  it('does nothing while no notification is loaded to page from', async () => {
    pages.first = []
    const { result } = renderHook(() => useHiveNotifications('badadib', { limit: 0 }))
    await flush()
    expect(result.current.hasMore).toBe(true)
    const before = http.post.mock.calls.length
    await act(async () => { await result.current.loadMore() })
    expect(http.post.mock.calls.length).toBe(before)
  })

  it('a failed page is surfaced as the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useHiveNotifications('badadib', { limit: 3 }))
    await flush()
    http.post.mockRejectedValueOnce(new Error('timeout'))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.error).toEqual(new Error('timeout'))
    expect(result.current.notifications).toHaveLength(3)
  })
})

describe('polling', () => {
  it('refreshes every minute and when the tab becomes visible, until unmounted', async () => {
    const { unmount } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    expect(rpc('bridge.account_notifications')).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(rpc('bridge.account_notifications')).toHaveLength(2)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rpc('bridge.account_notifications')).toHaveLength(3)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rpc('bridge.account_notifications')).toHaveLength(3)
  })

  it('poll: false only loads once', async () => {
    renderHook(() => useHiveNotifications('badadib', { poll: false }))
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    expect(rpc('bridge.account_notifications')).toHaveLength(1)
  })
})

describe('marking as read', () => {
  const op = () => {
    const [keyType, id, json, label] = signer.customJsonWithAioha.mock.calls.at(-1)
    return { keyType, id, json: JSON.parse(json), label }
  }

  it('"mark all read" sets lastRead 30 s past the newest notification (its block can be later)', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAllAsRead() })
    expect(op()).toEqual({ keyType: 'posting', id: 'notify', json: ['setLastRead', { date: '2026-11-05T17:04:51' }], label: 'Mark notifications as read' })
    expect(result.current).toMatchObject({ unreadCount: 0, lastRead: '2026-11-05T17:04:51', markingAsRead: false })
  })

  it('never reads through a date in the future', async () => {
    vi.setSystemTime(new Date('2026-11-05T17:04:30Z'))
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAllAsRead() })
    expect(op().json[1].date).toBe('2026-11-05T17:04:30')
  })

  it('with no notifications loaded, marks read up to now', async () => {
    pages.first = []
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAllAsRead() })
    expect(op().json[1].date).toBe('2026-11-05T18:00:00')
  })

  it('nothing unread broadcasts nothing', async () => {
    unread = { lastread: '2026-11-05T17:30:00', unread: 0 }
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAllAsRead() })
    expect(signer.customJsonWithAioha).not.toHaveBeenCalled()
  })

  it('a refused signature leaves the unread state as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    signer.customJsonWithAioha.mockRejectedValue(new Error('user cancelled'))
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAllAsRead() })
    expect(result.current).toMatchObject({ unreadCount: 2, lastRead: '2026-11-05T15:00:00', markingAsRead: false })
  })

  it('marking one reads through it and recounts what is still newer', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAsRead('2026-11-05T16:00:00') })
    expect(op()).toMatchObject({ id: 'notify', json: ['setLastRead', { date: '2026-11-05T16:00:30' }], label: 'Mark notification as read' })
    expect(result.current).toMatchObject({ lastRead: '2026-11-05T16:00:30', unreadCount: 1 })
  })

  it('marking one that is already read broadcasts nothing', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAsRead('2026-11-01T00:00:00') })
    expect(signer.customJsonWithAioha).not.toHaveBeenCalled()
  })

  it('marking one without a date reads through now', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAsRead() })
    expect(op().json[1].date).toBe('2026-11-05T18:00:00')
    expect(result.current.unreadCount).toBe(0)
  })

  it('a refused single mark keeps lastRead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    signer.customJsonWithAioha.mockRejectedValue(new Error('no key'))
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    await act(async () => { await result.current.markAsRead('2026-11-05T16:00:00') })
    expect(result.current.lastRead).toBe('2026-11-05T15:00:00')
  })

  it('isUnread compares against the on-chain lastRead', async () => {
    const { result } = renderHook(() => useHiveNotifications('badadib'))
    await flush()
    expect(result.current.notifications.map(result.current.isUnread)).toEqual([true, true, false])
    expect(result.current.isUnread({})).toBe(false)
    expect(result.current.isUnread({ date: '2026-11-05T15:00:01Z' })).toBe(true)
  })
})
