// @vitest-environment jsdom
// The day's sign-in point (src/hooks/useDailyPoints.js): once a day and account
// from this browser, after a silent hangouts session, never without one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useDailyPoints from '../../../src/hooks/useDailyPoints'

let fetchMock
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const run = async (props) => {
  const hook = renderHook((p) => useDailyPoints(p), { initialProps: props })
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  return hook
}

describe('useDailyPoints', () => {
  it('claims once with the session token, then not again today', async () => {
    const getToken = vi.fn(async () => 'tok')
    await run({ apiUrl: 'https://live.test/', user: 'fan', authenticated: true, getToken })
    expect(fetchMock).toHaveBeenCalledWith('https://live.test/points/daily', { method: 'POST', headers: { Authorization: 'Bearer tok' } })
    await run({ apiUrl: 'https://live.test/', user: 'fan', authenticated: true, getToken })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Another account in the same browser has its own day.
    await run({ apiUrl: 'https://live.test/', user: 'fan2', authenticated: true, getToken })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('nothing signed out, without a server, or without a silent session', async () => {
    const getToken = vi.fn(async () => null)
    await run({ apiUrl: 'https://live.test', user: 'fan', authenticated: false, getToken })
    await run({ apiUrl: '', user: 'fan', authenticated: true, getToken })
    expect(getToken).not.toHaveBeenCalled()
    await run({ apiUrl: 'https://live.test', user: 'fan', authenticated: true, getToken })
    expect(getToken).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed claim tries again on the next load; an old server (404) is done for the day', async () => {
    const getToken = vi.fn(async () => 'tok')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    await run({ apiUrl: 'https://live.test', user: 'fan', authenticated: true, getToken })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    await run({ apiUrl: 'https://live.test', user: 'fan', authenticated: true, getToken })
    await run({ apiUrl: 'https://live.test', user: 'fan', authenticated: true, getToken })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
