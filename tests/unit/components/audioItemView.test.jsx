// One 3Speak audio on its own page (components/AudioItem/AudioItemView.jsx),
// laid out like an outside podcast episode. Rendered to a string, so no effects
// run and nothing is fetched: the query cache is filled by hand.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const state = {
  authenticated: false, user: '', audioCurrent: null, audioIsPlaying: false, audioQueue: [], audioCurrentTime: 0,
  audioPlay() {}, audioPlayAt() {}, audioAddToQueue() {}, audioRequestToggle() {},
}
vi.mock('../../../src/lib/store', () => {
  const useAppStore = (sel) => sel(state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('../../../src/components/playVideo/BlogContent', () => ({ default: ({ permlink }) => <div className="blog-stub">{permlink}</div> }))

const doc = {
  _id: 'a1', owner: 'epodcaster', permlink: 'f48l7vyi', post_permlink: 'my-show-ep-1', title: 'My Show, Episode 1',
  status: 'published', duration: 1800, plays: 12, createdAt: '2026-10-20T10:00:00Z', audio_cid: 'Qm1',
  playlist_id: 'pl-123456789', playlist_name: 'Season One',
}

async function render(path, item) {
  const { default: AudioItemView } = await import('../../../src/components/AudioItem/AudioItemView.jsx')
  const qc = new QueryClient()
  qc.setQueryData(['audio-item', 'epodcaster', 'f48l7vyi'], item)
  qc.setQueryData(['audio-item-post', 'epodcaster', 'my-show-ep-1'], { active_votes: [{ voter: 'a' }, { voter: 'b' }], children: 3, pending_payout_value: '1.234 HBD' })
  return renderToString(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><AudioItemView owner="epodcaster" id="f48l7vyi" onBack={() => {}} /></MemoryRouter></QueryClientProvider>,
  )
}

describe('a 3Speak audio page', () => {
  it('shows the creator, title, actions and the description from the Hive post', async () => {
    const html = await render('/audio?play=epodcaster/f48l7vyi', doc)
    expect(html).toContain('All audio')
    expect(html).toMatch(/@(<!-- -->)?epodcaster/)
    expect(html).toContain('My Show, Episode 1')
    expect(html).toContain('From Season One')
    expect(html).toContain('Add to queue')
    expect(html).toContain('Copy link')
    expect(html).toContain('Comments')
    // Vote, with the post's two votes; its three comments.
    expect(html).toContain('Vote<span class="pod-btn-count">2</span>')
    expect(html).toContain('<span class="pod-btn-count">3</span>')
    expect(html).toContain('Description')
    expect(html).toContain('my-show-ep-1')
  })

  it('offers the shared clip on the Play button', async () => {
    const html = await render('/audio?play=epodcaster/f48l7vyi&t=754&end=800', doc)
    expect(html).toContain('Play 12:34 to 13:20')
  })

  it('says so when the audio is gone', async () => {
    const html = await render('/audio?play=epodcaster/f48l7vyi', null)
    expect(html).toContain('This audio is not available.')
  })
})
