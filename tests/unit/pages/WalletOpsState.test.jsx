// @vitest-environment jsdom
// The wallet page's power / savings / delegation state (src/page/Wallet.jsx
// loadOps): a slow read for the wallet left behind never replaces the one on
// screen. Hive and the side panels are stand-ins; nothing is broadcast.
import { describe, it, expect, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { useNavigate } from 'react-router-dom'
import { renderWithProviders } from '../components/_render.jsx'

const account = {
  balance: '1.000 HIVE', hbd_balance: '1.000 HBD', savings_balance: '0.000 HIVE', savings_hbd_balance: '0.000 HBD',
  vesting_shares: '2000.000000 VESTS', reward_hive_balance: '0.000 HIVE', reward_hbd_balance: '0.000 HBD',
  reward_vesting_hive: '0.000 HIVE', reward_vesting_balance: '0.000000 VESTS',
}
const dgp = { total_vesting_fund_hive: '1000.000 HIVE', total_vesting_shares: '2000000.000000 VESTS' }
const client = {
  database: { getAccounts: vi.fn(async () => [account]), getDynamicGlobalProperties: vi.fn(async () => dgp) },
  call: vi.fn(async () => ({ latest: '0.3' })),
}

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => client }))
vi.mock('../../../src/utils/rcCheck', () => ({ getRcStatus: vi.fn(async () => null), estimatePostRcCost: vi.fn(async () => 0) }))
vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule({ KeyTypes: { Active: 'active', Posting: 'posting' } }))
vi.mock('../../../src/lib/store', () => {
  const s = { user: 'alice' }
  return { useAppStore: (sel) => (sel ? sel(s) : s) }
})
vi.mock('../../../src/components/Wallet/TrxHistory', () => ({ default: () => null }))
vi.mock('../../../src/components/Wallet/TransferModal', () => ({ default: () => null }))
vi.mock('../../../src/components/Wallet/ProPlansPanel', () => ({ default: () => null }))
vi.mock('../../../src/components/Wallet/ReceiveDialog', () => ({ default: () => null }))
vi.mock('../../../src/components/Wallet/WalletPending', () => ({
  default: ({ state }) => <div data-testid="ops">{`${state.user}:${state.tag}`}</div>,
}))
// Each read waits until the test answers it, so the order they land in is chosen here.
const reads = []
vi.mock('../../../src/lib/walletOps', () => ({
  loadWalletState: vi.fn((call, user) => new Promise((resolve) => { reads.push({ user, resolve }) })),
}))

const { default: Wallet } = await import('../../../src/page/Wallet.jsx')

function GoTo({ to }) {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(to)}>go</button>
}

describe('Wallet page: power, savings and delegation state', () => {
  it('a slow read for the wallet left behind does not replace the one on screen', async () => {
    const { user } = renderWithProviders(<><Wallet /><GoTo to="/wallet/bob" /></>, { route: '/wallet/alice', path: '/wallet/:user' })
    await vi.waitFor(() => expect(reads.map((r) => r.user)).toEqual(['alice']))

    await user.click(screen.getByRole('button', { name: 'go' }))
    await vi.waitFor(() => expect(reads.map((r) => r.user)).toEqual(['alice', 'bob']))

    // bob's answer first, then alice's late one.
    await act(async () => { reads[1].resolve({ tag: 'bob-state' }) })
    expect(await screen.findByTestId('ops')).toHaveTextContent('bob:bob-state')
    await act(async () => { reads[0].resolve({ tag: 'alice-state' }) })
    expect(screen.getByTestId('ops')).toHaveTextContent('bob:bob-state')
  })
})
