// @vitest-environment jsdom
// The top bar (components/nav/Nav.jsx). The logo folds the page tabs out and the
// choice is remembered; a visitor gets FAQ, Log in and Sign up (Sign up only
// where an account can be made); a member gets Share, which a resting mouse
// peeks at (a bottom sheet on narrow screens), their playlists, Settings (a peek
// under the gear, a click opens the window) and the account menu.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia, useFakeClock } from './_render.jsx'

const m = vi.hoisted(() => ({ butrauth: true }))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  get ENABLE_BUTRAUTH() { return m.butrauth },
}))
vi.mock('../../../src/utils/signupPossible', () => ({ useSignupPossible: () => m.signup }))
vi.mock('../../../src/utils/avatarCache', () => ({ useAvatarUrl: (u) => `/img/u/${u}/avatar/small` }))
vi.mock('../../../src/utils/advertiserAccount', () => ({
  isRememberedAdvertiser: () => m.rememberedAdvertiser,
  rememberAdvertiserAccount: (...a) => m.rememberAdvertiser(...a),
  hasAdvertiserProduct: async () => m.hasProduct,
}))
vi.mock('../../../src/hooks/useMyPlaylists', () => ({ useMyPlaylists: () => ({ data: m.playlists }) }))
vi.mock('../../../src/components/nav/NavSearch', () => ({ default: () => <div className="navsearch-wrap"><input aria-label="Search" /></div> }))
vi.mock('../../../src/components/UploadLinks', () => ({ default: () => <a href="/embed-studio">Upload a video</a> }))
vi.mock('../../../src/components/Incubation/NavProgress', () => ({ default: () => null }))
vi.mock('../../../src/components/Incubation/IncubationBell', () => ({ default: () => <span>Incubation bell</span> }))
// Creator rows by key; only the lookup is faked, the key rule is the real one.
vi.mock('../../../src/utils/creatorSettings', async (importOriginal) => ({
  ...(await importOriginal()),
  useCreatorSettings: (key) => { if (key) m.lookedUp.push(key); return (key && m.rows[key]) || null },
}))
vi.mock('../../../src/components/nav/NotificationBell', () => ({ default: () => <span>Hive bell</span> }))
vi.mock('../../../src/components/Chat/ChatButton', () => ({ default: () => null }))
vi.mock('../../../src/components/PremiumBadge/PremiumBadge', () => ({ default: () => null }))
vi.mock('../../../src/components/SettingsModal/SettingsModal', () => ({
  default: ({ isOpen, dropdown, onClose }) => (isOpen ? (
    <div role="dialog" aria-label={dropdown ? (dropdown.held ? 'Settings (held under the gear)' : 'Settings (peek under the gear)') : 'Settings'}>
      <button type="button" onClick={onClose}>Close settings</button>
    </div>
  ) : null),
}))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Nav } = await import('../../../src/components/nav/Nav.jsx')

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

function mount(props = {}, opts = {}) {
  const openLoginModal = vi.fn()
  const toggleProfileNav = vi.fn()
  const r = renderWithProviders(<Nav openLoginModal={openLoginModal} toggleProfileNav={toggleProfileNav} profileMenuHover={{}} {...props} />, opts)
  return { ...r, openLoginModal, toggleProfileNav }
}
const logo = () => screen.getByRole('button', { name: '3Speak' })
const signIn = (user = 'badadib') => act(() => useAppStore.setState({ authenticated: true, user, authChecked: true }))

beforeEach(() => {
  stubMatchMedia((q) => q === '(min-width: 641px)')
  Object.assign(m, {
    butrauth: true, signup: { loading: false, possible: true }, rememberedAdvertiser: false, hasProduct: false,
    rememberAdvertiser: vi.fn(), playlists: [], rows: {}, lookedUp: [],
  })
  useAppStore.setState({ authenticated: false, user: null, authChecked: true, incubationHandle: null, initializeTheme: () => {} })
  localStorage.clear()
})

