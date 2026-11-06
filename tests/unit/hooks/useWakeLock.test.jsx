// Keeping the screen awake (src/hooks/useWakeLock.js): a lock while active, a
// new one when the tab comes back (the browser drops it when hidden), released
// on unmount, including a lock that arrives after the hook already went away.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWakeLock } from '../../../src/hooks/useWakeLock.js'

let request
let locks
const lock = () => { const l = { release: vi.fn() }; locks.push(l); return l }
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const setVisibility = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })

beforeEach(() => {
  locks = []
  request = vi.fn(async () => lock())
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
})
afterEach(() => { delete navigator.wakeLock; setVisibility('visible') })

describe('useWakeLock', () => {
  it('asks for a screen lock while active and releases it on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()
    expect(request).toHaveBeenCalledWith('screen')
    unmount()
    expect(locks[0].release).toHaveBeenCalledTimes(1)
  })

  it('asks for nothing while inactive', async () => {
    renderHook(() => useWakeLock(false))
    await flush()
    expect(request).not.toHaveBeenCalled()
  })

  it('releases the lock when it turns inactive', async () => {
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } })
    await flush()
    rerender({ on: false })
    expect(locks[0].release).toHaveBeenCalled()
  })

  it('a lock granted after unmount is released straight away', async () => {
    let grant
    request.mockImplementationOnce(() => new Promise((r) => { grant = r }))
    const { unmount } = renderHook(() => useWakeLock(true))
    unmount()
    const late = lock()
    await act(async () => { grant(late) })
    expect(late.release).toHaveBeenCalled()
  })

  it('asks again when the tab becomes visible with no lock held', async () => {
    request.mockRejectedValueOnce(new Error('NotAllowed'))
    renderHook(() => useWakeLock(true))
    await flush()
    setVisibility('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not ask again while a lock is held or the tab is hidden', async () => {
    renderHook(() => useWakeLock(true))
    await flush()
    setVisibility('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does nothing in a browser without the Wake Lock API', async () => {
    delete navigator.wakeLock
    const { unmount } = renderHook(() => useWakeLock(true))
    expect(() => unmount()).not.toThrow()
  })
})
