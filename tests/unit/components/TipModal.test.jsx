// @vitest-environment jsdom
// The tip window (components/tip-reward/TipModal.jsx). A signed-in member tips
// HIVE or HBD from their wallet (once, or monthly), checked against their
// balance and the recipient's account, and reported as a support of the video;
// anyone can tip over Lightning with an invoice (QR code or a browser wallet)
// that is watched until it is paid. The creator's other support pages get their
// own tab. Wallet calls, Hive reads and the Lightning API are stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders, stubClipboard, toastMessages, useFakeClock } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('canvas-confetti', () => ({ default: () => {} }))
vi.mock('ldrs/react', () => ({ LineSpinner: () => <span>…</span> }))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule({
  isLoggedIn: () => m.loggedIn,
  transferWithAioha: (...a) => m.transfer(...a),
  broadcastWithAioha: (...a) => m.broadcast(...a),
  KeyTypes: { Active: 'active', Posting: 'posting' },
}))
vi.mock('../../../src/hive-api/api', () => ({
  fetchBalances: (...a) => m.balances(...a),
  isAccountValid: (...a) => m.valid(...a),
}))
vi.mock('../../../src/lib/supports', () => ({
  queueSupport: (...a) => m.queue(...a),
  recordSupport: (...a) => m.record(...a),
}))
vi.mock('../../../src/lib/recurringTip', async (importOriginal) => ({
  ...(await importOriginal()),
  findMonthlySupport: (...a) => m.findMonthly(...a),
}))
vi.mock('../../../src/lib/lightningTip', async (importOriginal) => ({
  ...(await importOriginal()),
  requestLightningInvoice: (...a) => m.invoice(...a),
  isLightningInvoicePaid: (...a) => m.paid(...a),
  hasWebln: () => m.webln,
  payWithWebln: (...a) => m.payWebln(...a),
  fetchLightningReceiver: (...a) => m.receiver(...a),
}))
vi.mock('../../../src/components/tip-reward/OtherWays', () => ({
  default: ({ links }) => <p>{links.length} other ways</p>,
  useSupportLinks: () => m.links,
}))
vi.mock('../../../src/components/tip-reward/WalletTip', () => ({ default: () => <p>Wallet tip form</p> }))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: TipModal } = await import('../../../src/components/tip-reward/TipModal.jsx')

const LINK = 'https://3speak.tv/watch?v=badadib/lake-day'
function mount(props = {}, opts) {
  const onClose = vi.fn()
  const r = renderWithProviders(<TipModal recipient="badadib" permlink="lake-day" memoLink={LINK} isOpen onClose={onClose} {...props} />, opts)
  return { ...r, onClose }
}
const signIn = () => { m.loggedIn = true; act(() => useAppStore.setState({ user: 'listener' })) }
const field = (label) => screen.getByText(label).parentElement.querySelector('input, select')

beforeEach(() => {
  Object.assign(m, {
    loggedIn: false, webln: false, links: [],
    transfer: vi.fn(async () => ({ success: true })),
    broadcast: vi.fn(async () => ({ success: true })),
    balances: vi.fn(async () => ({ hive: 25, hbd: 4 })),
    valid: vi.fn(async () => true),
    queue: vi.fn((s) => ({ ...s, id: 'pending-1' })),
    record: vi.fn(async () => ({ recorded: true })),
    findMonthly: vi.fn(async () => null),
    invoice: vi.fn(async ({ sats }) => ({ pr: 'lnbc1invoice', hash: 'h1', sats })),
    paid: vi.fn(async () => false),
    payWebln: vi.fn(async () => {}),
    receiver: vi.fn(async () => ({ via: 'v4v' })),
  })
  useAppStore.setState({ user: null })
})
afterEach(() => vi.useRealTimers())

