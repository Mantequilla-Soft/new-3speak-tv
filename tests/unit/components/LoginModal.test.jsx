// @vitest-environment jsdom
// The login window (components/LoginModal/LoginModal.jsx). Without an intent it
// opens on a "sign up or log in" chooser; "Log in" shows the wallet list (aioha's
// own modal, replaced here by a small stand-in with the same markup) with Butter
// Auth added on top; "Sign up" opens the Butter Auth popup. Someone signed in
// through Butter Auth gets a change-account screen instead, to switch, add an
// account or log out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ butrauth: true, metamask: false }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('@aioha/aioha', () => ({
  Providers: { MetaMaskSnap: 'metamasksnap', HiveSigner: 'hivesigner', Keychain: 'keychain' },
  KeyTypes: { Active: 'active', Posting: 'posting' },
}))
vi.mock('@aioha/react-ui', () => ({
  useAioha: () => ({ aioha: m.aioha }),
  // aioha's modal, reduced to the markup LoginModal reaches into.
  AiohaModal: ({ displayed, onClose }) => (displayed ? (
    <div id="aioha-modal" role="dialog" aria-label="Wallet login">
      <div>
        <div>
          <p>Scan the QR code using a HiveAuth-compatible mobile app.</p>
          <ul><li><a className="provider-item" href="#keychain">Keychain</a></li></ul>
          <button type="button" onClick={onClose}>Close wallets</button>
        </div>
      </div>
    </div>
  ) : null),
}))
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  get ENABLE_BUTRAUTH() { return m.butrauth },
  get ENABLE_METAMASK_SNAP() { return m.metamask },
}))
vi.mock('../../../src/utils/signupPossible', () => ({ useSignupPossible: () => m.signup }))
vi.mock('../../../src/utils/butrauthAccounts', () => ({
  listButrauthAccounts: () => m.butrAccounts,
  forgetButrauthAccount: (name) => { m.forgot(name); m.butrAccounts = m.butrAccounts.filter((a) => a.name !== name) },
}))
vi.mock('../../../src/utils/referral', () => ({ withReferrer: (u) => `${u}&ref=badadib`, getStoredInvite: () => 'INVITE1' }))
vi.mock('../../../src/utils/butrauthPopup', () => ({ withLocale: (u) => u }))
vi.mock('../../../src/components/HiveAvatar/AccountImg', () => ({ default: () => <span /> }))
// The community half of the window shows creators from the leaderboard.
vi.mock('../../../src/lib/leaderboardData', () => ({ fetchLeaderboard: async () => ({ entries: [] }) }))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: LoginModal } = await import('../../../src/components/LoginModal/LoginModal.jsx')

function mount(props = {}) {
  const onLogin = vi.fn()
  const onClose = vi.fn()
  const r = renderWithProviders(<LoginModal displayed onLogin={onLogin} onClose={onClose} loginOptions={{ msg: 'Login' }} {...props} />)
  return { ...r, onLogin, onClose }
}

beforeEach(() => {
  m.butrauth = true
  m.metamask = false
  m.signup = { possible: true }
  m.butrAccounts = []
  m.forgot = vi.fn()
  m.aioha = {
    isLoggedIn: vi.fn(() => false),
    getOtherLogins: vi.fn(() => ({})),
    switchUser: vi.fn(() => true),
    getCurrentProvider: vi.fn(() => 'keychain'),
    login: vi.fn(async () => ({ success: true, username: 'badadib' })),
  }
  m.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://butrauth.example/authorize?x=1' }) }))
  vi.stubGlobal('fetch', (...a) => m.fetch(...a))
  m.open = vi.fn(() => ({ closed: false }))
  vi.stubGlobal('open', (...a) => m.open(...a))
  useAppStore.setState({ user: null, incubationHandle: null, LogOut: vi.fn(async () => {}) })
})
afterEach(() => {
  localStorage.clear()
  delete window.__butrauthLoginPopup
})

