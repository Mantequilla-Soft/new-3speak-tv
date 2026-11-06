// Who may import videos (src/hooks/useCanImportVideos.js): only someone with a
// verified profile link to a platform the importer reads, per import mode. The
// answer is cached per account for a minute and shared by concurrent callers; any
// error means "no" so the entry buttons stay hidden.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const links = vi.hoisted(() => ({ getLinks: vi.fn() }))
vi.mock('../../../src/utils/socialVerifier', () => ({ getLinks: (...a) => links.getLinks(...a) }))

let useCanImportVideos
beforeEach(async () => {
  vi.resetModules()
  links.getLinks.mockReset()
  useCanImportVideos = (await import('../../../src/hooks/useCanImportVideos.js')).default
})

describe('useCanImportVideos', () => {
  it('nobody signed in cannot import', () => {
    const { result } = renderHook(() => useCanImportVideos(null))
    expect(result.current).toBe(false)
    expect(links.getLinks).not.toHaveBeenCalled()
  })

  it('a verified YouTube link allows importing videos and shorts', async () => {
    links.getLinks.mockResolvedValue([{ platform: 'youtube', verified: true }])
    const { result } = renderHook(() => useCanImportVideos('BadAdib'))
    await waitFor(() => expect(result.current).toBe(true))
    expect(links.getLinks).toHaveBeenCalledWith('badadib')
  })

  it.each([
    ['shorts', 'tiktok', true],
    ['videos', 'tiktok', false],
    ['videos', 'bitchute', true],
    ['shorts', 'bitchute', false],
    ['unknown-mode', 'youtube', false],
  ])('in %s mode a %s link -> %s', async (mode, platform, allowed) => {
    links.getLinks.mockResolvedValue([{ platform }])
    const { result } = renderHook(() => useCanImportVideos('badadib', mode))
    await act(async () => {})
    await waitFor(() => expect(links.getLinks).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current).toBe(allowed)
  })

  it('an unverified link or a platform the importer does not read does not count', async () => {
    links.getLinks.mockResolvedValue([{ platform: 'youtube', verified: false }, { platform: 'mastodon' }])
    const { result } = renderHook(() => useCanImportVideos('badadib'))
    await act(async () => {})
    expect(result.current).toBe(false)
  })

  it('a failed lookup means no', async () => {
    links.getLinks.mockRejectedValue(new Error('checker down'))
    const { result } = renderHook(() => useCanImportVideos('badadib'))
    await act(async () => {})
    expect(result.current).toBe(false)
  })

  it('concurrent and repeated callers share one lookup per account', async () => {
    links.getLinks.mockResolvedValue([{ platform: 'youtube' }])
    const a = renderHook(() => useCanImportVideos('badadib'))
    const b = renderHook(() => useCanImportVideos('BADADIB'))
    await waitFor(() => expect(a.result.current && b.result.current).toBe(true))
    const c = renderHook(() => useCanImportVideos('badadib'))
    await waitFor(() => expect(c.result.current).toBe(true))
    expect(links.getLinks).toHaveBeenCalledTimes(1)
  })

  it('looks up again after the minute cache expires', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    links.getLinks.mockResolvedValue([{ platform: 'youtube' }])
    const a = renderHook(() => useCanImportVideos('badadib'))
    await waitFor(() => expect(a.result.current).toBe(true))
    vi.setSystemTime(61_000)
    const b = renderHook(() => useCanImportVideos('badadib'))
    await waitFor(() => expect(links.getLinks).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(b.result.current).toBe(true))
    vi.useRealTimers()
  })

  it('signing out clears the answer', async () => {
    links.getLinks.mockResolvedValue([{ platform: 'youtube' }])
    const { result, rerender } = renderHook(({ u }) => useCanImportVideos(u), { initialProps: { u: 'badadib' } })
    await waitFor(() => expect(result.current).toBe(true))
    rerender({ u: null })
    expect(result.current).toBe(false)
  })
})
