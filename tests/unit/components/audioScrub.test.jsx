// Press and drag on the audio timelines (hooks/useTimelineScrub.js): pointer
// capture, the time above a thumb while dragging, the seek on release (live only
// for a local file), a cancel seeks nothing, and the press never reaches the
// gestures around the bar.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const { default: useTimelineScrub } = await import('../../../src/hooks/useTimelineScrub.js')
const { default: ScrubOverlay } = await import('../../../src/components/GlobalAudioPlayer/ScrubOverlay.jsx')

beforeAll(() => {
  // jsdom has no PointerEvent: a MouseEvent with the pointer fields stands in.
  if (!window.PointerEvent) {
    window.PointerEvent = class extends MouseEvent {
      constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse' }
    }
  }
})

function Bar({ duration = 200, onSeek, local = false, disabled = false, onParent }) {
  const scrub = useTimelineScrub({ duration, onSeek, local, disabled })
  return (
    <div data-testid="parent" onPointerDown={onParent} onClick={onParent}>
      <div data-testid="bar" role="slider" aria-valuenow={0} {...scrub.handlers}>
        <ScrubOverlay fraction={scrub.fraction} time={scrub.time} />
      </div>
    </div>
  )
}

let capture
beforeEach(() => {
  capture = vi.fn()
  HTMLElement.prototype.setPointerCapture = capture
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 400, top: 0, height: 6, right: 400, bottom: 6 })
})
afterEach(() => vi.restoreAllMocks())

const down = (el, x, o = {}) => fireEvent.pointerDown(el, { clientX: x, button: 0, pointerId: 7, pointerType: 'touch', ...o })
const move = (el, x) => fireEvent.pointerMove(el, { clientX: x, pointerId: 7 })
const up = (el, x) => fireEvent.pointerUp(el, { clientX: x, pointerId: 7 })

describe('dragging on an audio timeline', () => {
  it('captures the pointer, shows the time at the thumb, and seeks once on release', () => {
    const onSeek = vi.fn()
    const onParent = vi.fn()
    renderWithProviders(<Bar onSeek={onSeek} onParent={onParent} />)
    const bar = screen.getByTestId('bar')
    down(bar, 100)
    expect(capture).toHaveBeenCalledWith(7)
    expect(document.querySelector('.tl-scrub-tip')).toHaveTextContent('0:50')
    move(bar, 300)
    expect(document.querySelector('.tl-scrub-tip')).toHaveTextContent('2:30')
    expect(document.querySelector('.tl-scrub-thumb').style.left).toBe('75%')
    expect(onSeek).not.toHaveBeenCalled()
    up(bar, 320)
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(160)
    expect(document.querySelector('.tl-scrub-tip')).toBeNull()
    // The bar's swipes and the click that would open the player never see it.
    fireEvent.click(bar)
    expect(onParent).not.toHaveBeenCalled()
  })

  it('a drag past either end lands on the end', () => {
    const onSeek = vi.fn()
    renderWithProviders(<Bar onSeek={onSeek} />)
    const bar = screen.getByTestId('bar')
    down(bar, 50); move(bar, -80); up(bar, -80)
    expect(onSeek).toHaveBeenLastCalledWith(0)
    down(bar, 50); up(bar, 999)
    expect(onSeek).toHaveBeenLastCalledWith(200)
  })

  it('cancelled by the system (another gesture took it), nothing is seeked', () => {
    const onSeek = vi.fn()
    renderWithProviders(<Bar onSeek={onSeek} />)
    const bar = screen.getByTestId('bar')
    down(bar, 100); move(bar, 200)
    fireEvent.pointerCancel(bar, { pointerId: 7 })
    expect(onSeek).not.toHaveBeenCalled()
    expect(document.querySelector('.tl-scrub-tip')).toBeNull()
    // A move without a press does nothing.
    move(bar, 250)
    expect(document.querySelector('.tl-scrub-tip')).toBeNull()
  })

  it('a local file seeks while dragging too, throttled', () => {
    const onSeek = vi.fn()
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    renderWithProviders(<Bar onSeek={onSeek} local />)
    const bar = screen.getByTestId('bar')
    down(bar, 0)
    move(bar, 100)
    expect(onSeek).toHaveBeenLastCalledWith(50)
    move(bar, 120) // same instant: throttled
    expect(onSeek).toHaveBeenCalledTimes(1)
    now.mockReturnValue(10_200)
    move(bar, 200)
    expect(onSeek).toHaveBeenLastCalledWith(100)
    up(bar, 200)
    expect(onSeek).toHaveBeenCalledTimes(3)
  })

  it('no drag without a length, when switched off, or with another mouse button', () => {
    const onSeek = vi.fn()
    const { unmount } = renderWithProviders(<Bar onSeek={onSeek} duration={0} />)
    down(screen.getByTestId('bar'), 100); up(screen.getByTestId('bar'), 100)
    unmount()
    const second = renderWithProviders(<Bar onSeek={onSeek} disabled />)
    down(screen.getByTestId('bar'), 100); up(screen.getByTestId('bar'), 100)
    second.unmount()
    renderWithProviders(<Bar onSeek={onSeek} />)
    down(screen.getByTestId('bar'), 100, { button: 2, pointerType: 'mouse' }); up(screen.getByTestId('bar'), 100)
    expect(onSeek).not.toHaveBeenCalled()
  })
})
