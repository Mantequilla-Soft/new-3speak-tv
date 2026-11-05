// Measuring the card grid so a shorts rail fills exactly one row
// (src/hooks/useGridMetrics.js): the live column count read off the grid, how
// many shorts or tiles fit across it (phone and desktop sizes), re-measured on
// resize and when the grid mounts late; a hidden or missing grid measures 0.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { useRef } from 'react'
import { render, act } from '@testing-library/react'
import { useGridColumns, useShortsPerRow, useTilesPerRow } from '../../../src/hooks/useGridMetrics.js'
import { fakeMatchMedia } from './helpers/query.jsx'

let resizeObservers
class FakeResizeObserver {
  constructor(cb) { this.cb = cb; this.disconnected = false; resizeObservers.push(this) }
  observe() {}
  disconnect() { this.disconnected = true }
}
let templates
let widths

function Probe({ hook, withGrid, opts, onValue }) {
  const ref = useRef(null)
  const value = hook === 'tiles' ? useTilesPerRow(ref, 0, opts)
    : hook === 'shorts' ? useShortsPerRow(ref, 0) : useGridColumns(ref, 0)
  onValue(value)
  return <div ref={ref} data-testid="root">{withGrid && <div className="card-container" data-testid="grid" />}</div>
}

function mount(hook, { withGrid = true, opts } = {}) {
  const seen = []
  const r = render(<Probe hook={hook} withGrid={withGrid} opts={opts} onValue={(v) => seen.push(v)} />)
  return { ...r, value: () => seen.at(-1), rerenderWith: (props) => r.rerender(<Probe hook={hook} opts={opts} onValue={(v) => seen.push(v)} {...props} />) }
}
const resize = () => act(() => { for (const ro of resizeObservers) ro.cb([]) })

beforeEach(() => {
  resizeObservers = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  templates = new WeakMap()
  widths = { value: 0 }
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({ gridTemplateColumns: templates.get(el) ?? '' }))
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList.contains('card-container') ? widths.value : 0 } })
  fakeMatchMedia(false).install()
})
afterEach(() => { delete HTMLElement.prototype.clientWidth })

describe('useGridColumns', () => {
  it('reads the column count the browser laid out', () => {
    window.getComputedStyle.mockImplementation(() => ({ gridTemplateColumns: '220px 220px 220px' }))
    expect(mount('cols').value()).toBe(3)
  })

  it.each([['none', 0], ['', 0]])('a grid not laid out yet ("%s") is 0 columns', (tpl, n) => {
    window.getComputedStyle.mockImplementation(() => ({ gridTemplateColumns: tpl }))
    expect(mount('cols').value()).toBe(n)
  })

  it('re-measures when the width changes', () => {
    let tpl = '200px 200px'
    window.getComputedStyle.mockImplementation(() => ({ gridTemplateColumns: tpl }))
    const m = mount('cols')
    expect(m.value()).toBe(2)
    tpl = '200px 200px 200px 200px'
    resize()
    expect(m.value()).toBe(4)
  })

  it('measures the grid once it mounts later (skeletons first)', async () => {
    window.getComputedStyle.mockImplementation(() => ({ gridTemplateColumns: '1fr 1fr 1fr' }))
    const m = mount('cols', { withGrid: false })
    expect(m.value()).toBe(0)
    const grid = document.createElement('div')
    grid.className = 'card-container'
    await act(async () => { m.getByTestId('root').appendChild(grid) })
    expect(m.value()).toBe(3)
  })

  it('disconnects its observers on unmount', () => {
    const m = mount('cols')
    m.unmount()
    expect(resizeObservers.every((ro) => ro.disconnected)).toBe(true)
  })

  it('still measures once where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    window.getComputedStyle.mockImplementation(() => ({ gridTemplateColumns: 'a b' }))
    expect(mount('cols').value()).toBe(2)
  })
})

describe('useShortsPerRow', () => {
  it.each([
    [false, 1000, 6],
    [false, 166, 2],
    [false, 0, 0],
    [true, 360, 3],
    [true, 100, 2],
  ])('phone %s, %ipx wide -> %i shorts', (phone, width, n) => {
    fakeMatchMedia(phone).install()
    widths.value = width
    expect(mount('shorts').value()).toBe(n)
  })

  it('with no grid measures 0', () => {
    widths.value = 1000
    expect(mount('shorts', { withGrid: false }).value()).toBe(0)
  })

  it('follows the width', () => {
    widths.value = 500
    const m = mount('shorts')
    expect(m.value()).toBe(3)
    widths.value = 1200
    resize()
    expect(m.value()).toBe(7)
  })
})

describe('useTilesPerRow', () => {
  it('uses the tile size it is given', () => {
    widths.value = 1000
    expect(mount('tiles', { opts: { min: 90, gap: 10 } }).value()).toBe(10)
  })

  it('on a phone uses the phone size and never drops below the floor', () => {
    fakeMatchMedia(true).install()
    widths.value = 200
    expect(mount('tiles', { opts: { minPhone: 60, gapPhone: 4 } }).value()).toBe(3)
    expect(mount('tiles', { opts: { minPhone: 300, floor: 1 } }).value()).toBe(1)
  })

  it('defaults to the shorts sizes and measures 0 when hidden', () => {
    widths.value = 1000
    expect(mount('tiles').value()).toBe(6)
    widths.value = 0
    expect(mount('tiles').value()).toBe(0)
  })
})
