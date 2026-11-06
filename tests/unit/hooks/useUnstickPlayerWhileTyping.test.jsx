// Phones: the sticky watch-page player lets go while a text field is focused
// (src/hooks/useUnstickPlayerWhileTyping.js), the field is centred once the
// keyboard opened, and the player sticks again a beat after leaving the field.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useUnstickPlayerWhileTyping from '../../../src/hooks/useUnstickPlayerWhileTyping.js'
import { fakeMatchMedia } from './helpers/query.jsx'

const composing = () => document.body.classList.contains('watch-composing')
let fields
let vvListeners

function field(html) {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  document.body.appendChild(wrap)
  const el = wrap.querySelector('[data-f]') || wrap.firstElementChild
  el.scrollIntoView = vi.fn()
  fields.push(wrap)
  return el
}
const focus = (el) => act(() => { el.focus() })
const blur = (el) => act(() => { el.blur() })

beforeEach(() => {
  vi.useFakeTimers()
  fields = []
  fakeMatchMedia(true).install()
  vvListeners = new Map()
  window.visualViewport = {
    addEventListener: vi.fn((e, fn) => vvListeners.set(e, fn)),
    removeEventListener: vi.fn((e) => vvListeners.delete(e)),
  }
})
afterEach(() => {
  for (const f of fields) f.remove()
  delete window.visualViewport
  vi.useRealTimers()
})

describe('on a phone', () => {
  it.each([
    ['a textarea', '<textarea></textarea>'],
    ['a text input', '<input type="text">'],
    ['a search input', '<input type="search">'],
    ['an email input', '<input type="email">'],
  ])('focusing %s unsticks the player', (_label, html) => {
    renderHook(() => useUnstickPlayerWhileTyping())
    focus(field(html))
    expect(composing()).toBe(true)
  })

  it.each([
    ['a checkbox', '<input type="checkbox">'],
    ['a button', '<button>Post</button>'],
    ['a field inside the player', '<div class="video-iframe-wrapper"><input data-f type="text"></div>'],
  ])('focusing %s leaves it sticky', (_label, html) => {
    renderHook(() => useUnstickPlayerWhileTyping())
    focus(field(html))
    expect(composing()).toBe(false)
  })

  it('centres the field once the keyboard resized the viewport', () => {
    renderHook(() => useUnstickPlayerWhileTyping())
    const el = field('<textarea></textarea>')
    focus(el)
    expect(el.scrollIntoView).not.toHaveBeenCalled()
    vvListeners.get('resize')()
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('falls back to a timer where there is no visual viewport', () => {
    delete window.visualViewport
    renderHook(() => useUnstickPlayerWhileTyping())
    const el = field('<textarea></textarea>')
    focus(el)
    vi.advanceTimersByTime(350)
    expect(el.scrollIntoView).toHaveBeenCalled()
  })

  it('sticks again 250 ms after leaving the field', () => {
    renderHook(() => useUnstickPlayerWhileTyping())
    const el = field('<textarea></textarea>')
    focus(el)
    blur(el)
    vi.advanceTimersByTime(249)
    expect(composing()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(composing()).toBe(false)
  })

  it('stays unstuck when focus moves straight to another field', () => {
    renderHook(() => useUnstickPlayerWhileTyping())
    const a = field('<textarea></textarea>')
    const b = field('<input type="text">')
    focus(a)
    focus(b)
    vi.advanceTimersByTime(500)
    expect(composing()).toBe(true)
  })

  it('unmounting removes the class and the listeners', () => {
    const { unmount } = renderHook(() => useUnstickPlayerWhileTyping())
    focus(field('<textarea></textarea>'))
    unmount()
    expect(composing()).toBe(false)
    focus(field('<textarea></textarea>'))
    expect(composing()).toBe(false)
  })
})

describe('on a wider screen', () => {
  it('never unsticks', () => {
    fakeMatchMedia(false).install()
    renderHook(() => useUnstickPlayerWhileTyping())
    focus(field('<textarea></textarea>'))
    expect(composing()).toBe(false)
  })
})
