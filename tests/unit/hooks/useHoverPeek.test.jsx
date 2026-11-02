// Top-bar menus a mouse can peek at (src/hooks/useHoverPeek.js): the bell, the
// profile menu and Share. Resting on the button shows the menu, leaving fades it
// out, a click pins it; the button and the menu can be separate elements.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import useHoverPeek from '../../../src/hooks/useHoverPeek.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
let enabled

function Menu() {
  const m = useHoverPeek({ enabled })
  return createElement('div', null,
    createElement('button', { className: 'btn', onClick: m.toggle, ...m.hoverProps }),
    createElement('span', { className: 'gap' }),
    m.rendered && createElement('div', { className: `menu${m.leaving ? ' leaving' : ''}${m.open ? ' pinned' : ''}`, ...m.hoverProps, ...m.typingProps },
      createElement('input', { className: 'text', type: 'text', defaultValue: '' }),
      createElement('input', { className: 'switch', type: 'checkbox' })))
}

function typeInto(el) {
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}

const $ = (sel) => container.querySelector(sel)
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function pointer(type, el, related, pointerType = 'mouse') {
  const ev = new MouseEvent(type, { bubbles: true, relatedTarget: related || document.body })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  act(() => { el.dispatchEvent(ev) })
}
// Moving from one element onto another (React derives enter/leave from these).
function move(from, to) {
  pointer('pointerout', from, to)
  pointer('pointerover', to, from)
}

beforeEach(() => {
  vi.useFakeTimers()
  enabled = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(Menu)))
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

describe('useHoverPeek', () => {
  it('peeks after a short rest, and a quick pass shows nothing', async () => {
    pointer('pointerover', $('.btn'))
    await advance(100)
    pointer('pointerout', $('.btn'))
    await advance(500)
    expect($('.menu')).toBeNull()
    pointer('pointerover', $('.btn'))
    await advance(200)
    expect($('.menu')).not.toBeNull()
  })

  it('crossing from the button over a gap onto the menu keeps it', async () => {
    pointer('pointerover', $('.btn'))
    await advance(200)
    move($('.btn'), $('.gap'))
    await advance(100)
    move($('.gap'), $('.menu'))
    await advance(1000)
    expect($('.menu').className).not.toContain('leaving')
  })

  it('leaving fades it out, then it is gone', async () => {
    pointer('pointerover', $('.btn'))
    await advance(200)
    pointer('pointerout', $('.btn'))
    await advance(160)
    expect($('.menu').className).toContain('leaving')
    await advance(200)
    expect($('.menu')).toBeNull()
  })

  it('a click pins it; a second click fades it out and the mouse on the button does not reopen it', async () => {
    pointer('pointerover', $('.btn'))
    await advance(200)
    act(() => $('.btn').click())
    pointer('pointerout', $('.btn'))
    await advance(1000)
    expect($('.menu').className).toContain('pinned')
    pointer('pointerover', $('.btn'))
    act(() => $('.btn').click())
    expect($('.menu').className).toContain('leaving')
    pointer('pointerover', $('.btn'))
    await advance(1000)
    expect($('.menu')).toBeNull()
  })

  it('touch and a disabled peek only toggle on click', async () => {
    pointer('pointerover', $('.btn'), null, 'touch')
    await advance(1000)
    expect($('.menu')).toBeNull()
    enabled = false
    act(() => root.render(createElement(Menu)))
    pointer('pointerover', $('.btn'))
    await advance(1000)
    expect($('.menu')).toBeNull()
    act(() => $('.btn').click())
    expect($('.menu').className).toContain('pinned')
  })

  it('typing in a text box keeps a peek; a switch or a click inside does not', async () => {
    pointer('pointerover', $('.btn'))
    await advance(200)
    act(() => $('.switch').click())
    typeInto($('.switch'))
    act(() => $('.menu').click())
    expect($('.menu').className).not.toContain('pinned')
    typeInto($('.text'))
    expect($('.menu').className).toContain('pinned')
    pointer('pointerout', $('.btn'))
    await advance(1000)
    expect($('.menu')).not.toBeNull()
  })
})
