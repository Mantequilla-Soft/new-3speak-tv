// @vitest-environment jsdom
// After a vote (components/tooltip/UpvoteTooltip.jsx) the toast says what the vote
// added and roughly what it earns in curation (lib/curation.js). Nothing is broadcast.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { renderWithProviders, toastMessages } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule({ isLoggedIn: vi.fn(() => true) }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: () => ({ user: 'fan', authenticated: true }) }))
vi.mock('../../../src/utils/viewerTag', () => ({ recordViewerTag: vi.fn(), VIEWER_TAG_OPTIONS: [] }))
const post = { active_votes: [], created: new Date(Date.now() - 2 * 3600e3).toISOString().slice(0, 19), cashout_time: new Date(Date.now() + 100 * 3600e3).toISOString().slice(0, 19), allow_curation_rewards: true, max_accepted_payout: '1000000.000 HBD' }
vi.mock('../../../src/utils/hiveUtils', () => ({
  estimate: vi.fn(async () => '0.120'),
  getVotePower: vi.fn(async () => ({ account: { name: 'fan' } })),
  getUersContent: vi.fn(async () => post),
}))

const { toast } = await import('sonner')
const aioha = await import('../../../src/hive-api/aioha')
const hiveUtils = await import('../../../src/utils/hiveUtils')
const { default: UpvoteTooltip } = await import('../../../src/components/tooltip/UpvoteTooltip.jsx')

function Harness() {
  const [show, setShow] = useState(true)
  const [value, setValue] = useState('0.000')
  const [weight, setWeight] = useState(100)
  const [account, setAccount] = useState(null)
  return (
    <UpvoteTooltip author="badadib" permlink="vid" showTooltip={show} setShowTooltip={setShow} voteValue={value} setVoteValue={setValue}
      setIsVoted={() => {}} weight={weight} setWeight={setWeight} accountData={account} setAccountData={setAccount} setOptimisticVoteCount={() => {}} />
  )
}

beforeEach(() => { toast.success.mockClear() })

describe('vote toast with curation', () => {
  it('a new early vote: value added and about half of it as curation', async () => {
    const { user } = renderWithProviders(<Harness />)
    await screen.findByText('adds about $0.120')
    await user.click(screen.getByRole('button', { name: 'Vote' }))
    expect(aioha.voteWithAioha).toHaveBeenCalledWith('badadib', 'vid', 10000, null)
    expect(toastMessages(toast.success)).toEqual(['Your vote added about $0.12 to this post and should earn you about $0.06 in curation when it pays out.'])
  })

  it('a changed vote earns no curation, so the toast leaves it out', async () => {
    hiveUtils.getUersContent.mockResolvedValueOnce({ ...post, active_votes: [{ voter: 'fan', percent: 5000 }] })
    const { user } = renderWithProviders(<Harness />)
    await screen.findByText('adds about $0.120')
    await user.click(screen.getByRole('button', { name: 'Vote' }))
    expect(toastMessages(toast.success)).toEqual(['Your vote added about $0.12 to this post.'])
  })
})
