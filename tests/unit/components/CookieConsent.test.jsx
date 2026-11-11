// @vitest-environment jsdom
// The cookie and storage banner (components/CookieConsent/CookieConsent.jsx). It
// appears shortly after load for someone who has not answered, refusing is as
// easy as accepting, nothing optional is pre-ticked, and the copy follows whether
// third-party advertising is switched on in this build.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders, useFakeClock } from './_render.jsx'

const flags = vi.hoisted(() => ({ ads: false }))
const consent = vi.hoisted(() => ({ decided: false, setConsent: null }))
const ads = vi.hoisted(() => ({ notify: null, subscribe: null }))

vi.mock('../../../src/utils/config', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, get ENABLE_THIRDPARTY_ADS() { return flags.ads } }
})
vi.mock('../../../src/lib/consent', () => ({
  hasDecided: () => consent.decided,
  setConsent: (...a) => consent.setConsent(...a),
}))
vi.mock('../../../src/lib/thirdPartyAds', () => ({
  notifyAdConsentChanged: (...a) => ads.notify(...a),
  subscribeToCmp: (...a) => ads.subscribe(...a),
}))

const { default: CookieConsent } = await import('../../../src/components/CookieConsent/CookieConsent.jsx')

function mount() {
  const r = renderWithProviders(<CookieConsent />, { fakeTimers: true })
  act(() => { vi.advanceTimersByTime(600) })
  return r
}

beforeEach(() => {
  useFakeClock()
  flags.ads = false
  consent.decided = false
  consent.setConsent = vi.fn()
  ads.notify = vi.fn()
  ads.subscribe = vi.fn()
})
afterEach(() => vi.useRealTimers())

describe('the consent banner without third-party ads', () => {
  it('waits a moment after load before it appears, and starts listening for a CMP at once', () => {
    renderWithProviders(<CookieConsent />, { fakeTimers: true })
    expect(ads.subscribe).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(599) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('dialog', { name: 'Cookie and storage settings' })).toBeInTheDocument()
  })

  it('never appears for someone who already answered', () => {
    consent.decided = true
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says there is no advertising and offers two equal choices, without toggles', () => {
    mount()
    const banner = screen.getByRole('dialog')
    expect(within(banner).getByRole('heading', { name: 'Cookies & browser storage' })).toBeInTheDocument()
    expect(banner).toHaveTextContent('no tracking cookies, no advertising and no third-party analytics')
    expect(within(banner).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: 'Essential only' })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: 'Save choices' })).not.toBeInTheDocument()
  })

  it('shows and hides exactly what is stored', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'What exactly is stored?' }))
    expect(screen.getByText('Essential (always on)')).toBeInTheDocument()
    expect(screen.getByText('Your login session')).toBeInTheDocument()
    expect(screen.getByText(/Playback position per video/)).toBeInTheDocument()
    expect(screen.queryByText(/an outside advertising company's code/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.queryByText('Your login session')).not.toBeInTheDocument()
  })

  it('"Essential only" refuses everything optional and closes', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Essential only' }))
    expect(consent.setConsent).toHaveBeenCalledWith({ functional: false, advertising: false })
    expect(ads.notify).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Accept" turns on resume playback but never advertising', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(consent.setConsent).toHaveBeenCalledWith({ functional: true, advertising: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the consent banner with third-party ads switched on', () => {
  beforeEach(() => { flags.ads = true })

  it('names advertising as its own choice and starts with both toggles off', () => {
    mount()
    const banner = screen.getByRole('dialog')
    expect(banner).toHaveTextContent('One of them is advertising')
    expect(banner).not.toHaveTextContent('no advertising')
    expect(within(banner).getByRole('checkbox', { name: /Resume playback/ })).not.toBeChecked()
    expect(within(banner).getByRole('checkbox', { name: /Advertising/ })).not.toBeChecked()
  })

  it('"Save choices" saves exactly the toggles that were ticked', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('checkbox', { name: /Resume playback/ }))
    await user.click(screen.getByRole('button', { name: 'Save choices' }))
    expect(consent.setConsent).toHaveBeenCalledWith({ functional: true, advertising: false })
  })

  it('"Save choices" with nothing ticked is a refusal', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Save choices' }))
    expect(consent.setConsent).toHaveBeenCalledWith({ functional: false, advertising: false })
  })

  it('"Accept all" includes advertising', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(consent.setConsent).toHaveBeenCalledWith({ functional: true, advertising: true })
    expect(ads.notify).toHaveBeenCalledTimes(1)
  })

  it('lists the advertising storage in the details', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'What exactly is stored?' }))
    expect(screen.getByText(/an outside advertising company's code/)).toBeInTheDocument()
    expect(screen.getByText(/no advertising code is loaded at all/)).toBeInTheDocument()
  })
})
