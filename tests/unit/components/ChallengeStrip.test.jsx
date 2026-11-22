// @vitest-environment jsdom
// This week's Shorts challenge as a Home strip (components/ChallengeBanner/ChallengeStrip):
// the theme in bold and "See it" to /challenge; nothing in a week without one.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({ challenge: null }))
vi.mock('../../../src/lib/shortsChallenge', async (importOriginal) => ({
  ...(await importOriginal()),
  useCurrentChallenge: () => m.challenge,
}))
const { default: ChallengeStrip } = await import('../../../src/components/ChallengeBanner/ChallengeStrip.jsx')

beforeEach(() => { m.challenge = null })

describe('ChallengeStrip', () => {
  it('renders nothing in a week without a challenge', () => {
    const { container } = renderWithProviders(<ChallengeStrip />)
    expect(container.querySelector('.challenge-strip')).toBeNull()
  })

  it('names this week\'s theme in bold and links to the challenge page', () => {
    m.challenge = { week: '2026-W48', tag: 'challenge2026w48', theme: 'workspace', texts: { en: { title: 'Your workspace', prompt: 'Show where you create.' } } }
    const { container } = renderWithProviders(<ChallengeStrip />)
    expect(container.querySelector('.nff-summary b')).toHaveTextContent('Your workspace')
    expect(container.querySelector('.nff-summary')).toHaveTextContent("Your workspace is this week's Shorts challenge")
    expect(screen.getByRole('link', { name: 'See it' })).toHaveAttribute('href', '/challenge')
  })
})
