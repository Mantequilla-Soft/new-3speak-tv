// @vitest-environment jsdom
// The account menu the avatar opens (components/nav/ProfileNav.jsx): who is
// signed in with their voting power and resource credits, the way to their
// channel, wallet, settings and the other pages they can use, change account and
// log out, and the ways it closes (Escape, the backdrop, moving to another page).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { useNavigate } from 'react-router-dom'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/hiveUtils', () => ({ getVotePower: (...a) => m.votePower(...a) }))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://api.hive.example/', ensureHealthyNode: async () => 'https://node.example/' }))
vi.mock('../../../src/utils/config', async (importOriginal) => ({ ...(await importOriginal()), adsEnabledFor: () => m.ads }))
vi.mock('../../../src/hooks/useCanImportVideos', () => ({ default: () => false }))
vi.mock('../../../src/hooks/getUserDetails', () => ({ useGetMyQuery: () => ({ data: null }) }))
vi.mock('../../../src/utils/avatarCache', () => ({ useAvatarUrl: (u) => `/img/u/${u}/avatar` }))
vi.mock('../../../src/lib/incubation', () => ({ fetchBackfillSummary: async () => ({ pending: m.backlog }) }))
vi.mock('../../../src/lib/referralLinks', () => ({ fetchMyInviteLinks: async () => ({ links: m.invites }) }))
vi.mock('../../../src/lib/translatorApi', () => ({ isTranslatorName: async () => m.translator }))
vi.mock('../../../src/components/LeaderboardBadges/LeaderboardBadges', () => ({ default: () => <a href="/leaderboard?board=views">Top 10 views</a> }))
vi.mock('../../../src/utils/pwaInstall', () => ({ usePwaInstall: () => m.pwa }))
vi.mock('../../../src/components/SettingsModal/SettingsModal', () => ({ default: ({ isOpen }) => (isOpen ? <div role="dialog" aria-label="Settings" /> : null) }))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: ProfileNav } = await import('../../../src/components/nav/ProfileNav.jsx')

function GoElsewhere() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/somewhere-else')}>Go elsewhere</button>
}

function mount(props = {}) {
  const onclose = vi.fn()
  const openLoginModal = vi.fn()
  const r = renderWithProviders(<><ProfileNav isVisible onclose={onclose} openLoginModal={openLoginModal} {...props} /><GoElsewhere /></>, { route: '/feed' })
  return { ...r, onclose, openLoginModal, menu: () => screen.getByRole('menu', { name: 'Account menu' }) }
}

beforeEach(() => {
  Object.assign(m, {
    votePower: vi.fn(async () => ({ vp: 8750, rcPercent: 64.321 })),
    ads: false, backlog: 0, invites: [], translator: false,
    pwa: { canInstallPrompt: false, isIOS: false, showInstall: false, promptInstall: vi.fn() },
  })
  useAppStore.setState({ user: 'badadib', incubationHandle: null, LogOut: vi.fn() })
})
afterEach(() => localStorage.clear())

