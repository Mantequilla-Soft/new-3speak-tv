// @vitest-environment jsdom
// The notifications bell in the top bar (components/nav/NotificationBell.jsx):
// what its button announces, the list it opens (Hive notifications grouped,
// new stories and podcast episodes above them), where a row leads, "Mark all
// read" clearing every kind of dot, and push notifications for this device.
// The hover peek itself is covered in notificationBellPeek.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, within, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const n = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/hooks/useHiveNotifications', () => ({ useHiveNotifications: (...a) => n.hive(...a) }))
vi.mock('../../../src/utils/webPush', () => ({
  pushSupported: () => n.pushSupported,
  getPushState: (...a) => n.getPushState(...a),
  enablePush: (...a) => n.enablePush(...a),
  disablePush: (...a) => n.disablePush(...a),
  syncPushSubscription: (...a) => n.syncPush(...a),
}))
vi.mock('../../../src/utils/threeSpeakDetection', () => ({
  use3SpeakDetection: () => n.threeSpeak, resolveRootPost: async (k) => k, ensure3SpeakStatus: async () => false,
}))
vi.mock('../../../src/utils/whaleDetection', () => ({ useWhaleDetection: () => n.whales }))
vi.mock('../../../src/components/HiveAvatar/HiveAvatar', () => ({ default: ({ username }) => <img alt={username} /> }))
vi.mock('../../../src/lib/stories', () => ({
  useStoryNotifications: () => ({ stories: n.stories, unseenCount: n.stories.filter((s) => !s.seen).length }),
  markStoriesSeen: (...a) => n.markStoriesSeen(...a),
  markStorySeen: (...a) => n.markStorySeen(...a),
  storyViewerPath: (o) => `/shorts/stories?user=${o}&story=1`,
  storyTimeLeft: () => 0.5,
  useStoryClock: () => Date.now(),
}))
vi.mock('../../../src/lib/podcasts', () => ({
  usePodcastNotifications: () => ({ episodes: n.episodes, unseenCount: n.episodes.filter((e) => !e.seen).length }),
  markPodcastNotificationsSeen: (...a) => n.markPodcastsSeen(...a),
  episodeToTrack: (ep) => ({ _id: ep.id, external: true, title: ep.title }),
  episodePath: (id) => `/audio?type=external&episode=${id}`,
  artUrl: () => '/art.jpg', onArtError: () => {}, PODCAST_PLACEHOLDER: '',
}))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: NotificationBell } = await import('../../../src/components/nav/NotificationBell.jsx')

const ago = (min) => new Date(Date.now() - min * 60000).toISOString().replace('Z', '')
const reply = { id: 1, type: 'reply', msg: '@badadib replied to your post', url: 'badadib/re-my-video', date: ago(5) }
const vote1 = { id: 2, type: 'vote', msg: '@fan-one voted on your post ($1.00)', url: 'listener/my-video', date: ago(30) }
const vote2 = { id: 3, type: 'vote', msg: '@fan-two voted on your post ($0.50)', url: 'listener/my-video', date: ago(40) }
const follow = { id: 4, type: 'follow', msg: '@badadib followed you', url: '@badadib', date: ago(90) }

function hive(over = {}) {
  return {
    notifications: [reply, vote1, vote2, follow],
    loading: false,
    unreadCount: 2,
    isUnread: (x) => x.id === 1 || x.id === 2,
    markAllAsRead: n.markAllAsRead,
    markingAsRead: false,
    ...over,
  }
}

// A row's message: the actor's name in bold, then the rest (26a), so the
// sentence is spread over two elements.
const msg = (text) => (_, el) => !!el?.classList?.contains('notif-msg') && el.textContent === text

function mount() {
  return renderWithProviders(<NotificationBell />)
}
const bell = () => screen.getByRole('button', { name: /^Notifications/ })
async function openList(user) {
  await user.click(bell())
  return screen.getByRole('menu')
}

beforeEach(() => {
  Object.assign(n, {
    markAllAsRead: vi.fn(),
    pushSupported: false,
    getPushState: vi.fn(async () => ({ supported: true, permission: 'default', subscribed: false })),
    enablePush: vi.fn(async () => {}),
    disablePush: vi.fn(async () => {}),
    syncPush: vi.fn(),
    threeSpeak: new Map(),
    whales: new Map(),
    stories: [],
    episodes: [],
    markStoriesSeen: vi.fn(),
    markStorySeen: vi.fn(),
    markPodcastsSeen: vi.fn(),
  })
  n.hive = vi.fn(() => hive())
  useAppStore.setState({ user: 'listener', authenticated: true, audioCurrent: null, audioQueue: [] })
})

