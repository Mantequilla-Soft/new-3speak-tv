// @vitest-environment jsdom
// This week's Shorts challenge as a Home strip (components/ChallengeBanner/ChallengeStrip):
// the theme in bold and "See it" to /challenge; nothing in a week without one.
// "Hide" keeps it away for that week only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({ challenge: null }))
vi.mock('../../../src/lib/shortsChallenge', async (importOriginal) => ({
  ...(await importOriginal()),
  useCurrentChallenge: () => m.challenge,
}))
const { default: ChallengeStrip } = await import('../../../src/components/ChallengeBanner/ChallengeStrip.jsx')

const W48 = { week: '2026-W48', tag: 'challenge2026w48', theme: 'workspace', texts: { en: { title: 'Your workspace', prompt: 'Show where you create.' } } }

beforeEach(() => {
  m.challenge = null
  localStorage.clear()
})

describe('ChallengeStrip', () => {
  it('renders nothing in a week without a challenge', () => {
    const { container } = renderWithProviders(<ChallengeStrip />)
    expect(container.querySelector('.challenge-strip')).toBeNull()
  })

  it('names this week\'s theme in bold and links to the challenge page', () => {
    m.challenge = W48
    const { container } = renderWithProviders(<ChallengeStrip />)
    expect(container.querySelector('.nff-summary b')).toHaveTextContent('Your workspace')
    expect(container.querySelector('.nff-summary')).toHaveTextContent("Your workspace is this week's Shorts challenge")
    expect(screen.getByRole('link', { name: 'See it' })).toHaveAttribute('href', '/challenge')
  })

  it('Hide keeps it away for this week only; the next week shows again', () => {
    m.challenge = W48
    const { container, unmount } = renderWithProviders(<ChallengeStrip />)
    fireEvent.click(screen.getByRole('button', { name: "Hide until next week's challenge" }))
    expect(container.querySelector('.challenge-strip')).toBeNull()
    expect(localStorage.getItem('3speak-challenge-hidden')).toBe('2026-W48')
    unmount()

    expect(renderWithProviders(<ChallengeStrip />).container.querySelector('.challenge-strip')).toBeNull()
    m.challenge = { ...W48, week: '2026-W49', tag: 'challenge2026w49' }
    expect(renderWithProviders(<ChallengeStrip />).container.querySelector('.challenge-strip')).not.toBeNull()
  })
})
