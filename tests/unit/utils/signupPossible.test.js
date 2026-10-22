// Asking Butter Auth whether this device's network may still create a free
// account; fails open and caches one answer per login state
// (src/utils/signupPossible.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../src/lib/store', () => ({ useAppStore: () => null }))

let mod
let fetchMock
beforeEach(async () => {
  vi.resetModules()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  mod = await import('../../../src/utils/signupPossible.js')
})

const reply = (body, ok = true) => ({ ok, json: async () => body })

describe('fetchSignupPossible', () => {
  it('asks Butter Auth from the browser without cookies', async () => {
    fetchMock.mockResolvedValue(reply({ possible: true }))
    await mod.fetchSignupPossible()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://butrauth.com/api/account/signup-possible')
    expect(opts.credentials).toBe('omit')
  })

  it('passes a refusal through with its reason', async () => {
    fetchMock.mockResolvedValue(reply({ possible: false, reason: 'vpn', message: 'VPN detected' }))
    expect(await mod.fetchSignupPossible()).toEqual({ possible: false, reason: 'vpn', message: 'VPN detected' })
  })

  it('only an explicit false closes signup', async () => {
    fetchMock.mockResolvedValue(reply({}))
    expect(await mod.fetchSignupPossible()).toEqual({ possible: true, reason: null, message: null })
  })

  it('fails open on an HTTP error, bad JSON or a network failure', async () => {
    fetchMock.mockResolvedValueOnce(reply({ possible: false }, false))
    expect(await mod.fetchSignupPossible('a')).toEqual({ possible: true })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('x') } })
    expect(await mod.fetchSignupPossible('b')).toEqual({ possible: true })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await mod.fetchSignupPossible('c')).toEqual({ possible: true })
  })

  it('asks once per login state, and again after the login changes', async () => {
    fetchMock.mockResolvedValue(reply({ possible: true }))
    await Promise.all([mod.fetchSignupPossible(''), mod.fetchSignupPossible('')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await mod.fetchSignupPossible('alice')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await mod.fetchSignupPossible('')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('resetSignupPossible forces a fresh answer', async () => {
    fetchMock.mockResolvedValue(reply({ possible: true }))
    await mod.fetchSignupPossible('x')
    mod.resetSignupPossible()
    await mod.fetchSignupPossible('x')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
