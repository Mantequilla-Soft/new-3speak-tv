// @vitest-environment jsdom
// A finished stream's live chat beside its VOD: lines and polls at their
// second, later ones dimmed, times seek, hidden or muted accounts left out.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const api = vi.hoisted(() => ({}))
vi.mock('../../../src/lib/streamChatReplay', async (orig) => ({
  ...(await orig()),
  fetchChatReplay: (...a) => api.replay(...a),
  fetchStreamPolls: (...a) => api.polls(...a),
}))
vi.mock('../../../src/utils/hiddenCreators', () => ({ batchCheckFlags: (...a) => api.flags(...a) }))

const { default: StreamChatReplay } = await import('../../../src/components/StreamChatReplay/StreamChatReplay.jsx')

beforeEach(() => {
  api.replay = vi.fn(async () => [
    { id: 'fan/a', user: 'fan', text: 'hello stream', offset: 4 },
    { id: 'spam/b', user: 'spammer', text: 'buy now', offset: 6 },
    { id: 'badadib/c', user: 'badadib', text: 'thanks for coming', offset: 90 },
  ])
  api.polls = vi.fn(async () => [{ id: 'p1', kind: 'poll', question: 'Next game?', options: [{ label: 'Chess', votes: 3 }, { label: 'Draw', votes: 1 }], total: 4, status: 'closed', offset: 30 }])
  api.flags = vi.fn(async () => ({ hidden: new Set(), muted: new Set(['spammer']) }))
})

describe('StreamChatReplay', () => {
  it('shows the lines and the poll in time order, without muted accounts', async () => {
    renderWithProviders(<StreamChatReplay author="badadib" permlink="badadib-s1" currentTime={40} onSeek={() => {}} />)
    const log = await screen.findByRole('log', { name: 'The live chat, in step with the video' })
    expect(await within(log).findByText('hello stream')).toBeInTheDocument()
    expect(within(log).queryByText('buy now')).not.toBeInTheDocument()
    expect(within(log).getByText('Next game?')).toBeInTheDocument()
    expect(within(log).getByText(/Chess won/)).toBeInTheDocument()
    expect(within(log).getByText(/Votes: 4/)).toBeInTheDocument()
    expect(api.polls).toHaveBeenCalledWith('badadib-s1')
  })

  it('dims what is still ahead and seeks on a time', async () => {
    const onSeek = vi.fn()
    const { user } = renderWithProviders(<StreamChatReplay author="badadib" permlink="badadib-s1" currentTime={40} onSeek={onSeek} />)
    const later = await screen.findByText('thanks for coming')
    expect(later.closest('.hh-chat__msg')).toHaveClass('is-later')
    expect(screen.getByText('hello stream').closest('.hh-chat__msg')).not.toHaveClass('is-later')
    await user.click(screen.getByRole('button', { name: 'Go to 1:30' }))
    expect(onSeek).toHaveBeenCalledWith(90)
  })

  it('says so when nobody wrote', async () => {
    api.replay = vi.fn(async () => [])
    api.polls = vi.fn(async () => [])
    renderWithProviders(<StreamChatReplay author="badadib" permlink="badadib-s1" />)
    expect(await screen.findByText('Nobody wrote in the live chat.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Go to/ })).not.toBeInTheDocument()
  })
})
