// Ambient light (components/AmbientGlow/AmbientGlow.jsx): subtle ('page') is the
// default, and every browser that stored another mode is set back to subtle
// once (owner 2026-11-12); after that the viewer's own choice sticks.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readStoredMode, GLOW_RESET_KEY } from '../../../src/components/AmbientGlow/AmbientGlow.jsx'

const KEY = '3speak-ambient-glow'

describe('ambient light default', () => {
  beforeEach(() => localStorage.clear())

  it('is subtle in a browser that never chose', () => {
    expect(readStoredMode()).toBe('page')
  })

  it('sets an earlier choice back to subtle once', () => {
    localStorage.setItem(KEY, 'off')
    expect(readStoredMode()).toBe('page')
    expect(localStorage.getItem(KEY)).toBe('page')
    expect(localStorage.getItem(GLOW_RESET_KEY)).toBe('1')
  })

  it('keeps the choice made after the reset', () => {
    localStorage.setItem(KEY, 'vivid')
    readStoredMode()
    localStorage.setItem(KEY, 'off')
    expect(readStoredMode()).toBe('off')
    localStorage.setItem(KEY, 'vivid')
    expect(readStoredMode()).toBe('vivid')
  })
})
