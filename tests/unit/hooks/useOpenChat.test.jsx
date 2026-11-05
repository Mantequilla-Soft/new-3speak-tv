// The one way into chat (src/hooks/useOpenChat.js): wide screens open the overlay
// panel and keep the page, phones (and the chat page itself) go to /chat, a DM
// target carried in the URL.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fakeMatchMedia } from './helpers/query.jsx'

const nav = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav.navigate, useLocation: () => ({ pathname: nav.pathname }) }))
const chat = vi.hoisted(() => ({ openOverlay: vi.fn() }))
vi.mock('../../../src/context/ChatContext', () => ({ useChat: () => chat }))
const { useOpenChat, isPhoneWidth } = await import('../../../src/hooks/useOpenChat.js')

let media
beforeEach(() => {
  nav.navigate.mockReset()
  nav.pathname = '/'
  chat.openOverlay.mockReset()
  media = fakeMatchMedia(false)
  media.install()
})

describe('useOpenChat', () => {
  it('on a wide screen opens the overlay, with the DM if any', () => {
    const { result } = renderHook(() => useOpenChat())
    result.current({ dm: 'badadib' })
    expect(chat.openOverlay).toHaveBeenCalledWith({ dm: 'badadib' })
    result.current()
    expect(chat.openOverlay).toHaveBeenLastCalledWith({ dm: undefined })
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it.each([
    [{ dm: 'bada dib' }, '/chat?dm=bada%20dib'],
    [{}, '/chat'],
  ])('on a phone goes to the chat page: %o -> %s', (args, url) => {
    media = fakeMatchMedia(true)
    media.install()
    const { result } = renderHook(() => useOpenChat())
    result.current(args)
    expect(nav.navigate).toHaveBeenCalledWith(url)
    expect(chat.openOverlay).not.toHaveBeenCalled()
  })

  it('already on /chat, stays on the page instead of stacking an overlay', () => {
    nav.pathname = '/chat'
    const { result } = renderHook(() => useOpenChat())
    result.current({ dm: 'badadib' })
    expect(nav.navigate).toHaveBeenCalledWith('/chat?dm=badadib')
    expect(chat.openOverlay).not.toHaveBeenCalled()
  })

  it('isPhoneWidth is false where matchMedia is missing', () => {
    delete window.matchMedia
    expect(isPhoneWidth()).toBeFalsy()
  })
})
