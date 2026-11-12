// The ":" emoji list in comment boxes (src/hooks/useEmojiShortcodes.jsx), the
// way the chat does it.
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { createElement, act, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useEmojiShortcodes from '../../../src/hooks/useEmojiShortcodes.jsx'
import { loadEmojiData } from '../../../src/lib/emojiShortcodes.js'

// The emoji names load on demand (kept out of the first page download).
beforeAll(() => loadEmojiData())

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
let ownKeys

function Box() {
  const ref = useRef(null)
  const [text, setText] = useState('')
  const emoji = useEmojiShortcodes(ref, text, setText)
  return createElement('div', null,
    createElement('textarea', {
      ref, value: text,
      onChange: (e) => setText(emoji.change(e)),
      onKeyDown: (e) => { if (emoji.keyDown(e)) return; ownKeys.push(e.key) },
      onBlur: emoji.blur,
    }),
    emoji.popup)
}

const textarea = () => container.querySelector('textarea')
const list = () => document.body.querySelector('.emoji-shortcode-list')
const names = () => [...document.body.querySelectorAll('.emoji-shortcode-name')].map((n) => n.textContent)

function type(text) {
  const el = textarea()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  act(() => {
    setter.call(el, text)
    el.setSelectionRange(text.length, text.length)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(k) {
  act(() => { textarea().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
}

beforeEach(() => {
  ownKeys = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(Box)))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('comment box emoji shortcodes', () => {
  it('":" opens the list and ":fi" filters it', () => {
    type('great :')
    expect(list()).not.toBeNull()
    expect(names()).toContain(':fire:')
    type('great :fi')
    expect(names()).toContain(':fire:')
    expect(names()).not.toContain(':joy:')
  })

  it('Enter picks the highlighted one, and the box does not see that Enter', () => {
    type('great :fire')
    expect(names()[0]).toBe(':fire:')
    key('Enter')
    expect(textarea().value).toBe('great 🔥 ')
    expect(list()).toBeNull()
    expect(ownKeys).toEqual([])
  })

  it('↓ moves, Esc closes, other keys reach the box', () => {
    type(':')
    key('ArrowDown')
    expect(document.body.querySelector('.emoji-shortcode-item.active .emoji-shortcode-name').textContent).toBe(':heart:')
    key('Escape')
    expect(list()).toBeNull()
    key('Enter')
    expect(ownKeys).toEqual(['Enter'])
  })

  it('typing the closing ":" turns ":fire:" into 🔥', () => {
    type('so hot :fire:')
    expect(textarea().value).toBe('so hot 🔥')
    expect(list()).toBeNull()
  })

  it('no list for a time like 10:30', () => {
    type('at 10:')
    expect(list()).toBeNull()
  })
})
