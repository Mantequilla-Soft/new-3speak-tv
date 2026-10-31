// Following an all-audio playlist like a podcast (components/Podcasts/
// PlaylistFollowButton.jsx): by its RSS feed on 3speak.tv, recognised among the
// listener's followed shows by the feed's key.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import PlaylistFollowButton, { playlistFeedUrl } from '../../../src/components/Podcasts/PlaylistFollowButton.jsx'

const ID = '2ec5acd3-0230-4221-b341-6635ffb974f4'

function render(subs) {
  const qc = new QueryClient()
  qc.setQueryData(['podcasts', 'subs', 'alice'], subs)
  return renderToString(
    <QueryClientProvider client={qc}><MemoryRouter><PlaylistFollowButton playlistId={ID} name="Daily Voice" user="alice" /></MemoryRouter></QueryClientProvider>,
  )
}

describe('following a playlist as a podcast', () => {
  it('follows the playlist feed on 3speak.tv', () => {
    expect(playlistFeedUrl(ID)).toBe(`https://3speak.tv/rss/playlist/${ID}.xml`)
  })

  it('offers Follow when the feed is not followed yet', () => {
    const html = render([{ id: 'f1', url: 'https://podnews.net/rss' }])
    expect(html).toContain('Follow')
    expect(html).not.toContain('Open podcast')
  })

  it('shows Following and a way to the show once followed, however the URL was written', () => {
    const html = render([{ id: 'f2', url: `http://www.3speak.tv/rss/playlist/${ID}.xml/` }])
    expect(html).toContain('Following')
    expect(html).toContain('Open podcast')
  })
})
