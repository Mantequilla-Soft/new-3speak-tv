// @vitest-environment jsdom
// The bottom-of-list sentinel (components/InfiniteSentinel): asks for the next
// page when it comes near the viewport, not while a page is loading, and is gone
// once there is nothing more. Home's tabs and the watch page's "More videos" use it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import InfiniteSentinel from '../../../src/components/InfiniteSentinel/InfiniteSentinel.jsx'

let observers
class FakeObserver {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.nodes = new Set(); observers.push(this) }
  observe(n) { this.nodes.add(n) }
  disconnect() { this.nodes.clear(); this.gone = true }
  fire(isIntersecting) { this.cb([...this.nodes].map((target) => ({ target, isIntersecting }))) }
}
const live = () => observers.filter((o) => !o.gone)

beforeEach(() => { observers = []; vi.stubGlobal('IntersectionObserver', FakeObserver) })
afterEach(() => { vi.unstubAllGlobals() })

describe('InfiniteSentinel', () => {
  it('loads more when it comes within 600px of the screen', () => {
    const onLoadMore = vi.fn()
    const { container } = renderWithProviders(<InfiniteSentinel hasMore loading={false} onLoadMore={onLoadMore} />)
    expect(container.querySelector('.infinite-sentinel')).not.toBeNull()
    expect(live()[0].opts.rootMargin).toBe('600px')
    act(() => live()[0].fire(false))
    expect(onLoadMore).not.toHaveBeenCalled()
    act(() => live()[0].fire(true))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('waits while a page is loading, and says so', () => {
    const onLoadMore = vi.fn()
    const { container } = renderWithProviders(<InfiniteSentinel hasMore loading onLoadMore={onLoadMore} />)
    act(() => live()[0].fire(true))
    expect(onLoadMore).not.toHaveBeenCalled()
    expect(container.querySelector('.infinite-sentinel__loading')).not.toBeNull()
  })

  it('is gone once there is nothing more', () => {
    const { container } = renderWithProviders(<InfiniteSentinel hasMore={false} loading={false} onLoadMore={vi.fn()} />)
    expect(container.querySelector('.infinite-sentinel')).toBeNull()
    expect(live()).toHaveLength(0)
  })
})
