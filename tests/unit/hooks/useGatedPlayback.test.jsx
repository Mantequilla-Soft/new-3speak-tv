// Supporters-only playback (src/hooks/useGatedPlayback.js): the gate is asked
// with the session cookie for the account signed in now; an entitled viewer gets
// the manifest, a 402 is the paywall with its preview, an "anonymous" 402 mints a
// session and asks once more, and any failure fails closed (locked, never open).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const session = vi.hoisted(() => ({ sync: vi.fn(), establish: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({
  syncWalletSession: (...a) => session.sync(...a),
  establishWalletSession: (...a) => session.establish(...a),
}))
const { useGatedPlayback } = await import('../../../src/hooks/useGatedPlayback.js')

const res = (status, body) => {
  const make = () => ({ status, ok: status >= 200 && status < 300, json: async () => body, clone: () => make() })
  return make()
}
let fetchMock

beforeEach(() => {
  session.sync.mockReset().mockResolvedValue(true)
  session.establish.mockReset().mockResolvedValue(true)
  fetchMock = vi.fn(async () => res(200, { entitled: true, manifestUrl: 'https://cdn.test/m.m3u8' }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('useGatedPlayback', () => {
  it('a video that is not gated plays normally and asks nothing', () => {
    const { result } = renderHook(() => useGatedPlayback('p1', false))
    expect(result.current).toMatchObject({ state: 'idle', isLocked: false, isEntitled: false, manifestUrl: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an entitled viewer gets the manifest, asked with the session cookie', async () => {
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    expect(result.current.state).toBe('loading')
    await waitFor(() => expect(result.current.state).toBe('entitled'))
    expect(result.current).toMatchObject({ manifestUrl: 'https://cdn.test/m.m3u8', isEntitled: true, isLocked: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://gate.3speak.tv/v1/session')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(init.body)).toEqual({ videoId: 'p1' })
    expect(session.sync).toHaveBeenCalledBefore(fetchMock)
  })

  it('a 402 is the paywall, with the preview and creator from the body', async () => {
    fetchMock.mockResolvedValue(res(402, { reason: 'not-supporter', previewUrl: 'https://cdn.test/preview.m3u8', creator: 'badadib' }))
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    await waitFor(() => expect(result.current.state).toBe('locked'))
    expect(result.current).toMatchObject({ previewUrl: 'https://cdn.test/preview.m3u8', creator: 'badadib', isLocked: true })
    expect(session.establish).not.toHaveBeenCalled()
  })

  it('an "anonymous" 402 mints a session and asks once more', async () => {
    fetchMock.mockResolvedValueOnce(res(402, { reason: 'anonymous' }))
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    await waitFor(() => expect(result.current.state).toBe('entitled'))
    expect(session.establish).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stays locked when no session could be minted', async () => {
    session.establish.mockResolvedValue(false)
    fetchMock.mockResolvedValue(res(402, { reason: 'anonymous' }))
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    await waitFor(() => expect(result.current.state).toBe('locked'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.previewUrl).toBeNull()
  })

  it('an entitlement answer without a manifest is locked', async () => {
    fetchMock.mockResolvedValue(res(200, { entitled: true }))
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    await waitFor(() => expect(result.current.state).toBe('locked'))
  })

  it.each([
    ['a gate error', async () => res(500, {})],
    ['an unreachable gate', async () => { throw new TypeError('Failed to fetch') }],
  ])('%s fails closed', async (_label, impl) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementation(impl)
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current).toMatchObject({ isLocked: true, isEntitled: false, manifestUrl: null })
  })

  it('a failed session sync does not stop the gate being asked', async () => {
    session.sync.mockRejectedValue(new Error('no wallet'))
    const { result } = renderHook(() => useGatedPlayback('p1', true))
    await waitFor(() => expect(result.current.state).toBe('entitled'))
  })

  it('switching to an ungated video resets to idle and drops the manifest', async () => {
    const { result, rerender } = renderHook(({ id, gated }) => useGatedPlayback(id, gated), { initialProps: { id: 'p1', gated: true } })
    await waitFor(() => expect(result.current.state).toBe('entitled'))
    rerender({ id: 'p2', gated: false })
    expect(result.current).toMatchObject({ state: 'idle', manifestUrl: null })
  })

  it('an answer for a video already left is ignored', async () => {
    let first
    fetchMock.mockImplementationOnce(() => new Promise((r) => { first = r }))
    const { result, rerender } = renderHook(({ id, gated }) => useGatedPlayback(id, gated), { initialProps: { id: 'p1', gated: true } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender({ id: 'p1', gated: false })
    await act(async () => { first(res(200, { entitled: true, manifestUrl: 'https://cdn.test/stale.m3u8' })) })
    expect(result.current).toMatchObject({ state: 'idle', manifestUrl: null })
  })
})
