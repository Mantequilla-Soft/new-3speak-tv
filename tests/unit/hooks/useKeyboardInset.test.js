// keyboardInset (hooks/useKeyboardInset.js): how much of the screen bottom the
// on-screen keyboard covers, so the phone's full audio player can end above it
// and its comment box is never typed under the keys.
import { describe, it, expect } from 'vitest'
import { keyboardInset } from '../../../src/hooks/useKeyboardInset.js'

function win({ inner = 800, height = 800, offsetTop = 0, scale = 1, focus = 'TEXTAREA', type = '' } = {}) {
  return {
    innerHeight: inner,
    visualViewport: { height, offsetTop, scale },
    document: { activeElement: { tagName: focus, type, isContentEditable: false } },
  }
}

describe('keyboardInset', () => {
  it('is the covered part of the screen while typing', () => {
    expect(keyboardInset(win({ height: 480 }))).toBe(320)
    expect(keyboardInset(win({ height: 480, offsetTop: 120 }))).toBe(200)
  })

  it('is 0 with no text field focused, for an address bar, or when pinch-zoomed', () => {
    expect(keyboardInset(win({ height: 480, focus: 'BUTTON' }))).toBe(0)
    expect(keyboardInset(win({ height: 744 }))).toBe(0)
    expect(keyboardInset(win({ height: 400, scale: 2 }))).toBe(0)
  })

  it('is 0 where the browser already shrank the layout', () => {
    expect(keyboardInset(win({ inner: 480, height: 480 }))).toBe(0)
  })
})
