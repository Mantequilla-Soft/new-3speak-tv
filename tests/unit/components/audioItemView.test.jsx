// One 3Speak audio on its own page (components/AudioItem/AudioItemView.jsx),
// laid out like an outside podcast episode. Rendered to a string, so no effects
// run and nothing is fetched: the query cache is filled by hand.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
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
vi.mock('../../../src/hive-api/aioha', async (orig) => ({ ...(await orig()), isLoggedIn: () => state.authenticated }))
vi.mock('../../../src/components/playVideo/BlogContent', () => ({ default: ({ permlink, description }) => <div className="blog-stub">{permlink}{description ? ` ${description}` : ''}</div> }))
// The edit dialog, tested on its own: here a button that "saves" new notes.
vi.mock('../../../src/components/AudioEdit/EditAudioModal', () => ({
  default: ({ onSaved, onClose }) => <button type="button" onClick={() => { onSaved({ title: 'T', body: 'Edited notes', json_metadata: '{}', cover: null }); onClose() }}>stub save</button>,
}))

const doc = {
  _id: 'a1', owner: 'epodcaster', permlink: 'f48l7vyi', post_permlink: 'my-show-ep-1', title: 'My Show, Episode 1',
  status: 'published', duration: 1800, plays: 12, createdAt: '2026-10-20T10:00:00Z', audio_cid: 'Qm1',
  playlist_id: 'pl-123456789', playlist_name: 'Season One',
}

async function render(path, item, playlist) {
  const { default: AudioItemView } = await import('../../../src/components/AudioItem/AudioItemView.jsx')
  const qc = new QueryClient()
  qc.setQueryData(['audio-item', 'epodcaster', 'f48l7vyi'], item)
  if (playlist) qc.setQueryData(['playlist', 'pl-123456789'], playlist)
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

  it('the creator gets Edit where everyone else gets Tip', async () => {
    Object.assign(state, { authenticated: true, user: 'epodcaster' })
    try {
      const own = await render('/audio?play=epodcaster/f48l7vyi', doc)
      expect(own).toContain('Edit')
      expect(own).not.toContain('Tip')
      state.user = 'someoneelse'
      const other = await render('/audio?play=epodcaster/f48l7vyi', doc)
      expect(other).toContain('Tip')
      expect(other).not.toMatch(/>Edit</)
    } finally {
      Object.assign(state, { authenticated: false, user: '' })
    }
  })

  it('offers the shared clip on the Play button', async () => {
    const html = await render('/audio?play=epodcaster/f48l7vyi&t=754&end=800', doc)
    expect(html).toContain('Play 12:34 to 13:20')
  })

  it('says Play episode for a podcast and Play track in a music playlist', async () => {
    expect(await render('/audio?play=epodcaster/f48l7vyi', doc)).toContain('Play episode')
    const music = { type: 'audio', audio_kind: 'music', json_metadata: '{"type":"audio","audio_kind":"music"}' }
    const html = await render('/audio?play=epodcaster/f48l7vyi', { ...doc, category: 'voice_message' }, music)
    expect(html).toContain('Play track')
    expect(html).not.toContain('Play episode')
    // No kind saved on the playlist: the track's own category decides.
    expect(await render('/audio?play=epodcaster/f48l7vyi', { ...doc, category: 'song' }, { type: 'video' })).toContain('Play track')
    const podcast = { type: 'audio', audio_kind: 'podcast' }
    expect(await render('/audio?play=epodcaster/f48l7vyi', { ...doc, category: 'song' }, podcast)).toContain('Play episode')
  })

  it('notes just saved show on that audio only, not on the next one the page opens', async () => {
    const { default: AudioItemView } = await import('../../../src/components/AudioItem/AudioItemView.jsx')
    const qc = new QueryClient()
    qc.setQueryData(['audio-item', 'epodcaster', 'f48l7vyi'], doc)
    qc.setQueryData(['audio-item', 'epodcaster', 'g2'], { ...doc, _id: 'a2', permlink: 'g2', post_permlink: 'my-show-ep-2' })
    qc.setQueryData(['audio-item-post', 'epodcaster', 'my-show-ep-1'], { active_votes: [], children: 0 })
    qc.setQueryData(['audio-item-post', 'epodcaster', 'my-show-ep-2'], { active_votes: [], children: 0 })
    const view = (id) => (
      <QueryClientProvider client={qc}><MemoryRouter><AudioItemView owner="epodcaster" id={id} onBack={() => {}} /></MemoryRouter></QueryClientProvider>
    )
    Object.assign(state, { authenticated: true, user: 'epodcaster' })
    try {
      const { container, rerender, unmount } = rtlRender(view('f48l7vyi'))
      fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'stub save' }))
      expect(container.querySelector('.blog-stub').textContent).toBe('my-show-ep-1 Edited notes')
      // The same mounted view, now on another audio (a link from the player).
      rerender(view('g2'))
      expect(container.querySelector('.blog-stub').textContent).toBe('my-show-ep-2')
      unmount()
    } finally {
      Object.assign(state, { authenticated: false, user: '' })
    }
  })

  it('says so when the audio is gone', async () => {
    const html = await render('/audio?play=epodcaster/f48l7vyi', null)
    expect(html).toContain('This audio is not available.')
  })
})
