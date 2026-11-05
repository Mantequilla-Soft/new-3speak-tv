// Paging between live streams on the full-bleed stream page
// (src/hooks/useLiveStreamPager.js): a wheel or a swipe goes to the next or
// previous live room, wrapping, with a cooldown; and with no other stream live
// the gesture does nothing at all.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'

const nav = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav.navigate }))
const live = vi.hoisted(() => ({ rooms: [], opts: null }))
vi.mock('../../../src/hooks/useLiveStreams', () => ({
  useLiveStreams: (opts) => { live.opts = opts; return live.rooms.map((roomName) => ({ roomName })) },
}))
const { useLiveStreamPager } = await import('../../../src/hooks/useLiveStreamPager.js')

let out
function Page({ room, enabled }) {
  out = useLiveStreamPager({ currentRoom: room, enabled })
  return <div data-testid="stage" ref={out.containerRef} />
}
const stage = (r) => r.getByTestId('stage')
const wheel = (el, deltaY) => {
  const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true })
  act(() => { el.dispatchEvent(e) })
  return e
}
const touch = (el, type, y) => {
  const e = new Event(type, { bubbles: true })
  Object.defineProperty(e, type === 'touchstart' ? 'targetTouches' : 'changedTouches', { value: [{ clientY: y }] })
  act(() => { el.dispatchEvent(e) })
}
const swipe = (el, from, to) => { touch(el, 'touchstart', from); touch(el, 'touchend', to) }

beforeEach(() => {
  vi.useFakeTimers()
  nav.navigate.mockReset()
  live.rooms = ['a', 'b', 'c']
})
afterEach(() => vi.useRealTimers())

describe('useLiveStreamPager', () => {
  it('reads every host, not the discovery-filtered list', () => {
    render(<Page room="a" />)
    expect(live.opts).toEqual({ includeAllHosts: true })
  })

  it('scrolling down goes to the next stream and blocks the page scroll', () => {
    const r = render(<Page room="a" />)
    const e = wheel(stage(r), 40)
    expect(nav.navigate).toHaveBeenCalledWith('/watch/b')
    expect(e.defaultPrevented).toBe(true)
  })

  it('scrolling up from the first stream wraps to the last', () => {
    const r = render(<Page room="a" />)
    wheel(stage(r), -40)
    expect(nav.navigate).toHaveBeenCalledWith('/watch/c')
  })

  it('ignores trackpad jitter', () => {
    const r = render(<Page room="a" />)
    wheel(stage(r), 5)
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('pages once per gesture: a cooldown swallows the burst that follows', () => {
    const r = render(<Page room="a" />)
    wheel(stage(r), 40)
    wheel(stage(r), 40)
    expect(nav.navigate).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(700) })
    wheel(stage(r), 40)
    expect(nav.navigate).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a swipe up goes next', 400, 300, '/watch/c'],
    ['a swipe down goes back', 300, 400, '/watch/a'],
  ])('%s', (_label, from, to, url) => {
    const r = render(<Page room="b" />)
    swipe(stage(r), from, to)
    expect(nav.navigate).toHaveBeenCalledWith(url)
  })

  it('a short drag is not a swipe', () => {
    const r = render(<Page room="b" />)
    swipe(stage(r), 300, 270)
    touch(stage(r), 'touchend', 100)
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('a stream that is not in the list starts from the top (or the bottom going back)', () => {
    const r = render(<Page room="ended" />)
    wheel(stage(r), 40)
    expect(nav.navigate).toHaveBeenLastCalledWith('/watch/a')
    act(() => { vi.advanceTimersByTime(700) })
    wheel(stage(r), -40)
    expect(nav.navigate).toHaveBeenLastCalledWith('/watch/c')
  })

  it('with no other stream live there is nowhere to go and nothing happens', () => {
    live.rooms = ['a']
    const r = render(<Page room="a" />)
    expect(out.hasNext).toBe(false)
    const e = wheel(stage(r), 40)
    swipe(stage(r), 400, 100)
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('does nothing while disabled', () => {
    const r = render(<Page room="a" enabled={false} />)
    expect(out.hasNext).toBe(true)
    wheel(stage(r), 40)
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', () => {
    const r = render(<Page room="a" />)
    const el = stage(r)
    r.unmount()
    wheel(el, 40)
    expect(nav.navigate).not.toHaveBeenCalled()
  })
})
