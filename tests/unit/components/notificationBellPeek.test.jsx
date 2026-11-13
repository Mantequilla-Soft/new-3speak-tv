// The notifications bell (components/nav/NotificationBell.jsx): a mouse resting on
// the bell shows the list (fading in) and leaving fades it out again; a click on
// the bell keeps it open. A peek does not mark new podcast episodes as seen.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const podcasts = vi.hoisted(() => ({ markSeen: null }))
vi.mock('../../../src/lib/store', () => {
  const state = { user: 'badadib', authenticated: true, audioPlayQueued: () => {} }
  const useAppStore = (sel) => (sel ? sel(state) : state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('../../../src/utils/webPush', () => ({
  pushSupported: () => false, getPushState: async () => ({}), enablePush: async () => {}, disablePush: async () => {}, syncPushSubscription: () => {},
}))
vi.mock('../../../src/hooks/useHiveNotifications', () => ({
  useHiveNotifications: () => ({ notifications: [], loading: false, unreadCount: 0, isUnread: () => false, markAllAsRead: () => {} }),
}))
vi.mock('../../../src/utils/threeSpeakDetection', () => ({
  use3SpeakDetection: () => new Map(), resolveRootPost: async (k) => k, ensure3SpeakStatus: async () => false,
}))
vi.mock('../../../src/utils/whaleDetection', () => ({ useWhaleDetection: () => new Map() }))
vi.mock('../../../src/lib/stories', () => ({
  useStoryNotifications: () => ({ stories: [], unseenCount: 0 }),
  markStorySeen: () => {}, storyViewerPath: () => '/', storyTimeLeft: () => 1, useStoryClock: () => Date.now(),
}))
vi.mock('../../../src/lib/podcasts', () => ({
  usePodcastNotifications: () => ({
    episodes: [{ id: 'ep1', title: 'Episode one', seen: false, first_seen_at: new Date().toISOString(), feed: { title: 'A show' } }],
    unseenCount: 1,
  }),
  markPodcastNotificationsSeen: (...a) => podcasts.markSeen(...a),
  episodeToTrack: () => ({}), episodePath: () => '/', artUrl: () => '', onArtError: () => {}, PODCAST_PLACEHOLDER: '',
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: NotificationBell } = await import('../../../src/components/nav/NotificationBell.jsx')

let root
let container
const wrapper = () => container.querySelector('.notif-bell-wrapper')
const bell = () => container.querySelector('.notif-bell-btn')
// The sheet is portalled to <body> (the bar's blur would otherwise contain it).
const list = () => document.querySelector('.notif-dropdown')
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function pointer(type, el, pointerType = 'mouse') {
  const ev = new MouseEvent(type, { bubbles: true, relatedTarget: document.body })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  act(() => { el.dispatchEvent(ev) })
}
const enter = (pt) => pointer('pointerover', wrapper(), pt)
const leave = () => pointer('pointerout', wrapper())
const click = () => act(() => { bell().click() })

beforeEach(() => {
  vi.useFakeTimers()
  podcasts.markSeen = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(MemoryRouter, null, createElement(NotificationBell))))
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

describe('notifications bell on hover', () => {
  it('a mouse resting on the bell shows the list, leaving fades it out', async () => {
    enter()
    await advance(100)
    expect(list()).toBeNull()
    await advance(150)
    expect(list()).not.toBeNull()
    expect(list().className).not.toContain('--leaving')
    leave()
    await advance(160)
    expect(list().className).toContain('notif-dropdown--leaving')
    await advance(250)
    expect(list()).toBeNull()
  })

  it('a peek does not mark new podcast episodes as seen', async () => {
    enter()
    await advance(250)
    leave()
    await advance(500)
    expect(list()).toBeNull()
    expect(podcasts.markSeen).not.toHaveBeenCalled()
  })

  it('a click keeps it open after the mouse leaves; closing it then marks them seen', async () => {
    enter()
    await advance(250)
    click()
    leave()
    await advance(1000)
    expect(list()).not.toBeNull()
    expect(list().className).not.toContain('--leaving')
    click()
    await advance(250)
    expect(list()).toBeNull()
    expect(podcasts.markSeen).toHaveBeenCalledWith('badadib')
  })

  it('after a click closed it, the mouse still on the bell does not reopen it', async () => {
    click()
    click()
    enter()
    await advance(1000)
    expect(list()).toBeNull()
  })

  it('touch never peeks', async () => {
    enter('touch')
    await advance(1000)
    expect(list()).toBeNull()
  })

  it('coming back while it fades keeps it', async () => {
    enter()
    await advance(250)
    leave()
    await advance(160)
    expect(list().className).toContain('--leaving')
    enter()
    expect(list().className).not.toContain('--leaving')
    await advance(1000)
    expect(list()).not.toBeNull()
  })
})
