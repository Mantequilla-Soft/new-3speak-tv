// @vitest-environment jsdom
// The Butter Auth signing sheet (components/ActiveAuthModal) names a power down
// or a delegation in HP as well as the VESTS the chain is sent. Nothing is signed.
import { describe, it, expect, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const dgp = { total_vesting_fund_hive: '1000.000 HIVE', total_vesting_shares: '2000000.000000 VESTS' }
const client = { call: vi.fn(async () => dgp), database: { getAccounts: vi.fn(async () => []) }, broadcast: {} }
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => client }))
vi.mock('../../../src/hive-api/aioha', async () => {
  const m = (await import('./_render.jsx')).aiohaModule()
  m.default.isProviderRegistered = vi.fn(() => false)
  return m
})

const aioha = await import('../../../src/hive-api/aioha')
const { default: ActiveAuthModal } = await import('../../../src/components/ActiveAuthModal/ActiveAuthModal.jsx')

const ask = (ops) => {
  renderWithProviders(<ActiveAuthModal />)
  const handler = aioha.setActiveAuthHandler.mock.calls.at(-1)[0]
  act(() => { handler(ops) })
}

describe('ActiveAuthModal: power down and delegation in HP', () => {
  it('reads the rate from the chain when a delegation is to be signed', async () => {
    ask([['delegate_vesting_shares', { delegator: 'badadib', delegatee: 'fan', vesting_shares: '2000.000000 VESTS' }]])
    expect(await screen.findByText('Delegate 1.000 HP (2000.000000 VESTS) to @fan')).toBeInTheDocument()
    expect(client.call).toHaveBeenCalledWith('condenser_api', 'get_dynamic_global_properties', [])
  })

  it('shows the VESTS alone when no node answers', async () => {
    client.call.mockRejectedValueOnce(new Error('node down'))
    ask([['withdraw_vesting', { account: 'badadib', vesting_shares: '26000.000000 VESTS' }]])
    expect(await screen.findByText('Power down 26000.000000 VESTS')).toBeInTheDocument()
  })
})
