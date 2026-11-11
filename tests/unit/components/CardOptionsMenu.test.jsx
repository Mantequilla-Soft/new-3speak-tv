// @vitest-environment jsdom
// The "more options" menu on a video card (components/CardOptionsMenu/CardOptionsMenu.jsx):
// add to playlist, add a tag, "not interested" and "don't show this creator".
// Hiding drops the card at once through onDismiss, saves the choice, and the
// toast offers an Undo. Signed out, every personal action asks to log in instead.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { renderWithProviders, toastMessages } from './_render.jsx'

const filters = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/userFilters', () => ({
  hideVideo: (...a) => filters.hideVideo(...a),
  unhideVideo: (...a) => filters.unhideVideo(...a),
  hideCreator: (...a) => filters.hideCreator(...a),
  unhideCreator: (...a) => filters.unhideCreator(...a),
  refreshRailsAfterHide: (...a) => filters.refreshRailsAfterHide(...a),
}))
vi.mock('../../../src/components/AddToPlaylistModal/AddToPlaylistModal', () => ({
  default: ({ isOpen, onClose, author, permlink, videoTitle }) => (isOpen ? (
    <div role="dialog" aria-label="Add to playlist dialog">
      <span>{`${author}/${permlink}: ${videoTitle}`}</span>
      <button type="button" onClick={onClose}>Done</button>
    </div>
  ) : null),
}))
vi.mock('../../../src/components/AddTagModal/AddTagModal', () => ({
  default: ({ isOpen }) => (isOpen ? <div role="dialog" aria-label="Tag this video" /> : null),
}))

const { toast } = await import('sonner')
const aioha = await import('../../../src/hive-api/aioha')
const { useAppStore } = await import('../../../src/lib/store')
const { default: CardOptionsMenu } = await import('../../../src/components/CardOptionsMenu/CardOptionsMenu.jsx')

function signIn(user = 'alice') {
  aioha.isLoggedIn.mockReturnValue(true)
  act(() => useAppStore.setState({ user }))
}

function mount(props = {}) {
  const onDismiss = vi.fn()
  const onOpenChange = vi.fn()
  const r = renderWithProviders(
    <CardOptionsMenu author="bob" permlink="video-1" title="Bob's video" onDismiss={onDismiss} onOpenChange={onOpenChange} {...props} />,
  )
  return { ...r, onDismiss, onOpenChange }
}

const trigger = () => screen.getByRole('button', { name: 'More options' })

async function openMenu(user) {
  await user.click(trigger())
  return screen.getByRole('menu')
}

beforeEach(() => {
  aioha.isLoggedIn.mockReturnValue(false)
  useAppStore.setState({ user: null })
  filters.hideVideo = vi.fn(async () => true)
  filters.unhideVideo = vi.fn(async () => true)
  filters.hideCreator = vi.fn(async () => true)
  filters.unhideCreator = vi.fn(async () => true)
  filters.refreshRailsAfterHide = vi.fn()
})

