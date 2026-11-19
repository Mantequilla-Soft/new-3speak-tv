// @vitest-environment jsdom
// The running poll over the phone stream player (FloatingStreamPoll.jsx): its
// own layer, so a tap reaches the vote; folds to a chip once you voted or
// closed it, the chip opens it again; a finished poll leaves (its results are
// in the chat).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const sdk = vi.hoisted(() => ({ state: null }))

vi.mock('@snapie/hangouts-react', () => ({
  usePolls: () => sdk.state,
  isPollFinished: (p) => p.status === 'ended' || p.status === 'resolved' || p.status === 'cancelled',
  PollCardView: ({ poll, onVote, canVote, myVote }) => (
    <section aria-label={poll.question}>
      {poll.options.map((o, i) => (
        <button key={i} type="button" disabled={!canVote} onClick={() => onVote(i)}>{o.label}{myVote === i ? ' ✓' : ''}</button>
      ))}
    </section>
  ),
}))

const { default: FloatingStreamPoll } = await import('../../../src/components/openpods/FloatingStreamPoll.jsx')

const poll = (over = {}) => ({
  id: 'p1', kind: 'poll', status: 'open', question: 'Next game?', endsAt: Date.now() + 45_000,
  options: [{ label: 'Chess' }, { label: 'Draw' }], total: 0, ...over,
})

function setPolls(over = {}) {
  sdk.state = {
    poll: poll(), myVote: null, myStake: null, balance: null, busy: false, error: null,
    isAuthenticated: true, vote: vi.fn(async () => {}), stake: vi.fn(), ...over,
  }
}

beforeEach(() => { localStorage.clear(); setPolls() })

describe('FloatingStreamPoll', () => {
  it('shows the running poll and a tap votes', () => {
    renderWithProviders(<FloatingStreamPoll roomName="badadib-room" />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(sdk.state.vote).toHaveBeenCalledWith(1)
  })

  it('folds to a chip once you voted, and the chip opens it again', () => {
    const { rerender } = renderWithProviders(<FloatingStreamPoll roomName="badadib-room" />)
    setPolls({ myVote: 0 })
    rerender(<FloatingStreamPoll roomName="badadib-room" />)
    expect(screen.queryByRole('region', { name: 'Next game?' })).toBeNull()
    const chip = screen.getByRole('button', { name: /open the poll/i })
    fireEvent.click(chip, { detail: 0 })
    expect(screen.getByRole('region', { name: 'Next game?' })).toBeTruthy()
  })

  it('closes to the chip by hand; a new poll shows open again', () => {
    const { rerender } = renderWithProviders(<FloatingStreamPoll roomName="badadib-room" />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.getByRole('button', { name: /open the poll/i })).toBeTruthy()
    setPolls({ poll: poll({ id: 'p2', question: 'Lunch?' }) })
    rerender(<FloatingStreamPoll roomName="badadib-room" />)
    expect(screen.getByRole('region', { name: 'Lunch?' })).toBeTruthy()
  })

  it('a prediction folds to its own chip', () => {
    setPolls({ poll: poll({ kind: 'prediction' }), myStake: { option: 0, amount: 5 } })
    renderWithProviders(<FloatingStreamPoll roomName="badadib-room" />)
    expect(screen.getByRole('button', { name: /open the prediction/i })).toBeTruthy()
  })

  it('leaves once the poll is over', () => {
    setPolls({ poll: poll({ status: 'ended' }) })
    const { container } = renderWithProviders(<FloatingStreamPoll roomName="badadib-room" />)
    expect(container.querySelector('.ws-poll, .ws-poll-chip')).toBeNull()
  })
})
