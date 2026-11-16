// A poll under a snap (components/Polls/PollCard): options before voting, bars
// after voting with the viewer's own choice marked, moving a vote, a closed poll
// only shows results, and signed out asks to sign in. The polls API (Hive Open
// Polls, polls.hivehub.dev) and the posting path are fakes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ results: {}, votes: [] }))
vi.mock('../../../src/hive-api/aioha', async () => ({
  ...(await (await import('./_render.jsx')).aiohaModule()),
  customJsonWithAioha: vi.fn(async (keyType, id, json) => { h.votes.push({ id, ...JSON.parse(json) }); return { success: true } }),
}))
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success: vi.fn(), error }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: PollCard } = await import('../../../src/components/Polls/PollCard.jsx')

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
const snap = (poll) => ({ owner: 'badadib', permlink: 'poll-1', body: 'Which topic next?', poll })
const open = { options: ['Music', 'Code'], ends_at: new Date(Date.now() + 3 * 86400000).toISOString() }
// The API's row for a poll: votes per choice (numbered from 1) and who voted.
const row = (counts, { status = 'Active', voters = [] } = {}) => ({
  status, end_time: open.ends_at.slice(0, 19),
  poll_choices: counts.map((n, i) => ({ choice_num: i + 1, votes: { total_votes: n } })),
  poll_voters: voters,
})

beforeEach(() => {
  h.results = {}
  h.votes.length = 0
  error.mockReset()
  useAppStore.setState({ authenticated: true, user: 'fan' })
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const m = /author=eq\.([^&]+)&permlink=eq\.([^&]+)/.exec(url)
    const r = m && h.results[`${m[1]}/${m[2]}`]
    return reply(r ? [r] : [])
  }))
})

describe('poll card', () => {
  it('before voting: the options, no percentages', async () => {
    h.results = { 'badadib/poll-1': row([2, 1]) }
    renderWithProviders(<PollCard snap={snap(open)} />)
    expect(await screen.findByText('3 votes')).toBeInTheDocument()
    expect(screen.queryByText('67%')).toBeNull()
    expect(screen.getByText('Ends in 3 days')).toBeInTheDocument()
  })

  it('a vote shows the results with the own choice, and can be moved', async () => {
    h.results = { 'badadib/poll-1': row([0, 0]) }
    const { user } = renderWithProviders(<PollCard snap={snap(open)} />)
    await screen.findByText('0 votes')
    await user.click(screen.getByRole('button', { name: 'Music' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Music/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getAllByText('100%')).toHaveLength(1)
    expect(screen.getByText('Tap another option to change your vote.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Code/ }))
    // On Hive: a polls custom_json each time, choices counted from 1
    await waitFor(() => expect(h.votes).toEqual([
      { id: 'polls', poll: 'badadib/poll-1', action: 'vote', choices: [1] },
      { id: 'polls', poll: 'badadib/poll-1', action: 'vote', choices: [2] },
    ]))
    expect(screen.getByRole('button', { name: /Code/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 vote')).toBeInTheDocument()
  })

  it('a closed poll only shows results', async () => {
    h.results = { 'badadib/poll-1': row([1, 3], { status: 'Ended' }) }
    renderWithProviders(<PollCard snap={snap({ options: ['Music', 'Code'], ends_at: new Date(Date.now() - 1000).toISOString() })} />)
    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Code/ })).toBeDisabled()
  })

  it('signed out: results and a sign-in hint on tap', async () => {
    useAppStore.setState({ authenticated: false, user: null })
    h.results = { 'badadib/poll-1': row([1, 1]) }
    const { user } = renderWithProviders(<PollCard snap={snap({ options: ['Music', 'Code'], ends_at: null })} />)
    expect(await screen.findAllByText('50%')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Music/ }))
    expect(error).toHaveBeenCalledWith('Sign in to vote.')
    expect(h.votes).toEqual([])
  })
})

describe('poll card on the API', () => {
  it('shows the own earlier vote, and a poll the API has not read yet as 0 votes', async () => {
    h.results = { 'badadib/poll-1': row([1, 2], { voters: [{ name: 'fan', choices: [2] }] }) }
    const { unmount } = renderWithProviders(<PollCard snap={snap(open)} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Code/ })).toHaveAttribute('aria-pressed', 'true'))
    unmount()
    h.results = {}
    renderWithProviders(<PollCard snap={snap(open)} />)
    expect(await screen.findByText('0 votes')).toBeInTheDocument()
  })
})