describe('the top bar: the page tabs', () => {
  it('keeps the tabs folded behind the logo at first', () => {
    mount()
    expect(logo()).toHaveAttribute('aria-expanded', 'false')
    expect(logo()).toHaveAttribute('title', 'Show pages')
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument()
  })

  it('the logo folds the tabs out, marks the current page, and remembers it', async () => {
    const { user } = mount({}, { route: '/audio' })
    await user.click(logo())
    expect(logo()).toHaveAttribute('aria-expanded', 'true')
    const tabs = document.getElementById('nav-tabs')
    expect(within(tabs).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/', '/shorts', '/audio', '/groups', '/leaderboard'])
    expect(within(tabs).getByRole('link', { name: /Audio/ })).toHaveClass('active')
    expect(within(tabs).getByRole('link', { name: /Overview/ })).not.toHaveClass('active')
    expect(localStorage.getItem('3speak_nav_tabs_open')).toBe('true')
  })

  it('opens with the tabs out for someone who left them out', () => {
    localStorage.setItem('3speak_nav_tabs_open', 'true')
    mount()
    expect(screen.getByRole('link', { name: /Overview/ })).toBeInTheDocument()
  })

  it('a member\'s tabs end with their playlists', async () => {
    signIn()
    m.playlists = [{ id: 'wl-1', name: 'Watch Later', items: [1, 2, 3] }]
    localStorage.setItem('3speak_nav_tabs_open', 'true')
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Playlists/ }))
    expect(screen.getByRole('link', { name: 'Watch Later (3)' })).toHaveAttribute('href', '/playlist/wl-1')
    expect(screen.getByRole('link', { name: 'Watch History' })).toHaveAttribute('href', '/watched/badadib')
    expect(screen.getByRole('link', { name: 'All Playlists' })).toHaveAttribute('href', '/profile?tab=playlists')
    await user.click(screen.getByRole('link', { name: 'All Playlists' }))
    expect(screen.queryByRole('link', { name: 'Watch History' })).not.toBeInTheDocument()
  })

  it('without a Watch Later playlist, the entry leads to the playlists tab', async () => {
    signIn()
    localStorage.setItem('3speak_nav_tabs_open', 'true')
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Playlists/ }))
    expect(screen.getByRole('link', { name: 'Watch Later' })).toHaveAttribute('href', '/profile?tab=playlists')
  })
})

