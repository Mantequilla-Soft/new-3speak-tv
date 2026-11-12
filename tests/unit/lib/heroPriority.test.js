// lib/heroPriority.js: the Spotlight's video goes before the cards' previews
// (owner 2026-11-12). A hold ends when the hero lets go, or after 3.5s at most.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { holdForHero, releaseHero, heroReady } from '../../../src/lib/heroPriority.js'

const settled = async (p) => { let done = false; p.then(() => { done = true }); await Promise.resolve(); await Promise.resolve(); return done }

afterEach(() => { releaseHero(true); vi.useRealTimers() })

describe('hero priority', () => {
  it('is open when nothing holds it', async () => {
    expect(await settled(heroReady())).toBe(true)
  })

  it('waits while the hero holds it, and opens when it lets go', async () => {
    const letGo = holdForHero()
    const ready = heroReady()
    expect(await settled(ready)).toBe(false)
    letGo()
    expect(await settled(ready)).toBe(true)
  })

  it('opens when the hero video plays (releaseHero), and never waits past 3.5s', async () => {
    holdForHero()
    const a = heroReady()
    releaseHero()
    expect(await settled(a)).toBe(true)

    vi.useFakeTimers()
    holdForHero()
    const b = heroReady()
    vi.advanceTimersByTime(3499)
    expect(await settled(b)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(await settled(b)).toBe(true)
  })
})
