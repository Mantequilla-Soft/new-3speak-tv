// The stories row's hover card (ShortsStories + StoryCreatorCard): a mouse resting
// on an avatar turns it around, and while it turns a card shows when they last posted, name,
// reputation, bio and their counts. Touch keeps the plain tap.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const HOUR = 3600 * 1000
const NOW = Date.parse('2026-11-02T12:00:00Z')
const story = vi.hoisted(() => ({ creators: [] }))

vi.mock('../../../src/lib/stories', () => ({
  useStoryCreators: () => ({ storyCreators: story.creators, currentUserStreak: 0, isLoading: false }),
  useStoryClock: () => Date.now(),
  storyTimeLeft: () => 0.5,
  storyViewerPath: (u) => `/shorts/stories?user=${u}&story=1`,
  STREAK_MIN: 2,
}))
vi.mock('../../../src/utils/hiveNode', async (importOriginal) => ({
  ...(await importOriginal()),
  getHiveClient: () => ({
    call: async () => ({
      reputation: 72.4,
      metadata: { profile: { name: 'Badadib', about: 'Making videos about everything.' } },
      stats: { followers: 1200 },
    }),
  }),
}))
vi.mock('axios', () => {
  const get = vi.fn(async (url) => {
    if (url.endsWith('/shorts/stories')) return { data: { creators: [{ username: 'badadib-shorts', unseen_count: 1 }] } }
    if (url.includes('/counts')) return { data: { videos: 50, shorts: 14 } }
    if (url.includes('/audio?')) return { data: { total: 3 } }
    if (url.includes('/shorts/')) return { data: { shorts: [{ createdAt: new Date(NOW - 2 * 24 * HOUR).toISOString() }] } }
    return { data: {} }
  })
  const instance = () => ({
    get, post: vi.fn(async () => ({ data: {} })),
    interceptors: { request: { use() {} }, response: { use() {} } },
    defaults: { headers: { common: {} } },
  })
  const axios = { ...instance(), create: instance }
  return { default: axios, ...axios }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: ShortsStories } = await import('../../../src/components/ShortsStories/ShortsStories.jsx')

let root
let container

function hover(el, pointerType = 'mouse') {
  const ev = new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  el.dispatchEvent(ev)
}
function leave(el) {
  const ev = new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' })
  el.dispatchEvent(ev)
}
const card = () => document.body.querySelector('.story-creator-card')
const item = (u) => container.querySelector(`[data-creator="${u}"]`)
async function settle(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  story.creators = [{
    username: 'badadib', story_count: 1, unseen_count: 1,
    latest_at: new Date(NOW - 3 * HOUR).toISOString(), latest_expires_at: new Date(NOW + 21 * HOUR).toISOString(),
  }]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => {
    root.render(createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, null, createElement(ShortsStories))))
  })
  await settle()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('the creator card', () => {
  it('opens while the avatar turns, with the story time, profile and counts', async () => {
    hover(item('badadib'))
    await settle(100)
    expect(card()).toBeNull()
    await settle(100)
    const text = card()?.textContent || ''
    expect(text).toContain('Story posted 3 hours ago')
    expect(text).toContain('21h left')
    expect(text).toContain('Badadib')
    expect(text).toContain('@badadib')
    expect(text).toContain('Rep 72')
    expect(text).toContain('Making videos about everything.')
    expect(text).toMatch(/1\.2K\s*followers/)
    expect(text).toMatch(/50\s*videos/)
    expect(text).toMatch(/14\s*shorts/)
    expect(text).toMatch(/3\s*audio/)
    expect(card().querySelector('a').getAttribute('href')).toBe('/@badadib')
  })

  it('a shorts creator shows when their newest short went up', async () => {
    hover(item('badadib-shorts'))
    await settle(700)
    expect(card()?.textContent).toContain('Last short 2 days ago')
    expect(card()?.textContent).not.toContain('left')
  })

  it('closes when the pointer leaves, but stays while it is on the card', async () => {
    hover(item('badadib'))
    await settle(700)
    leave(item('badadib'))
    hover(card())
    await settle(300)
    expect(card()).not.toBeNull()
    leave(card())
    await settle(300)
    expect(card()).toBeNull()
  })

  it('touch never opens it', async () => {
    hover(item('badadib'), 'touch')
    await settle(1000)
    expect(card()).toBeNull()
  })
})
