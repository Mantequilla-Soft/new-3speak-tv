// Joining an OpenPods room as the signed-in user (src/hooks/useStreamSession.js):
// two silent handover attempts (the second 3 s later), holding the connection
// while a remembered login is probably about to authenticate (at most 10 s), a
// wallet prompt only when asked for, and a join key that forces a re-join once
// the real identity lands.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// The Hangouts context as the hook sees it: a small external store, so a login
// attempt can flip sessionLoading the way the real provider does (true while it
// runs, false once it settles), which is what re-runs the hook's effect.
const hangout = vi.hoisted(() => {
  const listeners = new Set()
  const h = {
    state: {},
    set(patch) { h.state = { ...h.state, ...patch }; listeners.forEach((l) => l()) },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
  }
  return h
})
vi.mock('../../../src/context/HangoutContext', async () => {
  const { useSyncExternalStore } = await import('react')
  return { useHangout: () => useSyncExternalStore(hangout.subscribe, () => hangout.state) }
})
const wallet = vi.hoisted(() => ({ aioha: { id: 'aioha' }, user: null }))
vi.mock('@aioha/react-ui', () => ({ useAioha: () => wallet }))
const store = vi.hoisted(() => ({ authenticated: true, user: 'badadib' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(store) }))
const { useStreamSession } = await import('../../../src/hooks/useStreamSession.js')

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  const retryLogin = vi.fn(async () => {
    hangout.set({ sessionLoading: true })
    await Promise.resolve()
    hangout.set({ sessionLoading: false })
    return null
  })
  hangout.state = { sessionToken: null, sessionLoading: false, hangoutsUser: null, retryLogin }
  Object.assign(store, { authenticated: true, user: 'badadib' })
  wallet.user = null
})
afterEach(() => vi.useRealTimers())

describe('the silent handover', () => {
  it('tries right away, then once more 3 s later, then stops', async () => {
    renderHook(() => useStreamSession())
    await advance(0)
    expect(hangout.state.retryLogin).toHaveBeenCalledTimes(1)
    expect(hangout.state.retryLogin).toHaveBeenCalledWith('badadib', { interactive: false })
    await advance(2999)
    expect(hangout.state.retryLogin).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(hangout.state.retryLogin).toHaveBeenCalledTimes(2)
    await advance(60000)
    expect(hangout.state.retryLogin).toHaveBeenCalledTimes(2)
  })

  it('after both attempts fail, connects as a guest without waiting for the deadline', async () => {
    hangout.state.retryLogin.mockImplementation(async () => {
      hangout.set({ sessionLoading: true })
      await Promise.resolve()
      hangout.set({ sessionLoading: false })
      throw new Error('400')
    })
    const { result } = renderHook(() => useStreamSession())
    expect(result.current.connectReady).toBe(false)
    await advance(0)
    expect(result.current.connectReady).toBe(false)
    await advance(3000)
    expect(result.current).toMatchObject({ connectReady: true, needsSignIn: true, canInteract: false, joinKey: 'guest' })
  })

  it('names the 3Speak account, not a stale wallet user from an earlier login', async () => {
    wallet.user = 'old-wallet-user'
    renderHook(() => useStreamSession())
    await advance(0)
    expect(hangout.state.retryLogin.mock.calls[0][0]).toBe('badadib')
  })

  it('falls back to the wallet user when the store has none', async () => {
    store.user = null
    wallet.user = 'walletonly'
    renderHook(() => useStreamSession())
    await advance(0)
    expect(hangout.state.retryLogin.mock.calls[0][0]).toBe('walletonly')
  })

  it('does not try while a session is loading or already there', async () => {
    hangout.set({ sessionLoading: true })
    const loading = renderHook(() => useStreamSession())
    loading.unmount()
    hangout.set({ sessionLoading: false, sessionToken: 'tok' })
    renderHook(() => useStreamSession())
    await advance(5000)
    expect(hangout.state.retryLogin).not.toHaveBeenCalled()
  })

  it('a pending attempt is cancelled on unmount', async () => {
    const { unmount } = renderHook(() => useStreamSession())
    unmount()
    await advance(5000)
    expect(hangout.state.retryLogin).not.toHaveBeenCalled()
  })
})

describe('when to connect', () => {
  it('a guest with no remembered login connects at once and never handovers', async () => {
    Object.assign(store, { authenticated: false, user: null })
    const { result } = renderHook(() => useStreamSession())
    expect(result.current).toMatchObject({ connectReady: true, needsSignIn: false, joinKey: 'guest' })
    await advance(5000)
    expect(hangout.state.retryLogin).not.toHaveBeenCalled()
  })

  it('a remembered login waits (not yet authenticated), but at most 10 s', async () => {
    Object.assign(store, { authenticated: false, user: null })
    localStorage.setItem('user_id', 'badadib')
    const { result } = renderHook(() => useStreamSession())
    expect(result.current.connectReady).toBe(false)
    await advance(9999)
    expect(result.current.connectReady).toBe(false)
    await advance(1)
    expect(result.current.connectReady).toBe(true)
  })

  it('a token connects as the real user, with a join key that names them', () => {
    hangout.set({ sessionToken: 'tok', hangoutsUser: 'badadib' })
    const { result } = renderHook(() => useStreamSession())
    expect(result.current).toMatchObject({ connectReady: true, needsSignIn: false, canInteract: true, joinKey: 'auth-badadib', sessionToken: 'tok', aioha: wallet.aioha })
  })

  it('a token without a named hangouts user still gets an auth join key', () => {
    hangout.set({ sessionToken: 'tok' })
    expect(renderHook(() => useStreamSession()).result.current.joinKey).toBe('auth-user')
  })
})

describe('signing in on demand', () => {
  it('asks the wallet interactively and reports signing in meanwhile', async () => {
    let finish
    const { result } = renderHook(() => useStreamSession())
    await advance(0)
    hangout.state.retryLogin.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    let pending
    act(() => { pending = result.current.signIn() })
    expect(result.current.signingIn).toBe(true)
    expect(hangout.state.retryLogin).toHaveBeenLastCalledWith('badadib', { interactive: true })
    await act(async () => { finish('tok'); await pending })
    await expect(pending).resolves.toBe('tok')
    expect(result.current.signingIn).toBe(false)
  })

  it('a guest cannot sign in to the room', async () => {
    Object.assign(store, { authenticated: false, user: null })
    const { result } = renderHook(() => useStreamSession())
    await expect(result.current.signIn()).resolves.toBeNull()
    expect(hangout.state.retryLogin).not.toHaveBeenCalled()
  })

  it('a failed prompt clears the signing-in flag and rethrows', async () => {
    const { result } = renderHook(() => useStreamSession())
    await advance(0)
    hangout.state.retryLogin.mockRejectedValueOnce(new Error('cancelled'))
    await act(async () => { await expect(result.current.signIn()).rejects.toThrow('cancelled') })
    expect(result.current.signingIn).toBe(false)
  })
})
