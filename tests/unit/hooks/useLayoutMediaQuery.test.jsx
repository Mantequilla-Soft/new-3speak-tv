// src/hooks/useLayoutMediaQuery.js: a layout media query as state, held still
// while a video is fullscreen. A phone rotating to landscape for a fullscreen
// channel trailer used to swap the profile to the wide layout, unmount the
// <video> and drop out of fullscreen.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { fakeMatchMedia } from './helpers/query.jsx'

const { default: useLayoutMediaQuery } = await import('../../../src/hooks/useLayoutMediaQuery.js')

const setFullscreenElement = (el) =>
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el })

let media
beforeEach(() => {
  media = fakeMatchMedia(true)
  media.install()
  setFullscreenElement(null)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  setFullscreenElement(null)
})

describe('useLayoutMediaQuery', () => {
  it('follows the query outside fullscreen', () => {
    const { result } = renderHook(() => useLayoutMediaQuery('(max-width: 767px)'))
    expect(result.current).toBe(true)
    act(() => media.change(false))
    expect(result.current).toBe(false)
  })

  it('ignores the rotation while fullscreen, then catches up once it has settled', () => {
    const { result } = renderHook(() => useLayoutMediaQuery('(max-width: 767px)'))
    act(() => {
      setFullscreenElement(document.body)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    act(() => media.change(false)) // turned to landscape
    expect(result.current).toBe(true)

    // Left fullscreen but held sideways: the wide layout follows, after the settle wait.
    act(() => {
      setFullscreenElement(null)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(600))
    expect(result.current).toBe(false)
  })

  it('treats iOS native video fullscreen the same way', () => {
    const { result } = renderHook(() => useLayoutMediaQuery('(max-width: 767px)'))
    const video = document.createElement('video')
    document.body.appendChild(video)
    act(() => video.dispatchEvent(new Event('webkitbeginfullscreen')))
    act(() => media.change(false))
    expect(result.current).toBe(true)
    act(() => {
      media.change(true) // rotated back before leaving
      video.dispatchEvent(new Event('webkitendfullscreen'))
      vi.advanceTimersByTime(600)
    })
    expect(result.current).toBe(true)
    video.remove()
  })

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useLayoutMediaQuery('(max-width: 767px)'))
    expect(media.listenerCount).toBe(1)
    unmount()
    expect(media.listenerCount).toBe(0)
  })
})
