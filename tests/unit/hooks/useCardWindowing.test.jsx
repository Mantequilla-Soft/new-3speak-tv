// Feed windowing (src/hooks/useCardWindowing.js): a card far from the viewport
// keeps its slot at its last height but drops its content; the first 12 cards
// always render; a remounted feed starts far cards at their remembered height.
// One shared IntersectionObserver per grid, and each card unobserves itself.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let observers
class FakeObserver {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.nodes = new Set(); observers.push(this) }
  observe(n) { this.nodes.add(n) }
  unobserve(n) { this.nodes.delete(n) }
  disconnect() { this.nodes.clear() }
  fire(target, isIntersecting, height) { this.cb([{ target, isIntersecting, boundingClientRect: { height } }]) }
}

let mod
beforeEach(async () => {
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  vi.resetModules()
  mod = await import('../../../src/hooks/useCardWindowing.js')
})
afterEach(() => { vi.unstubAllGlobals() })

function card(windowing, key, index, ownRef) {
  const hook = renderHook(({ w }) => mod.useWindowedCard(w, key, index, ownRef), { initialProps: { w: windowing } })
  const node = document.createElement('div')
  let cleanup
  act(() => { cleanup = hook.result.current.ref(node) })
  return { ...hook, node, cleanup: () => cleanup?.() }
}

describe('the grid', () => {
  it('is off (null) when disabled or without IntersectionObserver', () => {
    expect(renderHook(() => mod.useCardWindowing(false)).result.current).toBeNull()
    vi.stubGlobal('IntersectionObserver', undefined)
    expect(renderHook(() => mod.useCardWindowing(true)).result.current).toBeNull()
  })

  it('shares one observer that keeps 1.5 screens rendered around the viewport', () => {
    const w = renderHook(() => mod.useCardWindowing(true)).result.current
    card(w, 'a', 20)
    card(w, 'b', 21)
    expect(observers).toHaveLength(1)
    expect(observers[0].opts).toEqual({ rootMargin: '150% 0px' })
    expect(observers[0].nodes.size).toBe(2)
  })
})

describe('a card', () => {
  let w
  beforeEach(() => { w = renderHook(() => mod.useCardWindowing(true)).result.current })

  it('far from the viewport keeps its slot at the measured height, and fills in when near', () => {
    const c = card(w, 'far', 30)
    expect(c.result.current.hiddenHeight).toBeNull()
    act(() => observers[0].fire(c.node, false, 312))
    expect(c.result.current.hiddenHeight).toBe(312)
    act(() => observers[0].fire(c.node, true, 312))
    expect(c.result.current.hiddenHeight).toBeNull()
  })

  it('among the first 12 always renders in full', () => {
    const c = card(w, 'top', 3)
    act(() => observers[0].fire(c.node, false, 300))
    expect(c.result.current.hiddenHeight).toBeNull()
  })

  it('that has no height yet (not laid out) is not hidden', () => {
    const c = card(w, 'unlaid', 30)
    act(() => observers[0].fire(c.node, false, 0))
    expect(c.result.current.hiddenHeight).toBeNull()
  })

  it('remounted, starts as a slot of its remembered height', () => {
    const first = card(w, 'remember-me', 40)
    act(() => observers[0].fire(first.node, false, 250))
    first.unmount()
    const again = renderHook(() => mod.useWindowedCard(w, 'remember-me', 40))
    expect(again.result.current.hiddenHeight).toBe(250)
    // The top cards never start hidden, remembered or not.
    expect(renderHook(() => mod.useWindowedCard(w, 'remember-me', 2)).result.current.hiddenHeight).toBeNull()
  })

  it('unobserves itself on cleanup and ignores later observer entries', () => {
    const c = card(w, 'gone', 30)
    c.cleanup()
    expect(observers[0].nodes.has(c.node)).toBe(false)
    act(() => observers[0].fire(c.node, false, 200))
    expect(c.result.current.hiddenHeight).toBeNull()
  })

  it('passes the node to the ref it is composed with', () => {
    const own = vi.fn()
    const c = card(w, 'composed', 30, own)
    expect(own).toHaveBeenCalledWith(c.node)
  })

  it('shows everything once the grid stops windowing', () => {
    const c = card(w, 'mixed', 30)
    act(() => observers[0].fire(c.node, false, 280))
    c.rerender({ w: null })
    expect(c.result.current.hiddenHeight).toBeNull()
  })

  it('without windowing, the ref observes nothing', () => {
    const c = card(null, 'plain', 30)
    expect(observers).toHaveLength(0)
    expect(c.result.current.hiddenHeight).toBeNull()
  })
})