describe('the tip window for a visitor: Lightning', () => {
  it('opens on Lightning, the one way that needs no Hive account', async () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Send a Tip to @badadib' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Lightning/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/Goes to @badadib through v4v.app/)).toBeInTheDocument()
    expect(m.receiver).toHaveBeenCalledWith('badadib')
    expect(screen.getByText(`This link is added to the memo: ${LINK}`)).toBeInTheDocument()
  })

  it('names the creator\'s own Lightning address when they set one', async () => {
    m.receiver = vi.fn(async () => ({ via: 'address', address: 'me@wallet.example' }))
    mount()
    expect(await screen.findByText(/own Lightning wallet \(me@wallet.example\)/)).toBeInTheDocument()
  })

  it('the HIVE / HBD tab asks a visitor to log in', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'HIVE / HBD' }))
    expect(screen.getByText('Please login to send a tip')).toBeInTheDocument()
  })

  it('makes an invoice for the amount picked, with the link in its comment, and shows it as a QR code', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: (2500).toLocaleString() }))
    await user.type(screen.getByPlaceholderText('e.g. Thanks for this amazing content!'), 'Great one')
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    expect(m.invoice).toHaveBeenCalledWith({ to: 'badadib', sats: 2500, comment: `Great one ${LINK}` })
    expect(await screen.findByText(`Scan with any Lightning wallet to send ${(2500).toLocaleString()} sats to @badadib.`)).toBeInTheDocument()
    // The QR code and the button both open the invoice in a wallet app.
    for (const link of screen.getAllByRole('link', { name: 'Open in wallet' })) expect(link).toHaveAttribute('href', 'lightning:lnbc1invoice')
    expect(screen.getByText('Waiting for the payment…')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('copies the invoice', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    const clipboard = stubClipboard()
    try {
      await user.click(await screen.findByRole('button', { name: 'Copy invoice' }))
      expect(clipboard.writeText).toHaveBeenCalledWith('lnbc1invoice')
      expect(toastMessages(toast.success)).toContain('Invoice copied')
    } finally { clipboard.restore() }
  })

  it('Back keeps the amount for a new invoice; Done closes', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: (5000).toLocaleString() }))
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: (5000).toLocaleString() })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the thank-you by itself once the invoice is paid', async () => {
    useFakeClock()
    m.paid = vi.fn(async () => true)
    const { user } = mount({}, { fakeTimers: true })
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await screen.findByText(/Scan with any Lightning wallet/)
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(m.paid).toHaveBeenCalledWith('h1')
    expect(await screen.findByRole('heading', { name: 'Tip Sent Successfully!', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('You have successfully sent 1000 sats as a tip. Thank you for your support!')).toBeInTheDocument()
  })

  it('an address that cannot confirm payment does not show an endless spinner', async () => {
    m.invoice = vi.fn(async ({ sats }) => ({ pr: 'lnbc1', hash: 'h2', sats, verifiable: false }))
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    expect(await screen.findByText('Your wallet shows when the payment went through.')).toBeInTheDocument()
    expect(m.paid).not.toHaveBeenCalled()
  })

  it('pays straight from a browser Lightning wallet when there is one', async () => {
    m.webln = true
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Pay via extension' }))
    expect(m.payWebln).toHaveBeenCalledWith('lnbc1invoice')
    expect(await screen.findByText(/successfully sent 1000 sats/)).toBeInTheDocument()
  })

  it('falls back to the QR code when the browser wallet is closed without paying', async () => {
    m.webln = true
    m.payWebln = vi.fn(async () => { throw new Error('User rejected') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Pay via extension' }))
    expect(await screen.findByText(/Scan with any Lightning wallet/)).toBeInTheDocument()
  })

  it.each([
    [{ code: 'amount_out_of_range', max: 100000 }, 'That is more than this address accepts (max 100000 sats)'],
    [{ code: 'no_account' }, 'This Hive account does not exist'],
    [{ code: 'boom' }, 'Could not create a Lightning invoice. Please try again.'],
  ])('explains an invoice that could not be made (%o)', async (err, message) => {
    m.invoice = vi.fn(async () => { throw Object.assign(new Error('x'), err) })
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual([message]))
  })

  it('refuses an amount that is not a whole number of sats', async () => {
    const { user } = mount()
    const sats = screen.getByRole('spinbutton')
    await user.clear(sats)
    await user.type(sats, '0')
    await user.click(screen.getByRole('button', { name: 'Show QR code' }))
    expect(toastMessages(toast.error)).toEqual(['Enter a whole number of sats'])
    expect(m.invoice).not.toHaveBeenCalled()
  })

  it('offers the creator\'s other support pages in their own tab', async () => {
    m.links = [{ url: 'https://ko-fi.com/badadib' }]
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'More ways' }))
    expect(screen.getByText('1 other ways')).toBeInTheDocument()
  })
})