describe('the notifications bell', () => {
  it('is not shown to a signed-out visitor', () => {
    act(() => useAppStore.setState({ user: null, authenticated: false }))
    mount()
    expect(screen.queryByRole('button', { name: /Notifications/ })).not.toBeInTheDocument()
    expect(n.hive).toHaveBeenCalledWith(null, { limit: 60 })
  })

  it('announces how many notifications are unread', () => {
    mount()
    expect(bell()).toHaveAccessibleName('Notifications (2 unread)')
    expect(n.hive).toHaveBeenCalledWith('listener', { limit: 60 })
  })

  it('announces new stories first', () => {
    n.stories = [{ owner: 'badadib', permlink: 's1', expires_at: new Date(Date.now() + 3600e3).toISOString(), posted_at: ago(10), seen: false }]
    mount()
    expect(bell()).toHaveAccessibleName('Notifications, 1 new story')
  })

  it('reads plain "Notifications" when everything is read', () => {
    n.hive = vi.fn(() => hive({ unreadCount: 0 }))
    mount()
    expect(bell()).toHaveAccessibleName('Notifications')
  })

  it('opens the list with single rows and grouped votes', async () => {
    const { user } = mount()
    const menu = await openList(user)
    expect(within(menu).getByText(msg('badadib replied to your post'))).toBeInTheDocument()
    expect(within(menu).getByText('5m')).toBeInTheDocument()
    expect(within(menu).getByText('@fan-one and @fan-two voted on your post ($1.50)')).toBeInTheDocument()
    expect(within(menu).getByText(msg('badadib followed you'))).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/notifications')
  })

  it('says it is loading before the first notifications arrive', async () => {
    n.hive = vi.fn(() => hive({ notifications: [], unreadCount: 0, loading: true }))
    const { user } = mount()
    await openList(user)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('You have no notifications yet.')).not.toBeInTheDocument()
  })

  it('says when there is nothing yet, without a "Mark all read"', async () => {
    n.hive = vi.fn(() => hive({ notifications: [], unreadCount: 0 }))
    const { user } = mount()
    await openList(user)
    expect(screen.getByText('You have no notifications yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark all read/ })).not.toBeInTheDocument()
  })

  it('opens the post a notification is about, and closes', async () => {
    const { user } = mount()
    const menu = await openList(user)
    await user.click(within(menu).getByText(msg('badadib replied to your post')))
    expect(screen.getByTestId('location')).toHaveTextContent('/post/badadib/re-my-video')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('a follow leads to the follower\'s profile', async () => {
    const { user } = mount()
    const menu = await openList(user)
    await user.click(within(menu).getByText(msg('badadib followed you')))
    expect(screen.getByTestId('location')).toHaveTextContent('/@badadib')
  })

  it('names each grouped voter on hover', async () => {
    const { user } = mount()
    const menu = await openList(user)
    await user.hover(within(menu).getByText(/voted on your post \(\$1\.50\)/))
    expect(within(menu).getByText('@fan-one')).toBeInTheDocument()
    expect(within(menu).getByText('@fan-two')).toBeInTheDocument()
  })

  it('marks whales and 3Speak videos', async () => {
    n.whales = new Map([['badadib', { tier: 'whale' }]])
    n.threeSpeak = new Map([['badadib/re-my-video', true]])
    const { user } = mount()
    const menu = await openList(user)
    const row = within(menu).getByText(msg('badadib replied to your post')).closest('li')
    expect(row).toHaveClass('notif-whale')
    expect(within(row).getByRole('img', { name: '3Speak' })).toBeInTheDocument()
  })

  it('"Mark all read" clears Hive, stories and podcast episodes together', async () => {
    n.stories = [{ owner: 'badadib', permlink: 's1', expires_at: new Date(Date.now() + 3600e3).toISOString(), posted_at: ago(10), seen: false }]
    const { user } = mount()
    await openList(user)
    await user.click(screen.getByRole('button', { name: /Mark all read/ }))
    expect(n.markAllAsRead).toHaveBeenCalledTimes(1)
    expect(n.markStoriesSeen).toHaveBeenCalledWith(n.stories)
    expect(n.markPodcastsSeen).toHaveBeenCalledWith('listener')
  })

  it('"Mark all read" still clears the cyan dot when only a podcast episode is new', async () => {
    n.hive = vi.fn(() => hive({ unreadCount: 0 }))
    n.episodes = [{ id: 'ep1', title: 'Episode one', seen: false, first_seen_at: ago(3), feed: { title: 'A show' } }]
    const { user } = mount()
    await openList(user)
    await user.click(screen.getByRole('button', { name: /Mark all read/ }))
    expect(n.markPodcastsSeen).toHaveBeenCalledWith('listener')
    expect(n.markAllAsRead).not.toHaveBeenCalled()
  })

  it('"Mark all read" waits while a marking is already on its way', async () => {
    n.hive = vi.fn(() => hive({ markingAsRead: true }))
    const { user } = mount()
    await openList(user)
    expect(screen.getByRole('button', { name: /Marking…/ })).toBeDisabled()
  })

  it('opens a story from the list in the story viewer', async () => {
    n.stories = [{ owner: 'badadib', permlink: 's1', hive_permlink: 'h1', expires_at: new Date(Date.now() + 3600e3).toISOString(), posted_at: ago(10), seen: false }]
    const { user } = mount()
    const menu = await openList(user)
    const stories = within(menu).getByRole('list', { name: 'Stories from people you follow' })
    await user.click(within(stories).getByRole('button', { name: '@badadib posted a story' }))
    expect(n.markStorySeen).toHaveBeenCalledWith('badadib', 's1', 'h1')
    expect(screen.getByTestId('location')).toHaveTextContent('/shorts/stories?user=badadib&story=1')
  })

  it('plays a new podcast episode from the list and opens its page', async () => {
    n.episodes = [{ id: 'ep1', title: 'Episode one', seen: false, first_seen_at: ago(3), feed: { title: 'A show' } }]
    const { user } = mount()
    const menu = await openList(user)
    await user.click(within(menu).getByText(/Episode one/))
    expect(useAppStore.getState().audioCurrent).toMatchObject({ _id: 'ep1', external: true })
    expect(screen.getByTestId('location')).toHaveTextContent('/audio?type=external&episode=ep1')
  })

  it('closes on Escape', async () => {
    const { user } = mount()
    await openList(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  describe('push notifications for this device', () => {
    beforeEach(() => { n.pushSupported = true })

    it('turns them on from the list and confirms it', async () => {
      const { user } = mount()
      await openList(user)
      const toggle = await screen.findByRole('button', { name: 'Notify me' })
      n.getPushState = vi.fn(async () => ({ supported: true, permission: 'granted', subscribed: true }))
      await user.click(toggle)
      expect(n.enablePush).toHaveBeenCalledWith('listener')
      expect(await screen.findByRole('button', { name: 'On' })).toBeInTheDocument()
      expect(toastMessages(toast.success)).toContain('You will be notified when creators you follow post.')
    })

    it('re-registers a live subscription the server may have forgotten', async () => {
      n.getPushState = vi.fn(async () => ({ supported: true, permission: 'granted', subscribed: true }))
      mount()
      await waitFor(() => expect(n.syncPush).toHaveBeenCalledWith('listener'))
    })

    it('turns them off again', async () => {
      n.getPushState = vi.fn(async () => ({ supported: true, permission: 'granted', subscribed: true }))
      const { user } = mount()
      await openList(user)
      await user.click(await screen.findByRole('button', { name: 'On' }))
      expect(n.disablePush).toHaveBeenCalledWith('listener')
      expect(toastMessages(toast.success)).toContain('Notifications turned off for this device')
    })

    it('shows the reason when the browser refuses', async () => {
      n.enablePush = vi.fn(async () => { throw new Error('Permission dismissed') })
      const { user } = mount()
      await openList(user)
      await user.click(await screen.findByRole('button', { name: 'Notify me' }))
      await waitFor(() => expect(toastMessages(toast.error)).toContain('Permission dismissed'))
    })

    it('cannot be switched on while the site is blocked in the browser', async () => {
      n.getPushState = vi.fn(async () => ({ supported: true, permission: 'denied', subscribed: false }))
      const { user } = mount()
      await openList(user)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Notify me' })).toBeDisabled())
      expect(screen.getByRole('button', { name: 'Notify me' })).toHaveAttribute('title', 'Notifications are blocked for this site in your browser settings.')
    })
  })

  // BUG: the list is a role="menu", but its rows are plain <li onClick> with no
  // role, no tabindex and no key handler (NotificationBell.jsx:310-313 and the
  // group row at :412-417), so a keyboard user can open the list but not one
  // notification in it, and a screen reader finds no menu items.
  it('BUG: each notification can be reached and opened from the keyboard', async () => {
    const { user } = mount()
    await openList(user)
    const items = screen.getAllByRole('menuitem')
    expect(items.length).toBeGreaterThan(0)
    items[0].focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/post/')
  })
})
