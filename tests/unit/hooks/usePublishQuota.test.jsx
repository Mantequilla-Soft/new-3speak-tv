// ⏳ usePublishQuota (src/hooks/usePublishQuota.js): may the logged-in Hive
// account publish a kind now or at a picked time? Never asked for 3Speak Pro,
// while Pro is loading, or for a warm-up account; fails open (404 = nothing
// known); only the answer for the very time asked for is returned; a picked
// time is asked once the picking settles.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const m = vi.hoisted(() => ({ premium: { premium: false } }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: (u) => (u ? m.premium : null) }))
vi.mock('../../../src/utils/scheduledPosts', () => ({ SCHEDULED_CHECKER_BASE: 'https://checker.test' }))

const { useAppStore } = await import('../../../src/lib/store')
const { usePublishQuota } = await import('../../../src/hooks/usePublishQuota.js')
const { refreshPublishQuota } = await import('../../../src/lib/publishQuota.js')

const { formatDateTimeLocal } = await import('../../../src/utils/schedulingHelpers.js')

const DAY = 24 * 3600 * 1000
// Whole minutes, so a picker value says the very same time.
const inDays = (n) => Math.floor((Date.now() + n * DAY) / 60000) * 60000
const FREE_AT = new Date(inDays(2)).toISOString()
const local = (ms) => formatDateTimeLocal(new Date(ms))
// Taken before FREE_AT, free from it on (the checker, faked).
const answer = (url) => {
  const p = new URL(url).searchParams
  const at = p.get('at') || new Date().toISOString()
  const taken = Date.parse(at) < Date.parse(FREE_AT)
  return { success: true, enabled: true, exempt: false, kind: p.get('kind'), limit: 1, at, allowed: !taken, conflicts: [], next_free_at: taken ? FREE_AT : at }
}

let fetchMock
const urls = () => fetchMock.mock.calls.map(([u]) => new URL(u))
beforeEach(() => {
  m.premium = { premium: false }
  fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => answer(url) }))
  vi.stubGlobal('fetch', fetchMock)
  refreshPublishQuota()
  useAppStore.setState({ user: 'badadib', incubationHandle: null })
})

describe('usePublishQuota', () => {
  it('"publish now" for a free Hive account: blocked, with the next free time', async () => {
    const { result } = renderHook(() => usePublishQuota({ kind: 'video' }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.blocked).toBe(true)
    expect(result.current.quota.nextFreeAt).toBe(Date.parse(FREE_AT))
    expect(urls()[0].pathname).toBe('/publish-quota/badadib')
    expect(urls()[0].searchParams.get('kind')).toBe('video')
  })

  it('a picked time and the post left out go along; a free time is not blocked', async () => {
    const at = inDays(3)
    const { result } = renderHook(() => usePublishQuota({ kind: 'video', at: local(at), exclude: 'my-trip' }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.blocked).toBe(false)
    expect(urls()[0].searchParams.get('exclude')).toBe('my-trip')
    expect(urls()[0].searchParams.get('at')).toBe(new Date(at).toISOString())
  })

  it('fails open: a route that 404s (not deployed) blocks nothing', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    const { result } = renderHook(() => usePublishQuota({ kind: 'video' }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current).toMatchObject({ quota: null, blocked: false })
  })

  it('never asks for Pro, while Pro is loading, for a warm-up account, or when off', async () => {
    m.premium = { premium: true }
    const pro = renderHook(() => usePublishQuota({ kind: 'video' }))
    expect(pro.result.current).toMatchObject({ ready: true, quota: null, blocked: false })
    pro.unmount()

    m.premium = null
    const loading = renderHook(() => usePublishQuota({ kind: 'video' }))
    expect(loading.result.current.ready).toBe(false)
    loading.unmount()

    m.premium = { premium: false }
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    const warmup = renderHook(() => usePublishQuota({ kind: 'video' }))
    expect(warmup.result.current).toMatchObject({ ready: true, blocked: false })
    warmup.unmount()

    useAppStore.setState({ user: 'badadib', incubationHandle: null })
    const off = renderHook(() => usePublishQuota({ kind: 'video', enabled: false }))
    expect(off.result.current.blocked).toBe(false)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a newly picked time never shows the old time\'s answer, and is asked once the picking settles', async () => {
    const taken = inDays(1)
    const free = inDays(3)
    const { result, rerender } = renderHook(({ at }) => usePublishQuota({ kind: 'video', at, debounceMs: 300 }), { initialProps: { at: local(taken) } })
    await waitFor(() => expect(result.current.blocked).toBe(true))
    rerender({ at: local(free) })
    expect(result.current).toMatchObject({ checking: true, blocked: false, quota: null })
    rerender({ at: local(free + 3600 * 1000) })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.blocked).toBe(false)
    // The time in between was never asked for.
    expect(urls().map((u) => u.searchParams.get('at'))).toEqual([
      new Date(taken).toISOString(),
      new Date(free + 3600 * 1000).toISOString(),
    ])
  })

  it('reads again after refreshPublishQuota()', async () => {
    const { result } = renderHook(() => usePublishQuota({ kind: 'short' }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => refreshPublishQuota())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
