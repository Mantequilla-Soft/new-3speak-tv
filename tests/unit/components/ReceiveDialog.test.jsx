// @vitest-environment jsdom
// The wallet's Receive window (components/Wallet/ReceiveDialog.jsx): a QR code
// of the account, and optionally an amount, a coin and a memo to ask for
// (owner 2026-11-12). The QR image is stood in for by its text.
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import { parseScannedRecipient } from '../../../src/lib/scannedRecipient.js'

vi.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <output data-testid="qr">{value}</output> }))

const { default: ReceiveDialog } = await import('../../../src/components/Wallet/ReceiveDialog.jsx')

const mount = () => renderWithProviders(<ReceiveDialog open onClose={vi.fn()} user="badadib" />)
const qr = () => screen.getByTestId('qr').textContent

describe('the Receive window', () => {
  it('shows the plain account name until something is asked for', () => {
    mount()
    expect(qr()).toBe('badadib')
    expect(screen.getByText(/Anyone can send HIVE or HBD/)).toBeInTheDocument()
  })

  it('an amount and a coin go into the code, and the line under it says so', async () => {
    const { user } = mount()
    await user.type(screen.getByLabelText('Ask for an amount (optional)'), '5')
    await user.click(screen.getByRole('radio', { name: 'HIVE' }))
    expect(parseScannedRecipient(qr())).toEqual({ to: 'badadib', amount: '5.000', coin: 'HIVE' })
    expect(screen.getByText(/asks for 5\.000 HIVE/)).toBeInTheDocument()
  })

  it('a memo goes in too, also without an amount', async () => {
    const { user } = mount()
    await user.type(screen.getByLabelText('Memo (optional)'), 'Invoice 42')
    expect(parseScannedRecipient(qr())).toEqual({ to: 'badadib', memo: 'Invoice 42' })
    expect(screen.getByText(/fills in your account name and the memo/)).toBeInTheDocument()
  })
})
