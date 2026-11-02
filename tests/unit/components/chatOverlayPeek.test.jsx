// The chat panel's hover peek (components/Chat/ChatOverlay.jsx): hung under the
// top bar's chat button, starting at the conversation list (an open thread marks
// messages read), not kept by clicking around, docked bottom-right when opened by a click.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const chat = vi.hoisted(() => ({ value: null }))
vi.mock('../../../src/context/ChatContext', () => ({ useChat: () => chat.value }))
vi.mock('../../../src/utils/lazyRoute', () => ({
  default: () => function ChatPanelStub() { return createElement('div', { className: 'panel-stub' }) },
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: ChatOverlay } = await import('../../../src/components/Chat/ChatOverlay.jsx')

let root
let container
let btn
const peekState = (over = {}) => ({
  shown: false, open: false, rendered: false, leaving: false,
  hold: vi.fn(), close: vi.fn(), toggle: vi.fn(), hoverProps: {}, typingProps: {}, ...over,
})
const panel = () => document.body.querySelector('.chat-overlay')
const render = () => act(() => root.render(createElement(MemoryRouter, null, createElement(ChatOverlay))))

beforeEach(() => {
  btn = document.createElement('button')
  btn.className = 'chat-nav-btn'
  btn.getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 900, right: 940, width: 40, height: 40 })
  document.body.appendChild(btn)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  chat.value = {
    overlayOpen: false, closeOverlay: vi.fn(), backToList: vi.fn(),
    activeConversation: { _id: 'c1' }, peek: peekState(),
  }
})
afterEach(() => { act(() => root.unmount()); container.remove(); btn.remove() })

describe('chat panel peek', () => {
  it('hangs under the button and goes back to the list', () => {
    chat.value.peek = peekState({ shown: true, rendered: true })
    render()
    expect(panel().className).toContain('chat-overlay--peek')
    expect(panel().style.top).toBe('56px')
    expect(chat.value.backToList).toHaveBeenCalled()
  })

  it('clicking around inside does not keep it (only typing or the pin do)', () => {
    chat.value.peek = peekState({ shown: true, rendered: true })
    render()
    act(() => { panel().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    act(() => { panel().click() })
    expect(chat.value.peek.hold).not.toHaveBeenCalled()
  })

  it('a kept peek does not throw away a conversation opened in it', () => {
    chat.value.peek = peekState({ shown: true, open: true, rendered: true })
    render()
    expect(chat.value.backToList).not.toHaveBeenCalled()
  })

  it('fading out', () => {
    chat.value.peek = peekState({ rendered: true, leaving: true })
    render()
    expect(panel().className).toContain('chat-overlay--leaving')
  })

  it('opened with a click: docked as before, no peek', () => {
    chat.value.overlayOpen = true
    render()
    expect(panel().className).not.toContain('--peek')
    expect(panel().style.top).toBe('')
    expect(chat.value.backToList).not.toHaveBeenCalled()
  })
})
