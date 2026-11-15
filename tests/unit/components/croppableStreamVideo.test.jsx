// @vitest-environment jsdom
// The phone player of a live stream (CroppableStreamVideo): plays the studio's
// own vertical video when the host sends one, otherwise crops the landscape
// picture, starting where the host placed their phone box.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import i18n from '../../../src/i18n'

const m = vi.hoisted(() => ({ formats: { hasVertical: false, crop: null }, videoProps: null }))
vi.mock('@snapie/hangouts-react', () => ({
  StreamVideo: (props) => { m.videoProps = props; return <div className="hh-stream-video"><video className="hh-stream-video__el" /></div> },
  useStreamFormats: () => m.formats,
  // The SDK's own maths (lib/verticalCrop.ts objectPositionFor).
  objectPositionFor: (c, vf) => (vf >= 1 ? 0.5 : Math.min(1, Math.max(0, (c - vf / 2) / (1 - vf)))),
}))

const { default: CroppableStreamVideo } = await import('../../../src/components/openpods/CroppableStreamVideo.jsx')

/** A phone-sized box (390 x 844) for the wrapper. */
class FakeResizeObserver {
  constructor(cb) { this.cb = cb }
  observe() { this.cb([{ contentRect: { width: 390, height: 844 } }]) }
  disconnect() {}
}

function decode(container, w, h) {
  const v = container.querySelector('video')
  Object.defineProperty(v, 'videoWidth', { value: w, configurable: true })
  Object.defineProperty(v, 'videoHeight', { value: h, configurable: true })
  act(() => { v.dispatchEvent(new Event('loadedmetadata')) })
}

describe('CroppableStreamVideo', () => {
  beforeEach(async () => {
    m.formats = { hasVertical: false, crop: null }
    m.videoProps = null
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    await i18n.changeLanguage('en')
  })

  it('plays the studio’s vertical video when there is one, and keeps the full-view switch', () => {
    m.formats = { hasVertical: true, crop: { on: true, x: 0.3, w: 0.316, follow: 'manual', track: true } }
    const onOrientation = vi.fn()
    const { container } = render(<CroppableStreamVideo vertical onOrientation={onOrientation} />)
    decode(container, 406, 720)
    expect(m.videoProps.format).toBe('vertical')
    expect(container.querySelector('.ws-crop--active')).toBeNull()
    // The stream is a landscape one even though a 9:16 picture is playing.
    expect(onOrientation).toHaveBeenLastCalledWith(true)
  })

  it('without a vertical video, crops the landscape picture where the host put the box', () => {
    m.formats = { hasVertical: false, crop: { on: true, x: 0.8, w: 0.316, follow: 'manual', track: false } }
    const { container } = render(<CroppableStreamVideo vertical />)
    decode(container, 1280, 720)
    expect(m.videoProps.format).toBe('landscape')
    const wrap = container.querySelector('.ws-crop--active')
    expect(wrap).not.toBeNull()
    const x = parseFloat(wrap.style.getPropertyValue('--ws-crop-x'))
    expect(x).toBeGreaterThan(85)
    expect(x).toBeLessThan(95)
  })

  it('centres the crop when the host set none, and plays landscape with vertical off', () => {
    const { container, rerender } = render(<CroppableStreamVideo vertical />)
    decode(container, 1280, 720)
    expect(container.querySelector('.ws-crop--active').style.getPropertyValue('--ws-crop-x')).toBe('50.00%')
    m.formats = { hasVertical: true, crop: null }
    rerender(<CroppableStreamVideo vertical={false} />)
    expect(m.videoProps.format).toBe('landscape')
    expect(container.querySelector('.ws-crop--active')).toBeNull()
  })
})
