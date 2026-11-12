// utils/spotlightRules.js: what may appear in the Spotlight (owner 2026-11-12).
import { describe, it, expect } from 'vitest'
import { spotlightAllowed } from '../../../src/utils/spotlightRules.js'

describe('Spotlight rules', () => {
  it.each([
    'Jugué "Sky Tower" en "Cur8 Games" - Steemit',
    'My first post on BLURT',
    'Cross-posted from DTube',
    'steemit and blurt',
  ])('keeps out "%s"', (title) => {
    expect(spotlightAllowed({ title })).toBe(false)
  })

  it.each(['The best zombie catching game I ever played', 'Steem engine repair', 'Blue light', ''])('lets "%s" in', (title) => {
    expect(spotlightAllowed({ title })).toBe(true)
  })

  it('a video without a title is allowed', () => {
    expect(spotlightAllowed({})).toBe(true)
  })
})
