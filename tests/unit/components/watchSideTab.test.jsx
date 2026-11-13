// @vitest-environment jsdom
// useSideTab (components/playVideo/WatchTabs.jsx): which side panel the watch page
// opens on. The tab last picked on any video wins, except on a live stream, which
// opens on its Live chat (also when the chat tab only appears once the page knows
// the stream is live) and then keeps the viewer's own pick on that page.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSideTab } from '../../../src/components/playVideo/WatchTabs.jsx'

const KEY = '3speak-watch-side-tab'

describe('useSideTab', () => {
  beforeEach(() => { localStorage.clear() })

  it('opens the tab last picked on another video', () => {
    localStorage.setItem(KEY, 'transcript')
    const { result } = renderHook(() => useSideTab(['discussion', 'transcript']))
    expect(result.current[0]).toBe('transcript')
  })

  it('falls back to the first tab when the remembered one is missing', () => {
    localStorage.setItem(KEY, 'transcript')
    const { result } = renderHook(() => useSideTab(['discussion', 'voters']))
    expect(result.current[0]).toBe('discussion')
  })

  it('opens a live stream on its Live chat, whatever was picked elsewhere', () => {
    localStorage.setItem(KEY, 'discussion')
    const { result } = renderHook(() => useSideTab(['chat', 'discussion']))
    expect(result.current[0]).toBe('chat')
  })

  it('switches to the Live chat when it appears after the page loaded', () => {
    localStorage.setItem(KEY, 'discussion')
    const { result, rerender } = renderHook(({ ids }) => useSideTab(ids), { initialProps: { ids: ['discussion'] } })
    expect(result.current[0]).toBe('discussion')
    rerender({ ids: ['chat', 'discussion'] })
    expect(result.current[0]).toBe('chat')
  })

  it('keeps the viewer\'s own pick on a live stream when more tabs arrive', () => {
    const { result, rerender } = renderHook(({ ids }) => useSideTab(ids), { initialProps: { ids: ['chat', 'discussion'] } })
    act(() => result.current[1]('discussion'))
    expect(result.current[0]).toBe('discussion')
    expect(localStorage.getItem(KEY)).toBe('discussion')
    rerender({ ids: ['chat', 'discussion', 'transcript'] })
    expect(result.current[0]).toBe('discussion')
  })
})
