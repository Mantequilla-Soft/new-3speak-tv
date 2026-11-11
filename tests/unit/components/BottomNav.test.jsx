// @vitest-environment jsdom
// The phone's bottom bar (components/BottomNav/BottomNav.jsx): Feeds, Shorts,
// Groups, Audio and the account button. The page being shown is marked active;
// signed out, the account button opens the login dialog, signed in it opens the
// same account menu the desktop avatar does.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/components/PremiumBadge/PremiumBadge', () => ({ default: () => null }))
vi.mock('../../../src/utils/pwaInstall', () => ({
  usePwaInstall: () => ({ canInstallPrompt: false, isIOS: false, showInstall: false, promptInstall: vi.fn() }),
}))

const { useAppStore } = await import('../../../src/lib/store')
const { default: BottomNav } = await import('../../../src/components/BottomNav/BottomNav.jsx')

function mount({ route = '/', ...props } = {}) {
  const openLoginModal = vi.fn()
  const onOpenProfileMenu = vi.fn()
  const r = renderWithProviders(
    <BottomNav openLoginModal={openLoginModal} onOpenProfileMenu={onOpenProfileMenu} {...props} />,
    { route },
  )
  return { ...r, openLoginModal, onOpenProfileMenu, nav: () => screen.getByRole('navigation') }
}

beforeEach(() => {
  useAppStore.setState({ authenticated: false, user: null })
})

describe('the bottom navigation bar', () => {
  it('links to the four sections, drawn straight into the page body', () => {
    const { nav } = mount()
    expect(nav().parentElement).toBe(document.body)
    const links = within(nav()).getAllByRole('link')
    // The visible label only: the Material Symbols glyph is ligature text.
    const label = (a) => (a.querySelector('.bottom-nav-label') || a).textContent
    expect(links.map((a) => [label(a), a.getAttribute('href')])).toEqual([
      ['Feeds', '/'], ['Shorts', '/shorts'], ['Groups', '/groups'], ['Audio', '/audio'], ['Login', '#'],
    ])
  })

  it.each([
    ['/', 'Feeds'],
    ['/shorts/alice/clip', 'Shorts'],
    ['/groups/hive-123', 'Groups'],
    ['/audio', 'Audio'],
  ])('on %s marks %s as the current section', (route, name) => {
    const { nav } = mount({ route })
    const active = within(nav()).getAllByRole('link').filter((a) => a.classList.contains('active'))
    expect(active.map((a) => a.querySelector('.bottom-nav-label').textContent)).toEqual([name])
  })

  it('switches to the watch-page style on a video page', () => {
    const { nav } = mount({ route: '/watch' })
    expect(nav()).toHaveClass('bottom-nav--watch')
  })

  it('follows a tap to another section', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('link', { name: 'Audio' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/audio')
    expect(screen.getByRole('link', { name: 'Audio' })).toHaveClass('active')
  })

  it('signed out, the account button opens the login dialog and does not navigate', async () => {
    const { user, openLoginModal, onOpenProfileMenu } = mount({ route: '/audio' })
    await user.click(screen.getByRole('link', { name: 'Login' }))
    expect(openLoginModal).toHaveBeenCalledTimes(1)
    expect(onOpenProfileMenu).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/audio')
  })

  it('signed in, shows the avatar and opens the account menu', async () => {
    act(() => useAppStore.setState({ authenticated: true, user: 'alice' }))
    const { user, openLoginModal, onOpenProfileMenu } = mount()
    const account = screen.getByRole('link', { name: /profile/i })
    expect(within(account).getByRole('img', { name: 'alice' })).toHaveAttribute('src', '/img/u/alice/avatar/small')
    await user.click(account)
    expect(onOpenProfileMenu).toHaveBeenCalledTimes(1)
    expect(openLoginModal).not.toHaveBeenCalled()
  })

  it('marks the account button while the account menu is open', () => {
    act(() => useAppStore.setState({ authenticated: true, user: 'alice' }))
    mount({ profileMenuOpen: true })
    expect(screen.getByRole('link', { name: /profile/i })).toHaveClass('active')
  })
})
