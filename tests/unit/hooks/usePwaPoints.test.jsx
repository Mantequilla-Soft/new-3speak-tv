// @vitest-environment jsdom
// The once-ever points for the installed app (src/hooks/usePwaPoints.js): only
// when the app runs installed and someone is signed in, with a silent hangouts
// session token, once per account from this browser; never without a token.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import usePwaPoints from '../../../src/hooks/usePwaPoints'
import { isStandalone } from '../../../src/utils/pwaInstall'

let fetchMock
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete window.matchMedia })

const run = async (props) => {
  const hook = renderHook((p) => usePwaPoints(p), { initialProps: props })
  await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
  hook.unmount()
  return hook
}
const installed = () => true
const inBrowser = () => false
const base = { apiUrl: 'https://live.test/', user: 'badadib', authenticated: true }

describe('usePwaPoints', () => {
  it('installed and signed in: claims once with the silent token, then never again', async () => {
    const getToken = vi.fn(async () => 'tok')
    await run({ ...base, getToken, standalone: installed })
    expect(getToken).toHaveBeenCalledWith('badadib')
    expect(fetchMock).toHaveBeenCalledWith('https://live.test/points/pwa', { method: 'POST', headers: { Authorization: 'Bearer tok' } })
    await run({ ...base, getToken, standalone: installed })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Another account in the same app claims its own.
    await run({ ...base, user: 'fan2', getToken, standalone: installed })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('in a browser tab: never', async () => {
    const getToken = vi.fn(async () => 'tok')
    await run({ ...base, getToken, standalone: inBrowser })
    expect(getToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('without a session token, signed out or without a server: never claims', async () => {
    const getToken = vi.fn(async () => null)
    await run({ ...base, getToken, standalone: installed })
    expect(getToken).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    await run({ ...base, authenticated: false, getToken, standalone: installed })
    await run({ ...base, apiUrl: '', getToken, standalone: installed })
    expect(getToken).toHaveBeenCalledOnce()
  })

  it('already paid (409) is done; a failure tries again next load', async () => {
    const getToken = vi.fn(async () => 'tok')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    await run({ ...base, getToken, standalone: installed })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 })
    await run({ ...base, getToken, standalone: installed })
    await run({ ...base, getToken, standalone: installed })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('an older server without the route (404) is asked again only days later', async () => {
    const getToken = vi.fn(async () => 'tok')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    await run({ ...base, getToken, standalone: installed })
    await run({ ...base, getToken, standalone: installed })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 4 * 24 * 3600 * 1000)
    await run({ ...base, getToken, standalone: installed })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads "installed" from display-mode standalone by default', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q === '(display-mode: standalone)' }))
    expect(isStandalone()).toBe(true)
    const getToken = vi.fn(async () => 'tok')
    await run({ ...base, getToken })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    window.matchMedia = vi.fn(() => ({ matches: false }))
    expect(isStandalone()).toBe(false)
  })
})
