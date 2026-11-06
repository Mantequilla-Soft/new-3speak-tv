// @vitest-environment jsdom
// The signup button's hook (useSignupPossible in src/utils/signupPossible.js):
// shows signup while the check runs, takes the answer when it arrives, and
// asks again when who is signed in changes. The checks themselves are in
// signupPossible.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ state: { user: null, incubationHandle: null } }))
vi.mock('../../../src/utils/config', () => ({ BUTRAUTH_URL: 'https://butrauth.example' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(h.state) }))

const reply = (body) => ({ ok: true, json: async () => body })

let mod
let fetchMock
beforeEach(async () => {
  vi.resetModules()
  h.state = { user: null, incubationHandle: null }
  fetchMock = vi.fn(async () => reply({ possible: false, reason: 'vpn', message: 'VPN detected' }))
  vi.stubGlobal('fetch', fetchMock)
  mod = await import('../../../src/utils/signupPossible.js')
})

describe('useSignupPossible', () => {
  it('starts as possible and loading, then takes the answer', async () => {
    const { result } = renderHook(() => mod.useSignupPossible())
    expect(result.current).toEqual({ possible: true, reason: null, message: null, loading: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toEqual({ possible: false, reason: 'vpn', message: 'VPN detected', loading: false })
  })

  it('asks again when someone signs in, keyed on the user or warm-up handle', async () => {
    const { result, rerender } = renderHook(() => mod.useSignupPossible())
    await waitFor(() => expect(result.current.loading).toBe(false))
    h.state = { user: null, incubationHandle: '~bee' }
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    h.state = { user: 'alice', incubationHandle: '~bee' }
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  it('ignores an answer that arrives after unmount', async () => {
    let resolve
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r }))
    const { result, unmount } = renderHook(() => mod.useSignupPossible())
    unmount()
    resolve(reply({ possible: false }))
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.loading).toBe(true)
  })
})
