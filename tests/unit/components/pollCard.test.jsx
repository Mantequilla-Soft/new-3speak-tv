// A poll under a snap (components/Polls/PollCard): options before voting, bars
// after voting with the viewer's own choice marked, moving a vote, a closed poll
// only shows results, and signed out asks to sign in. The checker is a fake.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(async (user) => ({ user, signature: 'SIG', timestamp: 7 })) }))
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success: vi.fn(), error }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: PollCard } = await import('../../../src/components/Polls/PollCard.jsx')

const h = { results: {}, votes: [] }
const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
const snap = (poll) => ({ owner: 'badadib', permlink: 'poll-1', body: 'Which topic next?', poll })
const open = { options: ['Music', 'Code'], ends_at: new Date(Date.now() + 3 * 86400000).toISOString() }

beforeEach(() => {
  h.results = {}
  h.votes = []
  error.mockReset()
  useAppStore.setState({ authenticated: true, user: 'fan' })
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.endsWith('/polls/vote')) {
      h.votes.push(body.choice)
      const counts = [0, 0]; counts[body.choice] = 1
      return reply({ result: { counts, total: 1, closed: false, ends_at: open.ends_at, mine: body.choice } })
    }
    return reply({ results: h.results })
  }))
})

describe('poll card', () => {
  it('before voting: the options, no percentages', async () => {
    h.results = { 'badadib/poll-1': { counts: [2, 1], total: 3, closed: false, ends_at: open.ends_at, mine: null } }
    renderWithProviders(<PollCard snap={snap(open)} />)
    expect(await screen.findByText('3 votes')).toBeInTheDocument()
    expect(screen.queryByText('67%')).toBeNull()
    expect(screen.getByText('Ends in 3 days')).toBeInTheDocument()
  })

  it('a vote shows the results with the own choice, and can be moved', async () => {
    h.results = { 'badadib/poll-1': { counts: [0, 0], total: 0, closed: false, ends_at: open.ends_at, mine: null } }
    const { user } = renderWithProviders(<PollCard snap={snap(open)} />)
    await screen.findByText('0 votes')
    await user.click(screen.getByRole('button', { name: 'Music' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Music/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getAllByText('100%')).toHaveLength(1)
    expect(screen.getByText('Tap another option to change your vote.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Code/ }))
    await waitFor(() => expect(h.votes).toEqual([0, 1]))
  })

  it('a closed poll only shows results', async () => {
    h.results = { 'badadib/poll-1': { counts: [1, 3], total: 4, closed: true, ends_at: null, mine: null } }
    renderWithProviders(<PollCard snap={snap({ options: ['Music', 'Code'], ends_at: new Date(Date.now() - 1000).toISOString() })} />)
    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Code/ })).toBeDisabled()
  })

  it('signed out: results and a sign-in hint on tap', async () => {
    useAppStore.setState({ authenticated: false, user: null })
    h.results = { 'badadib/poll-1': { counts: [1, 1], total: 2, closed: false, ends_at: null } }
    const { user } = renderWithProviders(<PollCard snap={snap({ options: ['Music', 'Code'], ends_at: null })} />)
    expect(await screen.findAllByText('50%')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Music/ }))
    expect(error).toHaveBeenCalledWith('Sign in to vote.')
    expect(h.votes).toEqual([])
  })
})