describe('the card options menu', () => {
  it('is a named, collapsed menu button until pressed', () => {
    mount()
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the four actions, naming the creator', async () => {
    const { user, onOpenChange } = mount()
    const menu = await openMenu(user)
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    // Accessible names: the Material Symbols glyphs are aria-hidden ligature text.
    const items = screen.getAllByRole('menuitem').map((b) => computeAccessibleName(b))
    expect(items).toEqual(['Add to playlist', 'Add tag', 'Not interested', "Don't show @bob"])
    expect(menu.parentElement).toBe(document.body)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
  })

  it('closes again on a second press, on Escape, and on a click elsewhere', async () => {
    const { user, onOpenChange } = mount()
    await openMenu(user)
    await user.click(trigger())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)

    await openMenu(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await openMenu(user)
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes when the page scrolls, so it never floats away from its card', async () => {
    const { user } = mount()
    await openMenu(user)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not let a click on the button reach the card link underneath', async () => {
    const onCardClick = vi.fn()
    const { user } = renderWithProviders(
      <div onClick={onCardClick}><CardOptionsMenu author="bob" permlink="video-1" /></div>,
    )
    await user.click(trigger())
    expect(onCardClick).not.toHaveBeenCalled()
  })

  describe('signed out', () => {
    it.each([
      ['Not interested', 'Please login to personalize your feed'],
      ["Don't show @bob", 'Please login to personalize your feed'],
      ['Add to playlist', 'Please login to add videos to playlists'],
      ['Add tag', 'Please login to tag videos'],
    ])('"%s" asks to log in and changes nothing', async (item, message) => {
      const { user, onDismiss } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: item }))
      expect(toastMessages(toast.error)).toEqual([message])
      expect(onDismiss).not.toHaveBeenCalled()
      expect(filters.hideVideo).not.toHaveBeenCalled()
      expect(filters.hideCreator).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('signed in', () => {
    beforeEach(() => signIn('alice'))

    it('"Not interested" drops the card, saves it, and Undo brings it back', async () => {
      const { user, onDismiss } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: 'Not interested' }))
      expect(onDismiss).toHaveBeenCalledWith('video', { owner: 'bob', permlink: 'video-1' })
      expect(filters.hideVideo).toHaveBeenCalledWith('alice', 'bob', 'video-1')

      const [, opts] = toast.success.mock.calls.at(-1)
      expect(opts.description).toBe("Not interested. We'll hide this video")
      expect(opts.action.label).toBe('Undo')
      act(() => opts.action.onClick())
      expect(filters.unhideVideo).toHaveBeenCalledWith('alice', 'bob', 'video-1')
      expect(onDismiss).toHaveBeenLastCalledWith('undo-video', { owner: 'bob', permlink: 'video-1' })
    })

    it('"Don\'t show" hides the creator and refreshes the other rails once saved', async () => {
      const { user, onDismiss, queryClient } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: "Don't show @bob" }))
      expect(onDismiss).toHaveBeenCalledWith('creator', { owner: 'bob' })
      expect(filters.hideCreator).toHaveBeenCalledWith('alice', 'bob')
      await waitFor(() => expect(filters.refreshRailsAfterHide).toHaveBeenCalledWith(queryClient))

      const [, opts] = toast.success.mock.calls.at(-1)
      expect(opts.description).toBe('Hiding videos from @bob')
      act(() => opts.action.onClick())
      expect(filters.unhideCreator).toHaveBeenCalledWith('alice', 'bob')
      expect(onDismiss).toHaveBeenLastCalledWith('undo-creator', { owner: 'bob' })
      await waitFor(() => expect(filters.refreshRailsAfterHide).toHaveBeenCalledTimes(2))
    })

    it('does not refresh the rails when saving the hidden creator failed', async () => {
      filters.hideCreator = vi.fn(async () => false)
      const { user } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: "Don't show @bob" }))
      await Promise.resolve()
      expect(filters.refreshRailsAfterHide).not.toHaveBeenCalled()
    })

    it('will not hide your own channel, whatever the letter case', async () => {
      signIn('Bob')
      const { user, onDismiss } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: "Don't show @bob" }))
      expect(toastMessages(toast.error)).toEqual(["You can't hide your own videos"])
      expect(onDismiss).not.toHaveBeenCalled()
      expect(filters.hideCreator).not.toHaveBeenCalled()
    })

    it('"Add to playlist" opens the playlist dialog for this video', async () => {
      const { user, onOpenChange } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: 'Add to playlist' }))
      const dialog = screen.getByRole('dialog', { name: 'Add to playlist dialog' })
      expect(dialog).toHaveTextContent("bob/video-1: Bob's video")
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      // The hover preview is held open while the dialog is up, and let go after.
      expect(onOpenChange).toHaveBeenLastCalledWith(true)
      await user.click(screen.getByRole('button', { name: 'Done' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })

    // BUG: "Add tag" sets tagOpen but the component never renders AddTagModal
    // (imported at CardOptionsMenu.jsx:11, state at :36, no JSX for it after :194).
    // A signed-in viewer taps it and nothing happens; worse, onOpenChange(true)
    // stays on, so the card's hover preview is held open until the card unmounts.
    it('BUG: "Add tag" opens the tag dialog', async () => {
      const { user } = mount()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: 'Add tag' }))
      expect(screen.getByRole('dialog', { name: 'Tag this video' })).toBeInTheDocument()
    })
  })
})