describe('the top bar for a visitor', () => {
  it('offers FAQ, Log in and Sign up', async () => {
    const { user, openLoginModal } = mount()
    expect(screen.getAllByRole('link', { name: 'Frequently asked questions' })[0]).toHaveAttribute('href', '/faq')
    await user.click(screen.getByRole('button', { name: /Log in/ }))
    expect(openLoginModal).toHaveBeenLastCalledWith('login')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(openLoginModal).toHaveBeenLastCalledWith('signup')
  })

  it('drops Sign up where no account can be made from this network', () => {
    m.signup = { loading: false, possible: false }
    mount()
    expect(screen.getByRole('button', { name: /Log in/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument()
  })

  it('shows no Sign up while that is still being checked', () => {
    m.signup = { loading: true, possible: true }
    mount()
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument()
  })

  it('shows no login buttons before the stored session has been read', () => {
    act(() => useAppStore.setState({ authChecked: false }))
    mount()
    expect(screen.queryByRole('button', { name: /Log in/ })).not.toBeInTheDocument()
  })
})

describe('the top bar for a member', () => {
  beforeEach(() => signIn())

  it('shows the Hive bell, or the incubation bell for an account still incubating', () => {
    const { unmount } = mount()
    expect(screen.getByText('Hive bell')).toBeInTheDocument()
    unmount()
    act(() => useAppStore.setState({ incubationHandle: 'newbie' }))
    mount()
    expect(screen.getByText('Incubation bell')).toBeInTheDocument()
  })

  it('shows Advertise to an advertiser account only', async () => {
    const { unmount } = mount()
    await act(async () => {})
    expect(screen.queryByRole('link', { name: 'Advertise' })).not.toBeInTheDocument()
    unmount()
    m.hasProduct = true
    mount()
    expect(await screen.findByRole('link', { name: 'Advertise' })).toHaveAttribute('href', '/advertise')
    expect(m.rememberAdvertiser).toHaveBeenCalledWith('badadib')
  })

  it('opens the account menu from the avatar', async () => {
    const { user, toggleProfileNav } = mount()
    await user.click(document.querySelector('.nav-avatar-wrap img'))
    expect(toggleProfileNav).toHaveBeenCalledTimes(1)
  })

  it('drops Share for a warm-up user whose ~<handle> row blocks uploads', () => {
    act(() => useAppStore.setState({ user: null, incubationHandle: 'newbie' }))
    const { unmount } = mount()
    expect(screen.getByTitle('Share')).toBeInTheDocument()
    unmount()
    m.rows['~newbie'] = { canUpload: false }
    mount()
    expect(screen.queryByTitle('Share')).not.toBeInTheDocument()
    expect(m.lookedUp).toContain('~newbie')
  })

  it('keeps Share for a Hive account even when blocked (the entries show the support notice)', () => {
    m.rows.badadib = { canUpload: false }
    mount()
    expect(screen.getByTitle('Share')).toBeInTheDocument()
    expect(m.lookedUp).toEqual([])
  })

  it('a click on Share keeps its menu open, a second click closes it', async () => {
    const { user } = mount()
    const share = screen.getByTitle('Share')
    await user.click(share)
    expect(screen.getByRole('link', { name: 'Upload a video' })).toBeInTheDocument()
    await user.click(share)
    expect(document.querySelector('.nav-upload-flyout')).toHaveClass('nav-upload-flyout--leaving')
  })

  it('a mouse resting on Share peeks at its menu', async () => {
    useFakeClock()
    try {
      const { user } = mount({}, { fakeTimers: true })
      await user.hover(screen.getByTitle('Share'))
      expect(screen.queryByRole('link', { name: 'Upload a video' })).not.toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(250) })
      expect(screen.getByRole('link', { name: 'Upload a video' })).toBeInTheDocument()
      await user.unhover(screen.getByTitle('Share'))
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.queryByRole('link', { name: 'Upload a video' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('on a narrow screen Share opens a bottom sheet with a close button', async () => {
    stubMatchMedia((q) => q === '(max-width: 1024px)')
    const { user } = mount()
    await user.click(screen.getByTitle('Share'))
    const sheet = screen.getByRole('dialog', { name: 'Share' })
    expect(within(sheet).getByRole('link', { name: 'Upload a video' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Share' })).not.toBeInTheDocument()
  })

  it('a click on the gear opens the settings window', async () => {
    const { user } = mount()
    await user.click(document.querySelector('.nav-settings-btn'))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('a mouse resting on the gear peeks at settings under it, and a click holds it there', async () => {
    useFakeClock()
    try {
      const { user } = mount({}, { fakeTimers: true })
      const gear = document.querySelector('.nav-settings-btn')
      await user.hover(gear)
      act(() => { vi.advanceTimersByTime(250) })
      expect(screen.getByRole('dialog', { name: 'Settings (peek under the gear)' })).toBeInTheDocument()
      await user.click(gear)
      expect(screen.getByRole('dialog', { name: 'Settings (held under the gear)' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // BUG: three of the bar's controls are not buttons: the Share trigger is a
  // <div onClick> (Nav.jsx:182), the settings gear an <svg onClick> (:513, :548) and the
  // account avatar a <span onClick> (:514). None takes keyboard focus or has a
  // role, so from the keyboard there is no way to upload, open Settings or reach
  // the account menu (and log out).
  it('BUG: Share, Settings and the account menu are buttons a keyboard can reach', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /account|profile|menu/i })).toBeInTheDocument()
  })
})

afterEach(() => vi.useRealTimers())
