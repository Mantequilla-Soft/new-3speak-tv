// @vitest-environment jsdom
// "Install as app" on phones (components/InstallAppPrompt + utils/pwaInstall.js):
// the browser's install event is kept, the sheet comes after a short delay or
// the first move to another page, never in the installed app, never over a
// dialog or before the cookie question is answered, Not now hides it for 30
// days, an installed app never sees it again, and Safari on an iPhone gets the
// Share sheet steps instead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor, fireEvent } from '@testing-library/react'
import { useNavigate } from 'react-router-dom'
import { renderWithProviders, stubMatchMedia, useFakeClock } from './_render.jsx'

const consent = vi.hoisted(() => ({ decided: true }))
vi.mock('../../../src/lib/consent', () => ({ hasDecided: () => consent.decided }))

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1'
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const setUA = (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
const DAY = 24 * 3600 * 1000

let pwa
let gate
let Prompt
let installEvent

function fireInstallEvent(outcome = 'accepted') {
  installEvent = new Event('beforeinstallprompt', { cancelable: true })
  installEvent.prompt = vi.fn()
  installEvent.userChoice = Promise.resolve({ outcome })
  act(() => { window.dispatchEvent(installEvent) })
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  consent.decided = true
  setUA(ANDROID)
  stubMatchMedia(false) // not standalone
  pwa = await import('../../../src/utils/pwaInstall.js')
  gate = await import('../../../src/components/InstallAppPrompt/installGate.js')
  Prompt = (await import('../../../src/components/InstallAppPrompt/InstallAppPrompt.jsx')).default
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete navigator.userAgent
  delete navigator.standalone
})

describe('the rules', () => {
  it('phones only: Android phones and iPhones, not tablets or desktops', () => {
    expect(pwa.isPhoneDevice({ userAgent: ANDROID })).toBe(true)
    expect(pwa.isPhoneDevice({ userAgent: IPHONE_SAFARI })).toBe(true)
    expect(pwa.isPhoneDevice({ userAgent: ANDROID_TABLET })).toBe(false)
    expect(pwa.isPhoneDevice({ userAgent: IPAD })).toBe(false)
    expect(pwa.isPhoneDevice({ userAgent: DESKTOP })).toBe(false)
    expect(pwa.isPhoneDevice({ userAgent: DESKTOP, userAgentData: { mobile: true } })).toBe(true)
  })

  it('the Home Screen steps only in Safari on an iPhone, not in other browsers or in-app browsers', () => {
    expect(pwa.isIosSafariPhone({ userAgent: IPHONE_SAFARI })).toBe(true)
    expect(pwa.isIosSafariPhone({ userAgent: IPHONE_CHROME })).toBe(false)
    expect(pwa.isIosSafariPhone({ userAgent: IPHONE_INSTAGRAM })).toBe(false)
    expect(pwa.isIosSafariPhone({ userAgent: IPAD })).toBe(false)
    expect(pwa.isIosSafariPhone({ userAgent: ANDROID })).toBe(false)
  })

  it('which sheet: the install dialog when ready, the steps on iPhone Safari, nothing in the app, when snoozed or installed', () => {
    const now = 1_000_000
    const base = { phone: true, standalone: false, hasPrompt: true, iosSafari: false, state: {}, now }
    expect(gate.offerKind(base)).toBe('prompt')
    expect(gate.offerKind({ ...base, hasPrompt: false, iosSafari: true })).toBe('homeScreen')
    expect(gate.offerKind({ ...base, hasPrompt: false })).toBeNull()
    expect(gate.offerKind({ ...base, phone: false })).toBeNull()
    expect(gate.offerKind({ ...base, standalone: true })).toBeNull()
    expect(gate.offerKind({ ...base, state: { installed: true } })).toBeNull()
    expect(gate.offerKind({ ...base, state: { until: now + 1 } })).toBeNull()
    expect(gate.offerKind({ ...base, state: { until: now - 1 } })).toBe('prompt')
  })

  it('waits while a dialog is open, the cookie question is open, or something just started playing', () => {
    const doc = document.implementation.createHTMLDocument('')
    const now = 100_000
    expect(gate.blockedNow({ doc, now })).toBe(false)
    expect(gate.blockedNow({ doc, now, consentDecided: false })).toBe(true)
    expect(gate.blockedNow({ doc, now, lastMediaPlayAt: now - 3000 })).toBe(true)
    expect(gate.blockedNow({ doc, now, lastMediaPlayAt: now - gate.MEDIA_QUIET_MS - 1 })).toBe(false)
    doc.body.innerHTML = '<div role="dialog" aria-modal="true">Welcome tour</div>'
    expect(gate.blockedNow({ doc, now })).toBe(true)
    doc.body.innerHTML = '<div class="cookie-consent">Cookies</div>'
    expect(gate.blockedNow({ doc, now })).toBe(true)
    doc.body.innerHTML = '<div hidden><div role="dialog">kept mounted, hidden</div></div>'
    expect(gate.blockedNow({ doc, now })).toBe(false)
  })

  it('"Not now" keeps it away for 30 days, and the install event marks the app installed', () => {
    pwa.snoozeInstallPrompt(1000)
    expect(pwa.readInstallPromptState().until).toBe(1000 + 30 * DAY)
    window.dispatchEvent(new Event('appinstalled'))
    expect(pwa.readInstallPromptState()).toEqual({ installed: true })
  })

  it('storage that throws does not break anything', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      expect(pwa.readInstallPromptState()).toEqual({})
      expect(() => pwa.snoozeInstallPrompt()).not.toThrow()
      expect(() => pwa.markAppInstalled()).not.toThrow()
    } finally { get.mockRestore(); set.mockRestore() }
  })
})

