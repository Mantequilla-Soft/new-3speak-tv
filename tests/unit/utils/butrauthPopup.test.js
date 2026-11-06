// @vitest-environment jsdom
// Opening a Butter Auth flow (src/utils/butrauthPopup.js): the start request to
// our API, the referrer and language carried on the authorize URL, a popup
// sized to the screen, and a full-page redirect when the popup is blocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ i18n: { resolvedLanguage: 'de', language: 'de-DE' }, invite: vi.fn(), withReferrer: vi.fn() }))
vi.mock('i18next', () => ({ default: h.i18n }))
vi.mock('../../../src/utils/referral', () => ({ withReferrer: h.withReferrer, getStoredInvite: h.invite }))

import { withLocale, openButrauthPopup } from '../../../src/utils/butrauthPopup.js'

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const AUTH = 'https://butrauth.example/authorize?client_id=3speak'

let fetchMock
let open
let originalLocation
beforeEach(() => {
  h.i18n.resolvedLanguage = 'de'
  h.i18n.language = 'de-DE'
  h.invite.mockReset().mockReturnValue('INV123')
  h.withReferrer.mockReset().mockImplementation((u) => `${u}&referrer=bob`)
  fetchMock = vi.fn(async () => reply(200, { url: AUTH }))
  vi.stubGlobal('fetch', fetchMock)
  open = vi.spyOn(window, 'open').mockReturnValue({ closed: false })
  Object.defineProperty(window.screen, 'availWidth', { value: 1920, configurable: true })
  Object.defineProperty(window.screen, 'availHeight', { value: 1080, configurable: true })
  originalLocation = window.location
  delete window.__butrauthLoginPopup
})
afterEach(() => {
  if (window.location !== originalLocation) Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
})

describe('withLocale', () => {
  it('adds the reading language as ui_locales', () => {
    expect(withLocale(AUTH)).toBe(`${AUTH}&ui_locales=de`)
  })

  it('keeps a ui_locales that is already there', () => {
    expect(withLocale(`${AUTH}&ui_locales=fr`)).toBe(`${AUTH}&ui_locales=fr`)
  })

  it('falls back to the raw language, and leaves the URL alone without one', () => {
    h.i18n.resolvedLanguage = undefined
    expect(withLocale(AUTH)).toBe(`${AUTH}&ui_locales=de-DE`)
    h.i18n.language = undefined
    expect(withLocale(AUTH)).toBe(AUTH)
  })

  it.each([['not a url'], [null], [42]])('passes %j through untouched', (url) => {
    expect(withLocale(url)).toBe(url)
  })
})

describe('openButrauthPopup', () => {
  it('starts the flow with the callback, the invite and which screen to open', async () => {
    await openButrauthPopup({ signup: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/manteauth/start')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init.body)).toEqual({
      redirect_uri: `${window.location.origin}/callback`, state: 'popup',
      signup: true, graduate: false, changeHandle: false, invite: 'INV123',
    })
  })

  it('opens a popup on the authorize URL with referrer and language, centred and sized to the screen', async () => {
    const popup = { closed: false }
    open.mockReturnValue(popup)
    expect(await openButrauthPopup()).toBe(true)
    const [url, name, features] = open.mock.calls[0]
    expect(url).toBe(`${AUTH}&referrer=bob&ui_locales=de`)
    expect(name).toBe('butrauth-login')
    // 42% of 1920 is 806, capped at 640; 92% of 1080 is 994, capped at 980.
    expect(features).toMatch(/^width=640,height=980,left=[\d.]+,top=[\d.]+$/)
    expect(window.__butrauthLoginPopup).toBe(popup)
  })

  it('never makes the popup smaller than the flow needs', async () => {
    Object.defineProperty(window.screen, 'availWidth', { value: 600, configurable: true })
    Object.defineProperty(window.screen, 'availHeight', { value: 500, configurable: true })
    await openButrauthPopup({ graduate: true })
    expect(open.mock.calls[0][2]).toMatch(/^width=420,height=660,/)
  })

  it('falls back to a full-page redirect when the popup is blocked', async () => {
    open.mockReturnValue(null)
    const location = { origin: 'https://3speak.tv', href: 'https://3speak.tv/' }
    Object.defineProperty(window, 'location', { value: location, configurable: true })
    expect(await openButrauthPopup({ changeHandle: true })).toBe(true)
    expect(location.href).toBe(`${AUTH}&referrer=bob&ui_locales=de`)
  })

  it.each([
    ['the API error', reply(400, { error: 'signups closed' }), 'signups closed'],
    ['a generic message', reply(200, {}), 'Could not start Butter Auth'],
  ])('throws %s when the flow cannot start', async (_name, res, message) => {
    fetchMock.mockResolvedValue(res)
    await expect(openButrauthPopup()).rejects.toThrow(message)
    expect(open).not.toHaveBeenCalled()
  })
})
