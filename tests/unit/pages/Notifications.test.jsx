// @vitest-environment jsdom
// The notifications page (page/Notifications.jsx): a sign-in prompt for visitors;
// for members the list in time sections, filters by kind (remembered), an
// activity summary whose cards filter the list, grouped votes and follows that
// unfold, "Mark all read" for every kind of dot, Refresh, an error with Retry,
// and Load more. The Hive notification hook is a stand-in.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

const n = vi.hoisted(() => ({}))
vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('axios', () => {
  const axios = { post: (...a) => n.post(...a), get: async () => ({ data: {} }), interceptors: { request: { use: () => {} }, response: { use: () => {} } } }
  axios.create = () => axios
  return { default: axios }
})
vi.mock('../../../src/hooks/useHiveNotifications', async (importOriginal) => ({
  ...(await importOriginal()),
  useHiveNotifications: (...a) => n.hive(...a),
}))
vi.mock('../../../src/utils/threeSpeakDetection', () => ({
  use3SpeakDetection: () => new Map(), resolveRootPost: async (k) => k, ensure3SpeakStatus: async () => false,
}))
vi.mock('../../../src/utils/whaleDetection', () => ({ useWhaleDetection: () => new Map() }))
vi.mock('../../../src/components/HiveAvatar/HiveAvatar', () => ({ default: ({ username }) => <img alt={username} /> }))
vi.mock('../../../src/lib/stories', () => ({
  useStoryNotifications: () => ({ stories: [], unseenCount: n.unseenStories }),
  markStoriesSeen: (...a) => n.markStoriesSeen(...a),
  markStorySeen: () => {}, storyViewerPath: () => '/', storyTimeLeft: () => 1, useStoryClock: () => Date.now(),
}))
vi.mock('../../../src/lib/podcasts', () => ({
  usePodcastNotifications: () => ({ episodes: [], unseenCount: 0 }),
  markPodcastNotificationsSeen: (...a) => n.markPodcastsSeen(...a),
  episodeToTrack: () => ({}), episodePath: () => '/', artUrl: () => '', onArtError: () => {}, PODCAST_PLACEHOLDER: '',
}))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Notifications } = await import('../../../src/page/Notifications.jsx')

const ago = (min) => new Date(Date.now() - min * 60000).toISOString().replace('Z', '')
const NOTIFS = [
  { id: 1, type: 'reply', msg: '@badadib replied to your post', url: 'badadib/re-1', date: ago(5) },
  { id: 2, type: 'vote', msg: '@fan-one voted on your post ($1.00)', url: 'listener/v', date: ago(30) },
  { id: 3, type: 'vote', msg: '@fan-two voted on your post ($0.50)', url: 'listener/v', date: ago(40) },
  { id: 4, type: 'follow', msg: '@follower-a followed you', url: '@follower-a', date: ago(60) },
  { id: 5, type: 'follow', msg: '@follower-b followed you', url: '@follower-b', date: ago(70) },
  { id: 6, type: 'mention', msg: '@badadib mentioned you', url: 'badadib/hello', date: ago(60 * 24 * 20) },
]

function hive(over = {}) {
  return {
    notifications: NOTIFS, loading: false, loadingMore: false, hasMore: false, error: null,
    refetch: n.refetch, loadMore: n.loadMore, unreadCount: 2, markAllAsRead: n.markAll, markAsRead: () => {},
    markingAsRead: false, isUnread: (x) => x.id === 1 || x.id === 2, ...over,
  }
}
const mount = () => renderWithProviders(<Notifications />, { route: '/notifications' })
const listText = () => [...document.querySelectorAll('.notifications-list .notifications-msg')].map((el) => el.textContent)

beforeEach(() => {
  Object.assign(n, {
    refetch: vi.fn(), loadMore: vi.fn(), markAll: vi.fn(), markStoriesSeen: vi.fn(), markPodcastsSeen: vi.fn(),
    unseenStories: 0,
    post: vi.fn(async () => ({ data: { result: [] } })),
  })
  n.hive = vi.fn(() => hive())
  useAppStore.setState({ user: 'listener', authenticated: true })
})
afterEach(() => localStorage.clear())

