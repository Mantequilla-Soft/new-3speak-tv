// @vitest-environment jsdom
// The challenge pill on a Short in the player (components/ChallengeBanner/ChallengeShortPill):
// a Short carrying a challenge week's tag shows that week's theme and links to it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const { default: ChallengeShortPill } = await import('../../../src/components/ChallengeBanner/ChallengeShortPill.jsx')

const W48 = { week: '2026-W48', tag: 'challenge2026w48', texts: { en: { title: 'Your workspace', prompt: 'p' } } }
let asked
beforeEach(() => {
  asked = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    asked.push(String(url))
    const ok = /\/shorts-challenges\/2026-W48$/.test(String(url))
    return { ok, status: ok ? 200 : 404, json: async () => (ok ? { success: true, challenge: W48 } : {}) }
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('ChallengeShortPill', () => {
  it('a Short with a challenge tag shows the week\'s theme and links to that week', async () => {
    renderWithProviders(<ChallengeShortPill tags={['hive-181335', 'challenge2026w48']} />)
    const pill = await screen.findByTestId('challenge-short-pill')
    expect(pill).toHaveAttribute('href', '/challenge/2026-W48')
    expect(pill).toHaveTextContent('Weekly challenge · Your workspace')
  })

  it('nothing for a Short without one, and nothing asked', () => {
    const { container } = renderWithProviders(<ChallengeShortPill tags={['cats', 'hive-181335']} />)
    expect(container.querySelector('[data-testid="challenge-short-pill"]')).toBeNull()
    expect(asked).toEqual([])
  })

  it('nothing for the tag of a week the team never planned', async () => {
    const { container } = renderWithProviders(<ChallengeShortPill tags={['challenge2031w02']} />)
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    expect(container.querySelector('[data-testid="challenge-short-pill"]')).toBeNull()
  })
})