describe('the tip window for a member: HIVE and HBD', () => {
  beforeEach(() => signIn())

  it('opens on the wallet tab with the available balance', async () => {
    const { user } = mount()
    expect(screen.getByRole('tab', { name: 'HIVE / HBD' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('25')).toBeInTheDocument()
    expect(m.balances).toHaveBeenCalledWith('listener')
    await user.selectOptions(field('Currency:'), 'HBD')
    expect(screen.getByText('Available balance: HBD')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('sends the tip with the link in the memo and reports it as a support of the video', async () => {
    const { user } = mount()
    await screen.findByText('25')
    await user.type(field('Amount:'), '5')
    await user.type(field('Memo (optional):'), 'Thanks')
    await user.click(screen.getByRole('button', { name: 'Send 5 HIVE' }))
    expect(m.valid).toHaveBeenCalledWith('badadib')
    expect(m.queue).toHaveBeenCalledWith({ tipper: 'listener', author: 'badadib', permlink: 'lake-day', amount: 5, currency: 'HIVE', memo: `Thanks ${LINK}` })
    expect(m.transfer).toHaveBeenCalledWith('badadib', 5, 'HIVE', `Thanks ${LINK}`)
    expect(await screen.findByText('You have successfully sent 5 HIVE as a tip. Thank you for your support!')).toBeInTheDocument()
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-1' }))
  })

  it('a tip from a profile (no video) is not reported as a support', async () => {
    const { user } = mount({ permlink: undefined, memoLink: undefined })
    await screen.findByText('25')
    await user.type(field('Amount:'), '1')
    await user.click(screen.getByRole('button', { name: 'Send 1 HIVE' }))
    await screen.findByText(/successfully sent 1 HIVE/)
    expect(m.queue).not.toHaveBeenCalled()
    expect(m.transfer).toHaveBeenCalledWith('badadib', 1, 'HIVE', '')
  })

  it.each([
    ['more than the balance', async () => {}, '30', 'Insufficient balance'],
    ['to an account that does not exist', async () => { m.valid = vi.fn(async () => false) }, '1', 'Invalid username'],
  ])('refuses a tip %s', async (_what, setup, amount, message) => {
    await setup()
    const { user } = mount()
    await screen.findByText('25')
    await user.type(field('Amount:'), amount)
    await user.click(screen.getByRole('button', { name: /^Send \d+ HIVE$/ }))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual([message]))
    expect(m.transfer).not.toHaveBeenCalled()
  })

  it('needs an amount', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(toastMessages(toast.error)).toEqual(['All fields are required'])
  })

  it('says why the wallet did not send it', async () => {
    m.transfer = vi.fn(async () => { throw new Error('Keychain cancelled') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = mount()
    await screen.findByText('25')
    await user.type(field('Amount:'), '2')
    await user.click(screen.getByRole('button', { name: 'Send 2 HIVE' }))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Transfer failed: Keychain cancelled']))
    expect(screen.queryByText(/successfully sent/)).not.toBeInTheDocument()
  })

  it('sets up a monthly support as one recurring transfer signed with the active key', async () => {
    const { user } = mount()
    await screen.findByText('25')
    await user.type(field('Amount:'), '3')
    await user.selectOptions(screen.getByRole('combobox', { name: 'How often' }), '6')
    expect(screen.getByText(/Hive sends it by itself every 30 days/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send 3 HIVE' }))
    expect(m.broadcast).toHaveBeenCalledWith([['recurrent_transfer', {
      from: 'listener', to: 'badadib', amount: '3.000 HIVE', memo: LINK, recurrence: 720, executions: 6, extensions: [],
    }]], 'active')
    expect(await screen.findByText('The next one goes out by itself in 30 days.')).toBeInTheDocument()
    expect(m.queue).not.toHaveBeenCalled()
  })

  it('shows a monthly support already running, and stops it', async () => {
    m.findMonthly = vi.fn(async () => ({ amount: '5.000 HBD', currency: 'HBD', until: new Date('2027-05-01T00:00:00Z'), recurrence: 720 }))
    const { user } = mount()
    expect(await screen.findByText(/You send @badadib 5.000 HBD every month, until/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(m.broadcast).toHaveBeenCalledWith([['recurrent_transfer', expect.objectContaining({ from: 'listener', to: 'badadib', amount: '0.000 HBD' })]], 'active')
    await waitFor(() => expect(screen.queryByText(/You send @badadib/)).not.toBeInTheDocument())
    expect(toastMessages(toast.success)).toContain('Monthly support stopped')
  })

  it('Cancel and the X close the window', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // BUG: an amount of 0 (or a negative one) passes every check (TipModal.jsx:206
  // tests only that the text is not empty) and is handed to the wallet, which
  // then fails with its own error instead of the form saying what is wrong.
  it('BUG: refuses an amount of zero or less before asking the wallet', async () => {
    const { user } = mount()
    await screen.findByText('25')
    await user.type(field('Amount:'), '0')
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(m.transfer).not.toHaveBeenCalled()
  })

  // BUG: the window's fields are labelled with bare <label>s that are not tied
  // to their inputs (TipModal.jsx:445, :455, :473, and the Lightning ones at
  // :336, :355), so the amount, currency and memo boxes have no
  // accessible name. Only "How often" (MonthlyField, useId) is labelled.
  it('BUG: the amount, currency and memo fields are labelled', async () => {
    mount()
    expect(screen.getByRole('spinbutton', { name: /Amount/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Currency/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Memo/ })).toBeInTheDocument()
  })

  it('closes on Escape, like its X', async () => {
    const { user, onClose } = mount()
    await screen.findByText('25')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
