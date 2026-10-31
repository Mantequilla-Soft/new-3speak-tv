// The podcast pages render with the new feed extras (src/components/Podcasts):
// a show with a trailer, seasons, hosts and a live stream; an episode opened
// from a clip link; Mine with a live show. Rendered to a string, so no effects
// run and nothing is fetched: the query cache is filled by hand.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const state = {
  authenticated: true, user: 'alice', audioCurrent: null, audioIsPlaying: false, audioQueue: [], audioCurrentTime: 0,
  audioPlayQueued() {}, audioPlayAt() {}, audioAddToQueue() {}, audioRequestSeek() {}, audioRequestToggle() {}, audioPlay() {},
}
vi.mock('../../../src/lib/store', () => {
  const useAppStore = (sel) => sel(state)
  useAppStore.getState = () => state
  return { useAppStore }
})

const feed = {
  id: 'f1', title: 'Show', url: '', private: true, art: 'tok', subscribers: 2,
  persons: [{ name: 'Ann', role: 'host', img: 'https://x/a.jpg', href: 'https://ann' }, { name: 'Bob', role: 'guest' }],
  live: [{ id: 'L1', status: 'live', title: 'On air', url: 'https://s/l.mp3' }, { id: 'L2', status: 'pending', title: 'Soon', url: 'https://s/2.mp3', start: '2026-11-01T18:00:00Z' }],
}
const eps = [
  { id: 'f1:1', feed_id: 'f1', title: 'Trailer', audio_url: 'https://a/1.mp3', episode_type: 'trailer', published_at: '2026-10-29T00:00:00Z' },
  { id: 'f1:2', feed_id: 'f1', title: 'Two', audio_url: 'https://a/2.mp3', season: 2, episode: 14, episode_type: 'bonus', published_at: '2026-10-28T00:00:00Z', duration: 600 },
]
const ep = { ...eps[1], chapters: true, soundbites: [{ start: 10, duration: 20, title: 'Best bit' }], video: { url: 'https://v/x.mp4' }, persons: feed.persons }

async function render(path, fill) {
  const { default: PodcastsTab } = await import('../../../src/components/Podcasts/PodcastsTab.jsx')
  const qc = new QueryClient()
  fill(qc)
  return renderToString(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><PodcastsTab /></MemoryRouter></QueryClientProvider>,
  )
}

describe('podcast pages', () => {
  it('the show page pins the trailer and shows numbers, live and hosts', async () => {
    const html = await render('/audio?type=external&podcast=f1', (qc) => qc.setQueryData(['podcasts', 'feed', 'f1', '', '', '', 'alice'], { feed, episodes: eps, total: 2 }))
    expect(html).toContain('Start here')
    expect(html).toContain('S2 E14')
    expect(html).toContain('Live now')
    expect(html).toContain('Upcoming')
    expect(html).toContain('Ann')
  })
  it('the episode page offers the shared clip, highlights, chapters and the video', async () => {
    const html = await render('/audio?type=external&episode=f1%3A2&t=754&end=800', (qc) => qc.setQueryData(['podcasts', 'episode', 'f1:2', 'alice'], { episode: ep, feed }))
    expect(html).toContain('Play 12:34 to 13:20')
    expect(html).toContain('Highlights')
    expect(html).toContain('Chapters')
    expect(html).toContain('Watch video')
  })
  it('Mine marks a live show and has the smart filters', async () => {
    const html = await render('/audio?type=external&view=mine', (qc) => {
      qc.setQueryData(['podcasts', 'subs', 'alice'], [{ ...feed, added_at: '2026-10-01' }])
      qc.setQueryData(['podcasts', 'latest', 'alice'], { pages: [{ episodes: eps, feeds: { f1: feed } }], pageParams: [null] })
    })
    expect(html).toContain('LIVE')
    expect(html).toContain('In progress')
  })

  it('Discover keeps the search, link and OPML box folded behind a button', async () => {
    const html = await render('/audio?type=external&view=discover', (qc) => {
      qc.setQueryData(['podcasts', 'config'], { enabled: true, search: true })
    })
    expect(html).toContain('Add external podcast')
    expect(html).not.toContain('Podcasts from anywhere')
  })
})