describe('the login window: sign up or log in', () => {
  it('renders nothing while closed', () => {
    mount({ displayed: false })
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('opens on the chooser when nothing says what the visitor wants', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Welcome to 3Speak' })).toBeInTheDocument()
    expect(screen.getByText('Create a new account, or log in if you already have one.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sign up/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Log in with Butter Auth or any Hive wallet/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Wallet login' })).not.toBeInTheDocument()
  })

  it('closes from Cancel, the X and a click on the backdrop', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.mouseDown(document.querySelector('.v2-dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('does not close from a click inside the chooser', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('heading', { name: 'Welcome to 3Speak' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Log in" shows the wallets with Butter Auth recommended above them', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Log in with/ }))
    const wallets = screen.getByRole('dialog', { name: 'Wallet login' })
    const butr = await within(wallets).findByRole('button', { name: /Butter Auth \(Recommended\)/ })
    // Inserted before the wallet list, so it is the first option seen.
    expect(butr.closest('.login-top-section').nextElementSibling.tagName).toBe('UL')
  })

  it('rewrites aioha\'s HiveAuth hint in the app\'s own words', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Log in with/ }))
    expect(await screen.findByText(/If you have the app on this phone then just tap the qr code/)).toBeInTheDocument()
  })

  it('"Sign up" asks the server for a Butter Auth signup and opens it in a popup', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Sign up/ }))
    await waitFor(() => expect(m.open).toHaveBeenCalled())
    const [url, init] = m.fetch.mock.calls[0]
    expect(url).toBe('/api/manteauth/start')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ redirect_uri: `${window.location.origin}/callback`, state: 'popup', signup: true, invite: 'INVITE1' })
    const [popupUrl, name, features] = m.open.mock.calls[0]
    expect(popupUrl).toBe('https://butrauth.example/authorize?x=1&ref=badadib')
    expect(name).toBe('butrauth-login')
    expect(features).toMatch(/^width=\d+,height=\d+,left=/)
    expect(window.__butrauthLoginPopup).toEqual({ closed: false })
  })

  it('opens no popup when the server could not start the flow', async () => {
    m.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'busy' }) }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Sign up/ }))
    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(m.open).not.toHaveBeenCalled()
  })

  it('offers no sign up over a VPN, and says why', () => {
    m.signup = { possible: false, reason: 'datacenter_ip' }
    mount()
    expect(screen.queryByRole('button', { name: /Sign up/ })).not.toBeInTheDocument()
    expect(screen.getByText(/can.t be created over a VPN or proxy/)).toBeInTheDocument()
  })

  it('says when this network cannot sign up for another reason', () => {
    m.signup = { possible: false, reason: 'capped' }
    mount()
    expect(screen.getByText(/aren.t available on this network right now/)).toBeInTheDocument()
  })

  it('without Butter Auth in this build it is a plain wallet login', () => {
    m.butrauth = false
    mount()
    expect(screen.getByText('Log in to your account.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sign up/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Log in with any Hive wallet/ })).toBeInTheDocument()
  })

  it('the nav\'s "Log in" goes straight to the wallets', () => {
    mount({ intent: 'login' })
    expect(screen.queryByRole('heading', { name: 'Welcome to 3Speak' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Wallet login' })).toBeInTheDocument()
  })

  it('opens on the wallets when a wallet is already logged in ("Change account")', () => {
    m.aioha.isLoggedIn.mockReturnValue(true)
    mount()
    expect(screen.getByRole('dialog', { name: 'Wallet login' })).toBeInTheDocument()
  })

  it('the nav\'s "Sign up" opens the popup at once, with a way back if it was blocked', async () => {
    const { user } = mount({ intent: 'signup' })
    expect(screen.getByRole('heading', { name: 'Opening sign up…' })).toBeInTheDocument()
    await waitFor(() => expect(m.open).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Reopen sign up' }))
    await waitFor(() => expect(m.open).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Log in instead' }))
    expect(screen.getByRole('dialog', { name: 'Wallet login' })).toBeInTheDocument()
  })

  it('MetaMask Snap logs in with the active key when switched on', async () => {
    m.metamask = true
    vi.stubGlobal('prompt', vi.fn(() => ' badadib '))
    const { user, onLogin } = mount({ intent: 'login' })
    const item = await screen.findByText('MetaMask Snap')
    await user.click(item)
    expect(window.prompt).toHaveBeenCalledWith('Enter your Hive username:')
    expect(m.aioha.login).toHaveBeenCalledWith('metamasksnap', 'badadib', { msg: 'Login', keyType: 'active' })
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ success: true, username: 'badadib' }))
  })

  // The chooser is the shared v2 Dialog: role="dialog", named by its title,
  // Escape closes it.
  it('the chooser is a named dialog that closes on Escape', async () => {
    const { user, onClose } = mount()
    expect(screen.getByRole('dialog', { name: 'Welcome to 3Speak' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('the login window: signed in with Butter Auth', () => {
  beforeEach(() => {
    localStorage.setItem('manteauth_login', 'true')
    useAppStore.setState({ user: 'badadib' })
  })

  it('says who is signed in and offers to add an account or log out', () => {
    mount()
    expect(screen.getByRole('heading', { name: "You're signed in" })).toBeInTheDocument()
    expect(screen.getByText('@badadib', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add another account/ })).toBeInTheDocument()
    expect(screen.queryByText('Switch to')).not.toBeInTheDocument()
  })

  it('logs out and closes', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    expect(useAppStore.getState().LogOut).toHaveBeenCalledWith('badadib')
    expect(onClose).toHaveBeenCalled()
  })

  it('switches to a wallet account kept in this browser', async () => {
    m.aioha.getOtherLogins.mockReturnValue({ 'second-acct': 'keychain' })
    const { user, onLogin } = mount()
    expect(screen.getByText('Switch to')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /@second-acct/ })
    expect(row).toHaveTextContent('Keychain')
    await user.click(row)
    expect(m.aioha.switchUser).toHaveBeenCalledWith('second-acct')
    expect(onLogin).toHaveBeenCalledWith({ success: true, username: 'second-acct', provider: 'keychain' })
  })

  it('asks to log in again when that wallet login has expired', async () => {
    m.aioha.getOtherLogins.mockReturnValue({ 'second-acct': 'hiveauth' })
    m.aioha.switchUser.mockReturnValue(false)
    const { user, onLogin } = mount()
    await user.click(screen.getByRole('button', { name: /@second-acct/ }))
    expect(onLogin).not.toHaveBeenCalled()
    expect(toastMessages(toast.error)).toEqual(['That login has expired. Please log in again.'])
    expect(screen.getByRole('dialog', { name: 'Wallet login' })).toBeInTheDocument()
  })

  it('lists other Butter Auth accounts, which can be reopened or forgotten', async () => {
    m.butrAccounts = [{ name: 'badadib' }, { name: 'second-acct' }, { name: 'newbie', incubation: true }]
    const { user } = mount()
    // The account already signed in is not offered again.
    expect(screen.queryByRole('button', { name: /@badadib/ })).not.toBeInTheDocument()
    // An incubating account has no Hive name yet: no @, its initial for an avatar.
    expect(screen.getByRole('button', { name: /^Nnewbie/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /@second-acct/ }))
    await waitFor(() => expect(m.open).toHaveBeenCalled())
    expect(JSON.parse(m.fetch.mock.calls[0][1].body).signup).toBe(false)

    const forget = screen.getAllByRole('button', { name: 'Remove from this list' })
    await user.click(forget[0])
    expect(m.forgot).toHaveBeenCalledWith('second-acct')
    expect(screen.queryByRole('button', { name: /@second-acct/ })).not.toBeInTheDocument()
  })

  it('"Add another account" goes on to the wallets, Butter Auth included', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Add another account/ }))
    const wallets = screen.getByRole('dialog', { name: 'Wallet login' })
    await user.click(await within(wallets).findByRole('button', { name: /Butter Auth/ }))
    await waitFor(() => expect(m.open).toHaveBeenCalled())
  })
})

describe('the login window: reopening', () => {
  function Host() {
    const [shown, setShown] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setShown((v) => !v)}>Toggle login</button>
        <LoginModal displayed={shown} onLogin={() => {}} onClose={() => {}} />
      </>
    )
  }

  it('starts again on the chooser after it was closed on the wallets', async () => {
    const { user } = renderWithProviders(<Host />)
    await user.click(screen.getByRole('button', { name: /Log in with/ }))
    expect(screen.getByRole('dialog', { name: 'Wallet login' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle login' }))
    expect(screen.queryByRole('dialog', { name: 'Wallet login' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle login' }))
    expect(screen.getByRole('heading', { name: 'Welcome to 3Speak' })).toBeInTheDocument()
  })
})
