// @vitest-environment jsdom
// The account menu the avatar opens (components/nav/ProfileNav.jsx, 07d + 42b):
// who is signed in with a Switch (change account), their voting power and
// resource credits, their places as tiles, the theme switch, the other pages
// they can use, the small links with "Hide pages", Settings and Log out, and the
// ways it closes (Escape, the backdrop, moving to another page).
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
vi.mock('../../../src/lib/incubation', () => ({
  fetchBackfillSummary: async () => ({ pending: m.backlog }),
  // A warm-up account's goals (the menu's path block): 1 of 2 done, half way.
  fetchIncubationProgress: async () => ({ tasks: [{ type: 'video', done: false, have: 0, need: 3 }, { type: 'follow', done: true, have: 5, need: 5 }] }),
  onIncubationProgress: () => () => {},
  progressFraction: (tasks) => tasks.filter((t) => t.done).length / tasks.length,
}))
vi.mock('../../../src/lib/referralLinks', () => ({ fetchMyInviteLinks: async () => ({ links: m.invites }) }))
vi.mock('../../../src/lib/translatorApi', () => ({ isTranslatorName: async () => m.translator }))
vi.mock('../../../src/components/LeaderboardBadges/LeaderboardBadges', () => ({ default: () => <a href="/leaderboard?board=views">Top 10 views</a> }))
vi.mock('../../../src/utils/pwaInstall', () => ({ usePwaInstall: () => m.pwa }))
vi.mock('../../../src/context/ChatContext', () => ({ useChat: () => ({ ready: false, warmup: false }) }))
vi.mock('../../../src/hooks/useServerUnread', () => ({ useServerUnread: () => ({ unreadCount: 0 }) }))
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

  // Issue #563: a followed "Powered by Hive" link to hive.io.
  it('links to hive.io as "Powered by Hive", followed (no nofollow / ugc / sponsored)', () => {
    mount()
    const link = screen.getByRole('link', { name: 'Powered by Hive' })
    expect(link).toHaveAttribute('href', 'https://hive.io')
    expect(link.getAttribute('rel')).not.toMatch(/nofollow|ugc|sponsored/)
  })

  it('lists the pages every member gets, as menu items', () => {
    const { menu } = mount()
    // The visible label only: the Material Symbols glyph is ligature text.
    const label = (el) => (el.querySelector('.pn-label') || el).textContent.trim()
    const items = within(menu()).getAllByRole('menuitem').map(label)
    expect(items).toEqual([
      'Switch', 'Channel', 'Studio', 'Wallet', 'Playlists', 'History', 'Badges',
      // Settings as a row, About and FAQ along the bottom (owner 2026-11-12).
      'Analytics', 'Groups', 'Live', 'Chat', 'Rankings', 'Settings', 'About 3Speak', 'FAQ',
    ])
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

  it('an account still incubating sees its path to a Hive account instead (owner 2026-11-12)', async () => {
    act(() => useAppStore.setState({ user: null, incubationHandle: 'newbie' }))
    const { menu } = mount()
    expect(await within(menu()).findByText('Your path to a Hive account')).toBeInTheDocument()
    expect(within(menu()).getByText('1 of 2 done')).toBeInTheDocument()
    expect(within(menu()).getByText('50%')).toBeInTheDocument()
    expect(within(menu()).getByRole('link', { name: /Your path to a Hive account/ })).toHaveAttribute('href', '/profile')
  })

  it('a Hive account has no path block', () => {
    const { menu } = mount()
    expect(within(menu()).queryByText('Your path to a Hive account')).not.toBeInTheDocument()
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
    // Settings loads on first open (code-split), so wait for it.
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(onclose).toHaveBeenCalled()
  })

  it('Change account opens the login window', async () => {
    const { user, onclose, openLoginModal } = mount()
    await user.click(screen.getByRole('menuitem', { name: 'Change account' }))
    expect(onclose).toHaveBeenCalled()
    expect(openLoginModal).toHaveBeenCalledTimes(1)
  })

  it('has no Log out (Switch covers changing account, owner 2026-11-12)', () => {
    localStorage.setItem('manteauth_login', 'true')
    mount()
    expect(screen.queryByRole('menuitem', { name: 'Log out' })).toBeNull()
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

  it('has no "Hide pages" switch any more (owner 2026-11-12)', () => {
    mount()
    expect(screen.queryByRole('menuitem', { name: /Hide pages|Show pages/ })).toBeNull()
  })

  it('the theme switch turns dark mode on and off', async () => {
    act(() => useAppStore.getState().setTheme('dark'))
    const { user } = mount()
    await user.click(screen.getByRole('switch', { name: 'Switch to light mode' }))
    expect(useAppStore.getState().theme).toBe('light')
  })

  it('links to 3Speak on Discord, X and Telegram in new tabs', () => {
    mount()
    for (const name of ['3Speak on Discord', '3Speak on X', '3Speak on Telegram']) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('target', '_blank')
    }
  })
})
