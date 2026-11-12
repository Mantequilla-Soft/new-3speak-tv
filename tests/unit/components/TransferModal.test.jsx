// @vitest-environment jsdom
// The wallet's Send window (components/Wallet/TransferModal.jsx): scanning the
// other person's QR code fills in the recipient (owner 2026-11-12). The camera
// itself (QrScanSheet, qr-scanner) is stood in for: its "scan" buttons hand a
// code to the window the way the camera does.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/hive-api/api', () => ({ isAccountValid: vi.fn(async () => true) }))
vi.mock('../../../src/components/Wallet/QrScanSheet', () => ({
  default: ({ onResult, onClose, note }) => (
    <div role="dialog" aria-label="camera">
      <button type="button" onClick={() => onResult('https://3speak.tv/@badadib')}>scan a profile link</button>
      <button type="button" onClick={() => onResult('WIFI:S:home;;')}>scan a wifi code</button>
      <button type="button" onClick={() => onResult(`hive://sign/op/${Buffer.from(JSON.stringify(['transfer', { to: 'badadib', amount: '2.000 HBD', memo: 'thanks' }])).toString('base64')}`)}>scan a transfer request</button>
      <button type="button" onClick={onClose}>close camera</button>
      {note && <p>{note}</p>}
    </div>
  ),
}))

const { default: TransferModal } = await import('../../../src/components/Wallet/TransferModal.jsx')

const mount = () => renderWithProviders(
  <TransferModal showModal={vi.fn()} selectedCoin={{ name: 'HIVE', usdPrice: 0.3 }} balances={{ hive: 10, hbd: 5 }} />,
)
const recipient = () => screen.getByLabelText(/recipient|send to/i)

let saved
beforeEach(() => {
  saved = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
})
afterEach(() => {
  if (saved) Object.defineProperty(navigator, 'mediaDevices', saved)
  else delete navigator.mediaDevices
})

describe('the Send window: scanning a QR code', () => {
  it('a scanned profile link fills in the recipient and closes the camera', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Scan a QR code' }))
    await user.click(screen.getByRole('button', { name: 'scan a profile link' }))
    expect(recipient()).toHaveValue('badadib')
    expect(screen.queryByRole('dialog', { name: 'camera' })).not.toBeInTheDocument()
  })

  it('a code without an account says so and keeps the camera open', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Scan a QR code' }))
    await user.click(screen.getByRole('button', { name: 'scan a wifi code' }))
    expect(screen.getByText('This QR code holds no Hive account. Try another one.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'camera' })).toBeInTheDocument()
    expect(recipient()).toHaveValue('')
  })

  it('a Hive transfer request also fills in the amount, the coin and the memo', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Scan a QR code' }))
    await user.click(screen.getByRole('button', { name: 'scan a transfer request' }))
    expect(recipient()).toHaveValue('badadib')
    expect(screen.getByRole('spinbutton')).toHaveValue(2)
    expect(screen.getByDisplayValue('thanks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2 HBD/ })).toBeInTheDocument()
  })

  it('no Scan button where the browser cannot open a camera', () => {
    delete navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    mount()
    expect(screen.queryByRole('button', { name: 'Scan a QR code' })).not.toBeInTheDocument()
  })
})