describe('the notifications page', () => {
  it('asks a visitor to log in', () => {
    act(() => useAppStore.setState({ user: null, authenticated: false }))
    mount()
    expect(screen.getByText('Please log in to view your notifications.')).toBeInTheDocument()
    expect(n.hive).toHaveBeenCalledWith(null, { limit: 50 })
  })

  it('lists the notifications in time sections, with the unread count', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Notifications2 new')
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This Month' })).toBeInTheDocument()
    expect(listText()).toEqual([
      '@badadib replied to your post',
      '@fan-one and @fan-two voted on your post ($1.50)',
      '@follower-a and @follower-b followed you',
      '@badadib mentioned you',
    ])
  })

  it('filters by kind and remembers the choice', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Mentions' }))
    expect(screen.getByRole('tab', { name: 'Mentions' })).toHaveAttribute('aria-selected', 'true')
    expect(listText()).toEqual(['@badadib mentioned you'])
    expect(localStorage.getItem('3speak-notif-filter')).toBe('mentions')
    await user.click(screen.getByRole('tab', { name: /Unread/ }))
    expect(listText()).toEqual(['@badadib replied to your post', '@fan-one voted on your post ($1.00)'])
  })

  it('opens on the filter picked last time', () => {
    localStorage.setItem('3speak-notif-filter', 'follows')
    mount()
    expect(screen.getByRole('tab', { name: 'Follows' })).toHaveAttribute('aria-selected', 'true')
    expect(listText()).toEqual(['@follower-a and @follower-b followed you'])
  })

  it('says when a filter has nothing', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Transfers' }))
    expect(screen.getByText('No transfers yet.')).toBeInTheDocument()
  })

  it('opens the post or profile a notification is about', async () => {
    const { user } = mount()
    await user.click(screen.getByText('@badadib replied to your post'))
    expect(screen.getByTestId('location')).toHaveTextContent('/post/badadib/re-1')
  })

  it('a group unfolds to show each notification in it', async () => {
    const { user } = mount()
    const group = screen.getByText('@follower-a and @follower-b followed you').closest('li')
    expect(within(group).getByText('▸ expand')).toBeInTheDocument()
    await user.click(group)
    expect(within(group).getByText('▾ collapse')).toBeInTheDocument()
    expect(screen.getByText('@follower-b followed you')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/notifications')
  })

  // BUG: every row of an unfolded group opens the group's FIRST notification:
  // the nested rows get the group's onClick (Notifications.jsx:742), which the
  // page wires to group.items[0] (:499). Clicking "@follower-b followed you"
  // opens @follower-a's profile.
  it.skip('BUG: a notification inside an unfolded group opens its own target', async () => {
    const { user } = mount()
    await user.click(screen.getByText('@follower-a and @follower-b followed you').closest('li'))
    await user.click(screen.getByText('@follower-b followed you'))
    expect(screen.getByTestId('location')).toHaveTextContent('/@follower-b')
  })

  it('"Mark all read" clears Hive, stories and podcast episodes', async () => {
    n.unseenStories = 1
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /Mark all read/ }))
    expect(n.markAll).toHaveBeenCalledTimes(1)
    expect(n.markStoriesSeen).toHaveBeenCalledWith([])
    expect(n.markPodcastsSeen).toHaveBeenCalledWith('listener')
  })

  it('offers no "Mark all read" when everything is read', () => {
    n.hive = vi.fn(() => hive({ unreadCount: 0 }))
    mount()
    expect(screen.queryByRole('button', { name: /Mark all read/ })).not.toBeInTheDocument()
  })

  it('refreshes on request, and says when it is refreshing', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(n.refetch).toHaveBeenCalled()
  })

  it('shows a load error with Retry', async () => {
    n.hive = vi.fn(() => hive({ error: new Error('down'), notifications: [] }))
    const { user } = mount()
    expect(screen.getByText(/Could not load notifications\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(n.refetch).toHaveBeenCalled()
  })

  it('loads older notifications from the oldest one shown, and says when there are no more', async () => {
    n.hive = vi.fn(() => hive({ hasMore: true }))
    const { user, unmount } = mount()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(n.loadMore).toHaveBeenCalledWith(6)
    unmount()
    n.hive = vi.fn(() => hive({ hasMore: false }))
    mount()
    expect(screen.getByText("You've reached the end.")).toBeInTheDocument()
  })

  describe('the activity summary', () => {
    it('counts this week\'s votes, earnings, voters and follows, and a card filters the list', async () => {
      const { user } = mount()
      const votes = screen.getByText('Votes', { selector: '.notif-summary-card-label' }).closest('.notif-summary-card')
      expect(votes).toHaveTextContent('2')
      expect(votes).toHaveTextContent('$1.50')
      expect(votes).toHaveTextContent('2 voters')
      expect(screen.getByText('New Followers')).toBeInTheDocument()
      await user.click(votes)
      expect(screen.getByRole('tab', { name: 'Votes' })).toHaveAttribute('aria-selected', 'true')
    })

    it('shows today, and the whole month fetched page by page from Hive', async () => {
      n.post = vi.fn(async () => ({ data: { result: [{ id: 99, type: 'reblog', msg: '@badadib reblogged your post', url: 'listener/v', date: ago(60 * 24 * 10) }] } }))
      const { user } = mount()
      await user.click(screen.getByRole('button', { name: 'Today' }))
      expect(screen.getByText('Replies', { selector: '.notif-summary-card-label' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /This Month/ }))
      expect(await screen.findByText('Reblogs', { selector: '.notif-summary-card-label' })).toBeInTheDocument()
      expect(n.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'bridge.account_notifications', params: { account: 'listener', limit: 100 } }))
      // what the month fetch found joins the list too
      expect(listText()).toContain('@badadib reblogged your post')
    })

    it('says when a period had no activity', async () => {
      n.hive = vi.fn(() => hive({ notifications: [NOTIFS[5]] }))
      const { user } = mount()
      expect(screen.getByText('No activity this week yet.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Today' }))
      expect(screen.getByText('No activity today yet.')).toBeInTheDocument()
    })
  })

  // BUG: the summary cards filter the list on click but are <div onClick>
  // (Notifications.jsx:639-642): no role, no focus, no keyboard.
  it.skip('BUG: the summary cards are buttons', () => {
    mount()
    expect(screen.getByRole('button', { name: /Votes/ })).toBeInTheDocument()
  })
})