describe('the account menu', () => {
  it('names the account and shows its voting power and resource credits', async () => {
    const { menu } = mount()
    expect(within(menu()).getByText('@badadib')).toBeInTheDocument()
    expect(within(menu()).getByRole('link', { name: 'My channel' })).toHaveAttribute('href', '/profile')
    expect(await within(menu()).findByText('87.50%')).toBeInTheDocument()
    expect(within(menu()).getByText('64.32%')).toBeInTheDocument()
    expect(m.votePower).toHaveBeenCalledWith('badadib')
  })

  it('shows the Hive node in use, without the scheme', async () => {
    mount()
    expect(await screen.findByText('node.example')).toBeInTheDocument()
  })

  it('lists the pages every member gets, as menu items', () => {
    const { menu } = mount()
    // The visible label only: the Material Symbols glyph is ligature text.
    const label = (el) => (el.querySelector('.pn-label') || el).textContent.trim()
    const items = within(menu()).getAllByRole('menuitem').map(label)
    expect(items).toEqual(['My Channel', 'Wallet', 'Settings', 'Analytics', 'Rankings', 'About 3Speak', 'FAQ', 'Change account'])
  })

  it('adds Advertise, invite links, the translation editor and the publish backlog for those who have them', async () => {
    m.ads = true
    m.invites = [{ code: 'a' }]
    m.translator = true
    m.backlog = 3
    const { menu } = mount()
    expect(await within(menu()).findByRole('menuitem', { name: /Publish backlog/ })).toHaveTextContent('3')
    expect(within(menu()).getByRole('menuitem', { name: 'Advertise' })).toHaveAttribute('href', '/advertise')
    expect(await within(menu()).findByRole('menuitem', { name: 'Invite links' })).toHaveAttribute('href', '/invite-links')
    expect(await within(menu()).findByRole('menuitem', { name: 'Edit translations' })).toHaveAttribute('href', '/translate')
  })

  it('an account still incubating gets no wallet, meters or analytics', () => {
    act(() => useAppStore.setState({ user: null, incubationHandle: 'newbie' }))
    const { menu } = mount()
    expect(within(menu()).getByText('@newbie')).toBeInTheDocument()
    expect(within(menu()).queryByRole('menuitem', { name: 'Wallet' })).not.toBeInTheDocument()
    expect(within(menu()).queryByRole('menuitem', { name: 'Analytics' })).not.toBeInTheDocument()
    expect(within(menu()).queryByText('VP')).not.toBeInTheDocument()
  })

  it('Wallet opens the member\'s wallet and closes the menu', async () => {
    const { user, onclose } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Wallet' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/wallet/badadib')
    expect(onclose).toHaveBeenCalled()
  })

  it('Settings opens the settings window', async () => {
    const { user, onclose } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(onclose).toHaveBeenCalled()
  })

  it('Change account opens the login window', async () => {
    const { user, onclose, openLoginModal } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Change account' }))
    expect(onclose).toHaveBeenCalled()
    expect(openLoginModal).toHaveBeenCalledTimes(1)
  })

  it('offers Logout for a Butter Auth login, which signs out and goes home', async () => {
    localStorage.setItem('manteauth_login', 'true')
    const { user, onclose } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Logout' }))
    expect(useAppStore.getState().LogOut).toHaveBeenCalledWith('badadib')
    expect(onclose).toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('closes on Escape, on the backdrop, and when the page changes, but not on a click inside', async () => {
    const { user, onclose, menu } = mount()
    await user.click(within(menu()).getByText('@badadib'))
    expect(onclose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onclose).toHaveBeenCalledTimes(1)
    await user.click(document.querySelector('.profilenav-container'))
    expect(onclose).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }))
    await waitFor(() => expect(onclose).toHaveBeenCalledTimes(3))
  })

  it('following one of the badges closes the menu', async () => {
    const { user, onclose } = mount()
    await user.click(screen.getByRole('link', { name: 'Top 10 views' }))
    expect(onclose).toHaveBeenCalled()
  })

  it('on an iPhone, Install explains the Share-sheet way', async () => {
    m.pwa = { canInstallPrompt: false, isIOS: true, showInstall: true, promptInstall: vi.fn() }
    const { user } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Install App' }))
    expect(toast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ description: expect.stringMatching(/Add to Home Screen/) }))
    expect(m.pwa.promptInstall).not.toHaveBeenCalled()
  })

  it('elsewhere, Install asks the browser to install the app', async () => {
    m.pwa = { canInstallPrompt: true, isIOS: false, showInstall: true, promptInstall: vi.fn() }
    const { user } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Install App' }))
    expect(m.pwa.promptInstall).toHaveBeenCalledTimes(1)
  })

  it('links to 3Speak on Discord, X and Telegram in new tabs', () => {
    mount()
    for (const name of ['3Speak on Discord', '3Speak on X', '3Speak on Telegram']) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('target', '_blank')
    }
  })
})
