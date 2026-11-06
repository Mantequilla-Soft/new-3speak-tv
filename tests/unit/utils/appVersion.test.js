// @vitest-environment jsdom
// The "what's new" prompt (src/utils/appVersion.js): first visits are recorded
// silently, an upgrade prompts until the popup has been seen, and blocked
// storage never prompts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/version', () => ({ APP_VERSION: '2.0.0' }))

import { readAppVersion, markVersionSeen, APP_VERSION, APP_VERSION_STORAGE_KEY } from '../../../src/utils/appVersion.js'

beforeEach(() => localStorage.clear())

describe('readAppVersion', () => {
  it('records a first visit without prompting', () => {
    expect(readAppVersion()).toEqual({ previousVersion: null, shouldPrompt: false })
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe('2.0.0')
  })

  it('prompts after an upgrade, and keeps prompting until the popup is seen', () => {
    localStorage.setItem(APP_VERSION_STORAGE_KEY, '1.9.0')
    expect(readAppVersion()).toEqual({ previousVersion: '1.9.0', shouldPrompt: true })
    expect(readAppVersion()).toEqual({ previousVersion: '1.9.0', shouldPrompt: true })
    markVersionSeen()
    expect(readAppVersion()).toEqual({ previousVersion: null, shouldPrompt: false })
  })

  it('does not prompt on the same version', () => {
    localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION)
    expect(readAppVersion().shouldPrompt).toBe(false)
  })

  it('never prompts, and never throws, with storage blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readAppVersion()).toEqual({ previousVersion: null, shouldPrompt: false })
    expect(() => markVersionSeen()).not.toThrow()
  })
})
