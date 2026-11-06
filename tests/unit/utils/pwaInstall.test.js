// @vitest-environment jsdom
// usePwaInstall (src/utils/pwaInstall.js): the "Install App" entry. The
// browser's one-time beforeinstallprompt event is caught at import time, so a
// menu that mounts later still gets it; iOS (no prompt, Share sheet only) and
// an already installed app are told apart. Each test imports a fresh copy of
// the module, since the caught event lives in module state.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let standalone
beforeEach(() => {
  vi.resetModules()
  standalone = false
  window.matchMedia = vi.fn((query) => ({ matches: query === '(display-mode: standalone)' && standalone }))
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) Chrome/130')
  delete navigator.standalone
})

const load = () => import('../../../src/utils/pwaInstall.js')

function installPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  let choose
  event.prompt = vi.fn()
  event.userChoice = new Promise((r) => { choose = r })
  event.choose = choose
  return event
}

describe('usePwaInstall', () => {
  it('offers nothing on a desktop browser that has not sent an install prompt', async () => {
    const { usePwaInstall } = await load()
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current).toMatchObject({ canInstallPrompt: false, isIOS: false, showInstall: false })
  })

  it('catches the install prompt, suppressing the browser\'s own mini bar', async () => {
    const { usePwaInstall } = await load()
    const { result } = renderHook(() => usePwaInstall())
    const event = installPrompt()
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(result.current).toMatchObject({ canInstallPrompt: true, showInstall: true })
  })

  it('remembers a prompt that arrived before any menu mounted', async () => {
    const { usePwaInstall } = await load()
    window.dispatchEvent(installPrompt())
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.canInstallPrompt).toBe(true)
  })

  it('shows the browser dialog once, then forgets the single-use event everywhere', async () => {
    const { usePwaInstall } = await load()
    const event = installPrompt()
    window.dispatchEvent(event)
    const menuA = renderHook(() => usePwaInstall())
    const menuB = renderHook(() => usePwaInstall())

    let done
    act(() => { done = menuA.result.current.promptInstall() })
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(menuA.result.current.canInstallPrompt).toBe(false)
    expect(menuB.result.current.canInstallPrompt).toBe(false)

    event.choose({ outcome: 'accepted' })
    await act(() => done)
    await act(() => menuB.result.current.promptInstall())
    expect(event.prompt).toHaveBeenCalledTimes(1)
  })

  it('does nothing when asked to prompt without an event', async () => {
    const { usePwaInstall } = await load()
    const { result } = renderHook(() => usePwaInstall())
    await expect(result.current.promptInstall()).resolves.toBeUndefined()
  })

  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) Safari/604.1'],
  ])('on an %s offers the Share-sheet instructions without a prompt', async (_label, ua) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    const { usePwaInstall } = await load()
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current).toMatchObject({ isIOS: true, canInstallPrompt: false, showInstall: true })
  })

  it.each([
    ['running as an installed app', () => { standalone = true }],
    ['launched from the iOS home screen', () => { navigator.standalone = true }],
  ])('hides the entry when %s', async (_label, arrange) => {
    arrange()
    const { usePwaInstall } = await load()
    window.dispatchEvent(installPrompt())
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.showInstall).toBe(false)
  })

  it('stops updating a menu after it unmounts', async () => {
    const { usePwaInstall } = await load()
    const { result, unmount } = renderHook(() => usePwaInstall())
    unmount()
    const errors = vi.spyOn(console, 'error')
    window.dispatchEvent(installPrompt())
    expect(result.current.canInstallPrompt).toBe(false)
    expect(errors).not.toHaveBeenCalled()
  })
})
