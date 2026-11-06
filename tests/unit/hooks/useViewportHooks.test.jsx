// Hooks that follow the browser (src/hooks/useOnline.js, useGalaxyFits.js and
// useCardSize.js): the connection state, whether the galaxy page fits the screen,
// and the card size in use (large cards are a phone-only setting). Each one
// re-renders on a change and stops listening when unmounted.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { fakeMatchMedia } from './helpers/query.jsx'

const store = vi.hoisted(() => ({ homeCardSize: 'small' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel(store) }))

const { default: useOnline } = await import('../../../src/hooks/useOnline.js')
const { default: useGalaxyFits, GALAXY_MIN_WIDTH } = await import('../../../src/hooks/useGalaxyFits.js')
const { default: useCardSize, useIsCardSizeMobile, CARD_SIZE_MOBILE_QUERY } = await import('../../../src/hooks/useCardSize.js')
const { LOCAL_STORAGE_USER_ID_KEY, LOCAL_STORAGE_ACCESS_TOKEN_KEY } = await import('../../../src/hooks/localStorageKeys.js')

let media
beforeEach(() => {
  media = fakeMatchMedia(false)
  media.install()
  store.homeCardSize = 'small'
})

describe('useOnline', () => {
  const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v })

  it('reports the connection and follows online/offline events', () => {
    setOnline(true)
    const { result, unmount } = renderHook(() => useOnline())
    expect(result.current).toBe(true)
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    expect(result.current).toBe(false)
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    expect(result.current).toBe(true)
    unmount()
  })

  it('stops listening once unmounted', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useOnline())
    unmount()
    expect(remove.mock.calls.map(([e]) => e)).toEqual(expect.arrayContaining(['online', 'offline']))
  })
})

describe('useGalaxyFits', () => {
  it('asks for the galaxy minimum width', () => {
    const spy = vi.fn(window.matchMedia)
    window.matchMedia = spy
    renderHook(() => useGalaxyFits())
    expect(spy).toHaveBeenCalledWith(`(min-width: ${GALAXY_MIN_WIDTH}px)`)
  })

  it('follows the screen growing and shrinking, and unsubscribes on unmount', () => {
    const { result, unmount } = renderHook(() => useGalaxyFits())
    expect(result.current).toBe(false)
    act(() => media.change(true))
    expect(result.current).toBe(true)
    expect(media.listenerCount).toBe(1)
    unmount()
    expect(media.listenerCount).toBe(0)
  })
})

describe('useCardSize', () => {
  it.each([
    [true, 'large', 'large'],
    [true, 'small', 'small'],
    [false, 'large', 'small'],
    [false, 'small', 'small'],
  ])('on a phone: %s, saved %s -> %s', (phone, saved, expected) => {
    media = fakeMatchMedia(phone)
    media.install()
    store.homeCardSize = saved
    const { result } = renderHook(() => useCardSize())
    expect(result.current).toBe(expected)
  })

  it('switches when the window crosses the phone width', () => {
    store.homeCardSize = 'large'
    const { result, unmount } = renderHook(() => useCardSize())
    expect(result.current).toBe('small')
    act(() => media.change(true))
    expect(result.current).toBe('large')
    unmount()
    expect(media.listenerCount).toBe(0)
  })

  it('uses the same cut as the settings toggle', () => {
    const spy = vi.fn(window.matchMedia)
    window.matchMedia = spy
    renderHook(() => useIsCardSizeMobile())
    expect(spy).toHaveBeenCalledWith(CARD_SIZE_MOBILE_QUERY)
  })
})

describe('the local storage key names', () => {
  it('match the keys the auth store writes', () => {
    expect([LOCAL_STORAGE_USER_ID_KEY, LOCAL_STORAGE_ACCESS_TOKEN_KEY]).toEqual(['user_id', 'access_token'])
  })
})
