// Emoji / GIF insertion into a text field (src/utils/composerInsert.js).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { gifMarkdown, insertAtCursor } from '../../../src/utils/composerInsert.js'

let rafCallbacks
beforeEach(() => {
  rafCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb) => { rafCallbacks.push(cb); return 1 })
})
afterEach(() => { document.body.innerHTML = '' })

const flush = () => rafCallbacks.splice(0).forEach((cb) => cb())
const mobile = (matches) => vi.stubGlobal('matchMedia', () => ({ matches }))

describe('gifMarkdown', () => {
  it('puts the GIF image on its own lines', () => {
    expect(gifMarkdown('https://g/x.gif')).toBe('\n![gif](https://g/x.gif)\n')
  })
})

describe('insertAtCursor', () => {
  it('appends when there is no field', () => {
    const set = vi.fn()
    insertAtCursor(null, 'abc', '😀', set)
    expect(set).toHaveBeenCalledWith('abc😀')
    insertAtCursor(undefined, undefined, 'x', set)
    expect(set).toHaveBeenLastCalledWith('x')
  })

  it('inserts at the caret, replacing a selection, and moves the caret after it', () => {
    mobile(false)
    const el = document.createElement('textarea')
    document.body.appendChild(el)
    el.value = 'hello world'
    el.setSelectionRange(6, 11)
    const set = vi.fn()
    insertAtCursor(el, 'hello world', '🌍', set)
    expect(set).toHaveBeenCalledWith('hello 🌍')
    el.value = 'hello 🌍'
    flush()
    expect(document.activeElement).toBe(el)
    expect(el.selectionStart).toBe(6 + '🌍'.length)
    expect(el.style.height).toMatch(/px$/)
  })

  it('on a phone leaves the focus alone so the keyboard stays down', () => {
    mobile(true)
    const el = document.createElement('input')
    document.body.appendChild(el)
    el.value = 'ab'
    el.setSelectionRange(1, 1)
    const focus = vi.spyOn(el, 'focus')
    const set = vi.fn()
    insertAtCursor(el, 'ab', 'X', set)
    expect(set).toHaveBeenCalledWith('aXb')
    flush()
    expect(focus).not.toHaveBeenCalled()
  })

  it('an element that unmounted before the next frame does not throw', () => {
    mobile(false)
    const el = { selectionStart: 0, selectionEnd: 0, focus: () => { throw new Error('gone') } }
    const set = vi.fn()
    insertAtCursor(el, 'x', 'y', set)
    expect(set).toHaveBeenCalledWith('yx')
    expect(() => flush()).not.toThrow()
  })
})
