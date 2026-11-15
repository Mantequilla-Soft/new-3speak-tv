// The watch page's clip preview for "Shorts from this video" (hooks/useClipPreview):
// play a range and pause at its end, never fooled by the stale time right after
// the seek; and the Stats tab's `short=S-E` link opening the editor once.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClipPreview, useShortRangeParam } from '../../../src/hooks/useClipPreview.js'

function setup(initial = 480) {
  const seek = vi.fn()
  const pause = vi.fn()
  const hook = renderHook(({ currentTime }) => useClipPreview({ currentTime, seek, pause }), { initialProps: { currentTime: initial } })
  return { ...hook, seek, pause }
}

describe('useClipPreview', () => {
  it('seeks to the start, then pauses at the end', () => {
    const { result, rerender, seek, pause } = setup(480)
    act(() => result.current.toggle({ start: 240, end: 270 }))
    expect(seek).toHaveBeenCalledWith(240)
    expect(result.current.previewing).toEqual({ start: 240, end: 270 })
    // The old time (past the end) right after the seek must not stop it.
    rerender({ currentTime: 480 })
    expect(pause).not.toHaveBeenCalled()
    rerender({ currentTime: 240.2 })
    rerender({ currentTime: 255 })
    expect(result.current.previewing).not.toBeNull()
    rerender({ currentTime: 270.1 })
    expect(pause).toHaveBeenCalledTimes(1)
    expect(result.current.previewing).toBeNull()
  })

  it('scrubbing away ends the preview without pausing', () => {
    const { result, rerender, pause } = setup(0)
    act(() => result.current.toggle({ start: 240, end: 270 }))
    rerender({ currentTime: 241 })
    rerender({ currentTime: 30 })
    expect(result.current.previewing).toBeNull()
    expect(pause).not.toHaveBeenCalled()
  })

  it('the same range again stops it and pauses', () => {
    const { result, pause } = setup(0)
    act(() => result.current.toggle({ start: 240, end: 270 }))
    act(() => result.current.toggle({ start: 240, end: 270 }))
    expect(result.current.previewing).toBeNull()
    expect(pause).toHaveBeenCalledTimes(1)
  })
})

describe('useShortRangeParam', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('opens the range once when ready and drops it from the address', () => {
    window.history.replaceState(null, '', '/@badadib/my-video?t=240&short=240-270')
    const open = vi.fn()
    const { rerender } = renderHook(({ ready }) => useShortRangeParam({ ready, open }), { initialProps: { ready: false } })
    expect(open).not.toHaveBeenCalled()
    rerender({ ready: true })
    expect(open).toHaveBeenCalledWith({ start: 240, end: 270 })
    expect(window.location.search).toBe('?t=240')
    rerender({ ready: false })
    rerender({ ready: true })
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('nothing without the parameter', () => {
    window.history.replaceState(null, '', '/@badadib/my-video?t=240')
    const open = vi.fn()
    renderHook(() => useShortRangeParam({ ready: true, open }))
    expect(open).not.toHaveBeenCalled()
  })
})
