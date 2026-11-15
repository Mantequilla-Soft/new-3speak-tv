// @vitest-environment jsdom
// Wallet > Power up / Power down / Savings / Convert / Delegate
// (components/Wallet/WalletOpModal.jsx): the sheet builds the right operation
// and hands it to the (stand-in) wallet with the active key. Nothing is broadcast.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule({
  isLoggedIn: vi.fn(() => true),
  KeyTypes: { Active: 'active', Posting: 'posting' },
}))
vi.mock('../../../src/hive-api/api', () => ({ isAccountValid: vi.fn(async (n) => n !== 'nobody') }))

const aioha = await import('../../../src/hive-api/aioha')
const { default: WalletOpModal } = await import('../../../src/components/Wallet/WalletOpModal.jsx')

const dgp = { total_vesting_fund_hive: '1000.000 HIVE', total_vesting_shares: '2000000.000000 VESTS', hbd_interest_rate: 1500 }
const state = {
  dgp, hbdPerHive: 0.25, hive: 20, hbd: 5, savingsHive: 0, savingsHbd: 8, hp: 100, freeHp: 90, freeVests: 180000,
  powerDown: null, withdrawals: [{ requestId: 1763200000 }], conversions: [], delegations: [{ delegatee: 'fan', vests: 20000, hp: 10 }],
}
const mount = (mode, extra = {}) => {
  const onClose = vi.fn()
  const onDone = vi.fn()
  const r = renderWithProviders(<WalletOpModal mode={mode} user="badadib" state={{ ...state, ...extra }} onClose={onClose} onDone={onDone} />)
  return { ...r, onClose, onDone }
}
const amountBox = () => screen.getByRole('spinbutton')
const sent = () => aioha.broadcastWithAioha.mock.calls.at(-1)

beforeEach(() => { aioha.broadcastWithAioha.mockClear() })

describe('WalletOpModal', () => {
  it('powers up for yourself', async () => {
    const { user, onDone, onClose } = mount('powerUp')
    await user.type(amountBox(), '2.5')
    await user.click(screen.getByRole('button', { name: 'Power up 2.5 HIVE' }))
    expect(sent()).toEqual([[['transfer_to_vesting', { from: 'badadib', to: 'badadib', amount: '2.500 HIVE' }]], 'active'])
    expect(onDone).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses more than the balance', async () => {
    const { user } = mount('powerUp')
    await user.type(amountBox(), '21')
    await user.click(screen.getByRole('button', { name: 'Power up 21 HIVE' }))
    expect(screen.getByText('That is more than you have.')).toBeInTheDocument()
    expect(aioha.broadcastWithAioha).not.toHaveBeenCalled()
  })

  it('powers down HP as VESTS', async () => {
    const { user } = mount('powerDown')
    await user.type(amountBox(), '13')
    await user.click(screen.getByRole('button', { name: 'Power down 13 HP' }))
    expect(sent()[0]).toEqual([['withdraw_vesting', { account: 'badadib', vesting_shares: '26000.000000 VESTS' }]])
  })

  it('stops a running power down', async () => {
    const { user } = mount('powerDown', { powerDown: { leftHp: 50, weeklyHp: 5, weeksLeft: 10, next: new Date() } })
    await user.click(screen.getByRole('button', { name: 'Stop the power down' }))
    expect(sent()[0]).toEqual([['withdraw_vesting', { account: 'badadib', vesting_shares: '0.000000 VESTS' }]])
  })

  it('withdraws from savings with a fresh request id', async () => {
    const { user } = mount('savings')
    await user.click(screen.getByRole('tab', { name: 'Withdraw' }))
    await user.type(amountBox(), '3')
    await user.click(screen.getByRole('button', { name: 'Withdraw 3 HBD' }))
    const [[[name, op]]] = sent()
    expect(name).toBe('transfer_from_savings')
    expect(op).toMatchObject({ from: 'badadib', to: 'badadib', amount: '3.000 HBD', memo: '' })
    expect(op.request_id).not.toBe(1763200000)
    expect(Number.isInteger(op.request_id)).toBe(true)
  })

  it('converts HIVE to HBD with the collateral warning', async () => {
    const { user } = mount('convert')
    await user.click(screen.getByRole('tab', { name: 'HIVE to HBD' }))
    await user.type(amountBox(), '10')
    expect(screen.getByText(/about 1.188 HBD now/)).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Convert 10 HIVE' }))
    expect(sent()[0][0][0]).toBe('collateralized_convert')
    expect(sent()[0][0][1]).toMatchObject({ owner: 'badadib', amount: '10.000 HIVE' })
  })

  it('delegates, checks the account, and removes a delegation', async () => {
    const { user } = mount('delegate')
    await user.type(screen.getByLabelText('Delegate to'), 'nobody')
    await user.type(amountBox(), '5')
    await user.click(screen.getByRole('button', { name: 'Delegate 5 HP to @nobody' }))
    expect(screen.getByText('There is no Hive account with that name.')).toBeInTheDocument()
    expect(aioha.broadcastWithAioha).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(sent()[0]).toEqual([['delegate_vesting_shares', { delegator: 'badadib', delegatee: 'fan', vesting_shares: '0.000000 VESTS' }]])
  })

  it('a new amount for an existing delegation may use the HP already delegated there', async () => {
    const { user } = mount('delegate')
    await user.type(screen.getByLabelText('Delegate to'), 'fan')
    expect(screen.getByText(/You delegate 10.000 HP to @fan now/)).toBeInTheDocument()
    await user.type(amountBox(), '100')
    await user.click(screen.getByRole('button', { name: 'Delegate 100 HP to @fan' }))
    expect(sent()[0]).toEqual([['delegate_vesting_shares', { delegator: 'badadib', delegatee: 'fan', vesting_shares: '200000.000000 VESTS' }]])
  })
})
