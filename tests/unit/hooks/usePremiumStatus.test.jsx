// The viewer's own 3Speak Pro status (usePremiumStatus in
// src/hooks/usePremiumStatus.js): expiry, source and the sticky trial flag read
// from the checker, cached per account for a minute (a failure too, so a 500
// does not hammer it) and shared by concurrent callers. PRO badges from the
// shared list are covered in usePremiumBadge.test.js.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

let fetchMock
let usePremiumStatus
let usePremiumBadge
const ok = (data) => ({ ok: true, json: async () => data })

beforeEach(async () => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] })
  fetchMock = vi.fn(async () => ok({ premium: true, premium_expires_at: '2026-12-01', premium_source: 'hbd', testing_started: '2026-10-01' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  ;({ usePremiumStatus, usePremiumBadge } = await import('../../../src/hooks/usePremiumStatus.js'))
})
afterEach(() => vi.useRealTimers())

describe('usePremiumStatus', () => {
  it('is null while loading, then the full status', async () => {
    const { result } = renderHook(() => usePremiumStatus('BadAdib'))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toEqual({ premium: true, expiresAt: '2026-12-01', source: 'hbd', testingStarted: '2026-10-01' })
    expect(fetchMock).toHaveBeenCalledWith('https://checker.3speak.tv/premium/badadib')
  })

  it('a non-Pro answer has nulls for the optional fields', async () => {
    fetchMock.mockResolvedValue(ok({ premium: 0 }))
    const { result } = renderHook(() => usePremiumStatus('badadib'))
    await waitFor(() => expect(result.current).toEqual({ premium: false, expiresAt: null, source: null, testingStarted: null }))
  })

  it.each([
    ['an error status', async () => ({ ok: false, status: 500 })],
    ['a network failure', async () => { throw new TypeError('Failed to fetch') }],
  ])('%s reads as not Pro', async (_label, impl) => {
    fetchMock.mockImplementation(impl)
    const { result } = renderHook(() => usePremiumStatus('badadib'))
    await waitFor(() => expect(result.current).toMatchObject({ premium: false, expiresAt: null }))
  })

  it('a second mount within the minute starts from the cache, with no request', async () => {
    const first = renderHook(() => usePremiumStatus('badadib'))
    await waitFor(() => expect(first.result.current).not.toBeNull())
    const second = renderHook(() => usePremiumStatus('BADADIB'))
    expect(second.result.current).toMatchObject({ premium: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('a failure is remembered for the minute too, then asked again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const first = renderHook(() => usePremiumStatus('badadib'))
    await waitFor(() => expect(first.result.current).toMatchObject({ premium: false }))
    renderHook(() => usePremiumStatus('badadib'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(1_000_000 + 61_000)
    const later = renderHook(() => usePremiumStatus('badadib'))
    expect(later.result.current).toBeNull()
    await waitFor(() => expect(later.result.current).toMatchObject({ premium: true }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('concurrent mounts share one request', async () => {
    const a = renderHook(() => usePremiumStatus('badadib'))
    const b = renderHook(() => usePremiumStatus('badadib'))
    await waitFor(() => expect(a.result.current && b.result.current).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('no account is null and asks nothing; signing out clears it', async () => {
    const { result, rerender } = renderHook(({ u }) => usePremiumStatus(u), { initialProps: { u: 'badadib' } })
    await waitFor(() => expect(result.current).not.toBeNull())
    rerender({ u: null })
    expect(result.current).toBeNull()
    renderHook(() => usePremiumStatus(''))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an answer for an account already left is dropped', async () => {
    let first
    fetchMock.mockImplementationOnce(() => new Promise((r) => { first = r }))
    const { result, rerender } = renderHook(({ u }) => usePremiumStatus(u), { initialProps: { u: 'alice' } })
    rerender({ u: 'bob' })
    await waitFor(() => expect(result.current).toMatchObject({ premium: true }))
    first(ok({ premium: false }))
    await Promise.resolve()
    expect(result.current).toMatchObject({ premium: true })
  })
})

describe('usePremiumBadge, from a warm list', () => {
  it('a later badge answers straight from the list, Pro or not', async () => {
    fetchMock.mockResolvedValue(ok({ subscribers: [{ username: 'Alice' }] }))
    const first = renderHook(() => usePremiumBadge('alice'))
    await waitFor(() => expect(first.result.current).toBe(true))
    expect(renderHook(() => usePremiumBadge('ALICE')).result.current).toBe(true)
    expect(renderHook(() => usePremiumBadge('carol')).result.current).toBe(false)
    expect(renderHook(() => usePremiumBadge(null)).result.current).toBeNull()
  })

  it('an answer without a subscriber list is a complete, empty list: nobody is Pro', async () => {
    fetchMock.mockResolvedValue(ok({}))
    const { result } = renderHook(() => usePremiumBadge('alice'))
    await waitFor(() => expect(result.current).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://checker.3speak.tv/premium?limit=5000')
  })
})
