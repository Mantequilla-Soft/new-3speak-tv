// ⏳ useUploadQuota (src/hooks/useUploadQuota.js): the free plan's counters for
// the logged-in Hive account, the warm-up's (video + Shorts only) for a warm-up
// handle. Never fetched for 3Speak Pro or while Pro is still loading; fails
// open (404 = nothing known); trusts the server's `exempt`; reads again after
// refreshUploadQuota().
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const m = vi.hoisted(() => ({ premium: { premium: false } }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: (u) => (u ? m.premium : null) }))
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  EMBED_API_URL: 'https://embed.test',
  THREESPEAK_AUDIO_API_URL: 'https://audio.test',
}))

const { useAppStore } = await import('../../../src/lib/store')
const { useUploadQuota } = await import('../../../src/hooks/useUploadQuota.js')
const { refreshUploadQuota } = await import('../../../src/lib/uploadQuota.js')

const ok = (data) => ({ ok: true, json: async () => data })
const VIDEO_ON = { enabled: true, exempt: false, video: { limit: 1, used: 0, remaining: 1, next_at: null }, short: { limit: 3, used: 3, remaining: 0, next_at: '2026-11-21T14:32:00Z' } }
const AUDIO_ON = { enabled: true, exempt: false, audio: { limit: 2, used: 1, remaining: 1, next_at: null, max_seconds: 900 } }

let fetchMock
beforeEach(() => {
  m.premium = { premium: false }
  fetchMock = vi.fn(async (url) => ok(String(url).includes('/api/audio/') ? AUDIO_ON : VIDEO_ON))
  vi.stubGlobal('fetch', fetchMock)
  refreshUploadQuota()
  useAppStore.setState({ user: 'badadib', incubationHandle: null })
})

describe('useUploadQuota', () => {
  it('reads both counters for a free Hive account', async () => {
    const { result } = renderHook(() => useUploadQuota())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current).toMatchObject({
      exempt: false,
      video: { limit: 1, remaining: 1 },
      short: { limit: 3, remaining: 0, nextAt: Date.parse('2026-11-21T14:32:00Z') },
      audio: { limit: 2, remaining: 1, maxSeconds: 900 },
    })
  })

  it('fails open: quota routes that 404 (backend not deployed) show nothing and block nothing', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    const { result } = renderHook(() => useUploadQuota())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current).toMatchObject({ exempt: false, video: null, short: null, audio: null })
  })

  it('is never fetched for 3Speak Pro', async () => {
    m.premium = { premium: true }
    const { result } = renderHook(() => useUploadQuota())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ exempt: true, video: null, short: null, audio: null })
  })

  it('reads a warm-up account\'s video and Short counters under its handle, never audio', async () => {
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    fetchMock.mockImplementation(async () => ok({
      enabled: true, exempt: false, plan: 'warmup',
      video: { limit: 3, used: 1, remaining: 2, next_at: null }, short: { limit: 3, used: 0, remaining: 3, next_at: null },
    }))
    const { result } = renderHook(() => useUploadQuota())
    await waitFor(() => expect(result.current.video).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://embed.test/uploads/quota?owner=newbie')
    expect(result.current).toMatchObject({
      exempt: false, video: { limit: 3, remaining: 2, plan: 'warmup' }, short: { limit: 3, plan: 'warmup' }, audio: null,
    })
  })

  it('a warm-up ignores a free-plan answer (the server could not tell it is a warm-up and lets uploads through)', async () => {
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    const { result } = renderHook(() => useUploadQuota())
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ exempt: false, video: null, short: null, audio: null })
  })

  it('waits for the Pro lookup, so Pro never sees a free-plan note flash up', async () => {
    m.premium = null
    const { result } = renderHook(() => useUploadQuota())
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
  })

  it('trusts a server that says exempt', async () => {
    fetchMock.mockImplementation(async (url) => ok(String(url).includes('/api/audio/')
      ? { enabled: true, exempt: true, reason: 'listed', audio: { limit: null, remaining: null, next_at: null, max_seconds: null } }
      : { enabled: true, exempt: true, reason: 'listed' }))
    const { result } = renderHook(() => useUploadQuota())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current).toMatchObject({ exempt: true, video: null, short: null, audio: null })
  })

  it('only reads the kinds asked for', async () => {
    const { result } = renderHook(() => useUploadQuota({ video: false }))
    await waitFor(() => expect(result.current.audio).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://audio.test/api/audio/quota')
  })

  it('reads again after an upload (refreshUploadQuota)', async () => {
    const { result } = renderHook(() => useUploadQuota({ audio: false }))
    await waitFor(() => expect(result.current.video?.remaining).toBe(1))
    fetchMock.mockImplementation(async () => ok({ ...VIDEO_ON, video: { limit: 1, used: 1, remaining: 0, next_at: null } }))
    act(() => refreshUploadQuota())
    await waitFor(() => expect(result.current.video?.remaining).toBe(0))
  })
})
