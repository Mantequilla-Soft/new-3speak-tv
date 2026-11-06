// Chat unread counts read from the server (src/hooks/useServerUnread.js): asked
// on mount, every 20 seconds, when the tab regains focus, and on demand; the
// server's answer is the only truth, and a failed read keeps the last one.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const chat = vi.hoisted(() => ({ client: null }))
vi.mock('../../../src/lib/snapieChat', () => ({ getChatClient: () => chat.client }))
const { useServerUnread } = await import('../../../src/hooks/useServerUnread.js')

let getUnread
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  getUnread = vi.fn(async () => ({ unread: 3, conversations: { c1: 3 } }))
  chat.client = { isAuthenticated: () => true, getUnread }
})
afterEach(() => vi.useRealTimers())

describe('useServerUnread', () => {
  it('reads the count on mount', async () => {
    const { result } = renderHook(() => useServerUnread())
    await flush()
    expect(result.current).toMatchObject({ unreadCount: 3, byConversation: { c1: 3 } })
  })

  it.each([
    [{ total: 5, byConversation: { a: 5 } }, 5, { a: 5 }],
    [{ unread: 'x' }, 0, null],
    [{}, 0, null],
  ])('reads %o as %i unread', async (res, count, by) => {
    getUnread.mockResolvedValue(res)
    const { result } = renderHook(() => useServerUnread())
    await flush()
    expect(result.current).toMatchObject({ unreadCount: count, byConversation: by })
  })

  it('polls every 20 seconds and follows the server down to zero', async () => {
    const { result } = renderHook(() => useServerUnread())
    await flush()
    getUnread.mockResolvedValue({ unread: 0 })
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(getUnread).toHaveBeenCalledTimes(2)
    expect(result.current.unreadCount).toBe(0)
  })

  it('asks again when the window regains focus or the tab becomes visible', async () => {
    renderHook(() => useServerUnread())
    await flush()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(getUnread).toHaveBeenCalledTimes(3)
  })

  it('refresh resyncs on demand', async () => {
    const { result } = renderHook(() => useServerUnread())
    await flush()
    getUnread.mockResolvedValue({ unread: 1 })
    await act(async () => { await result.current.refresh() })
    expect(result.current.unreadCount).toBe(1)
  })

  it('keeps the last answer when a read fails', async () => {
    const { result } = renderHook(() => useServerUnread())
    await flush()
    getUnread.mockRejectedValue(new Error('503'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.unreadCount).toBe(3)
  })

  it('asks nothing while signed out of chat or disabled', async () => {
    chat.client = { isAuthenticated: () => false, getUnread }
    renderHook(() => useServerUnread())
    await flush()
    chat.client = { isAuthenticated: () => true, getUnread }
    renderHook(() => useServerUnread(false))
    await flush()
    expect(getUnread).not.toHaveBeenCalled()
  })

  it('stops polling and listening once unmounted, and ignores an answer that lands after', async () => {
    let late
    getUnread.mockImplementationOnce(() => new Promise((r) => { late = r }))
    const { result, unmount } = renderHook(() => useServerUnread())
    unmount()
    await act(async () => { late({ unread: 9 }) })
    expect(result.current.unreadCount).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    window.dispatchEvent(new Event('focus'))
    expect(getUnread).toHaveBeenCalledTimes(1)
  })
})
