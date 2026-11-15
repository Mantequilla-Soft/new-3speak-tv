// @vitest-environment jsdom
// The curator page (src/page/Curation.jsx) from a stand-in checker answer.
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

vi.mock('axios', () => ({ default: { get: vi.fn() } }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel({ user: 'fan' }) }))
const axios = (await import('axios')).default
const { default: Curation } = await import('../../../src/page/Curation.jsx')

const answer = {
  success: true, user: 'fan', days: 30, rules: { earlyShare: 0.1, earlyMinVotes: 10 },
  totals: { picks: 2, earnedHp: 1.234, rewardedPosts: 1, early: 1 },
  picks: [
    { author: 'badadib', permlink: 'vid', kind: 'video', title: 'My video', thumbnail: '', votedAt: new Date().toISOString(), percent: 100, curationHp: 1.234, rank: 1, votes: 11, early: true },
    { author: 'badadib', permlink: 'song', kind: 'audio', title: 'A song', thumbnail: '', votedAt: new Date().toISOString(), percent: 25, curationHp: 0, rank: 2, votes: 2, early: false },
  ],
}

describe('Curation page', () => {
  it('shows totals, picks, rewards and the early badge', async () => {
    axios.get.mockResolvedValueOnce({ data: answer })
    renderWithProviders(<Curation />, { route: '/curation/fan', path: '/curation/:user' })
    expect(await screen.findByText('My video')).toBeInTheDocument()
    expect(axios.get.mock.calls[0][0]).toMatch(/\/curation\/fan$/)
    expect(screen.getByText('+1.234 HP')).toBeInTheDocument()
    expect(screen.getByText('1.234 HP')).toBeInTheDocument()
    expect(screen.getAllByText('Found it early').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Pays out later')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /A song/ })).toHaveAttribute('href', '/audio/badadib/song')
    expect(screen.getByText(/at most 10% of the post's vote value/)).toBeInTheDocument()
  })

  it('says so when nothing was voted on', async () => {
    axios.get.mockResolvedValueOnce({ data: { ...answer, totals: { picks: 0, earnedHp: 0, early: 0 }, picks: [] } })
    renderWithProviders(<Curation />, { route: '/curation/fan', path: '/curation/:user' })
    expect(await screen.findByText(/No votes on 3Speak/)).toBeInTheDocument()
  })
})