describe('the sheet', () => {
  const sheet = () => screen.queryByRole('dialog', { name: /Install the 3Speak app/i })

  it('keeps the browser event, then offers Install after the first delay; Install opens the browser dialog', async () => {
    useFakeClock()
    renderWithProviders(<Prompt />)
    fireInstallEvent('accepted')
    expect(installEvent.defaultPrevented).toBe(true)
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS - 1000) })
    expect(sheet()).toBeNull() // not in the first seconds
    act(() => { vi.advanceTimersByTime(1500) })
    await waitFor(() => expect(sheet()).not.toBeNull())
    expect(screen.getByText(/full screen, quicker start, audio on the lock screen/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install' })) })
    expect(installEvent.prompt).toHaveBeenCalled()
    await waitFor(() => expect(pwa.readInstallPromptState()).toEqual({ installed: true }))
    expect(sheet()).toBeNull()
  })

  it('comes a moment after the first move to another page, before the long delay', async () => {
    useFakeClock()
    let go
    function Nav() { go = useNavigate(); return null }
    renderWithProviders(<><Prompt /><Nav /></>)
    fireInstallEvent()
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { go('/audio') })
    act(() => { vi.advanceTimersByTime(gate.AFTER_NAV_MS + 100) })
    await waitFor(() => expect(sheet()).not.toBeNull())
  })

  it('Not now hides it and keeps it away for 30 days', async () => {
    useFakeClock()
    const first = renderWithProviders(<Prompt />)
    fireInstallEvent()
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS + 100) })
    await waitFor(() => expect(sheet()).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(sheet()).toBeNull()
    const until = pwa.readInstallPromptState().until
    expect(until - Date.now()).toBeGreaterThan(29 * DAY)
    first.unmount()
    // The next visit: no sheet.
    renderWithProviders(<Prompt />)
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS * 3) })
    expect(sheet()).toBeNull()
  })

  it('never in the installed app (display-mode standalone)', async () => {
    useFakeClock()
    stubMatchMedia((q) => q.includes('display-mode: standalone'))
    renderWithProviders(<Prompt />)
    fireInstallEvent()
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS * 2) })
    await act(async () => {})
    expect(sheet()).toBeNull()
  })

  it('not on a desktop, nor without the browser event on Android', async () => {
    useFakeClock()
    renderWithProviders(<Prompt />)
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS * 2) })
    await act(async () => {})
    expect(sheet()).toBeNull()
    setUA(DESKTOP)
    fireInstallEvent()
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS) })
    await act(async () => {})
    expect(sheet()).toBeNull()
  })

  it('waits for the cookie question to be answered', async () => {
    useFakeClock()
    consent.decided = false
    renderWithProviders(<Prompt />)
    fireInstallEvent()
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS + gate.RETRY_MS * 3) })
    await act(async () => {})
    expect(sheet()).toBeNull()
    consent.decided = true
    act(() => { vi.advanceTimersByTime(gate.RETRY_MS + 10) })
    await waitFor(() => expect(sheet()).not.toBeNull())
  })

  it('Safari on an iPhone gets the Share, Add to Home Screen steps, once in 30 days', async () => {
    useFakeClock()
    setUA(IPHONE_SAFARI)
    renderWithProviders(<Prompt />)
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS + 100) })
    const ios = await screen.findByRole('dialog', { name: /Add 3Speak to your Home Screen/ })
    expect(ios).toHaveTextContent(/Share.*Add to Home Screen/)
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(pwa.readInstallPromptState().until).toBeGreaterThan(Date.now() + 29 * DAY)
  })

  it('an in-app browser on an iPhone gets nothing', async () => {
    useFakeClock()
    setUA(IPHONE_INSTAGRAM)
    renderWithProviders(<Prompt />)
    act(() => { vi.advanceTimersByTime(gate.FIRST_DELAY_MS * 2) })
    await act(async () => {})
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
