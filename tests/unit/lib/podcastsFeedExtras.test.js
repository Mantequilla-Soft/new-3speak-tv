// Feed extras in src/lib/podcasts.js: the new track fields, live streams as
// tracks, private feeds (the login in the link, the follow flag, the session
// vouch on reads) and OPML leaving private feeds out.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import {
  episodeToTrack, liveToTrack, buildPrivateFeedUrl, episodeNumberLabel, followFeeds, fetchEpisode, downloadOpml, privateAudioUrl,
} from '../../../src/lib/podcasts.js'

const NOW_TS = Date.now()
const feed = { id: 'f1', title: 'Show', art: 'tok', image: 'https://cdn/c.jpg', url: 'https://feed', link: 'https://show' }

describe('episodeToTrack', () => {
  it('copies the Podcasting 2.0 fields when the episode has them', () => {
    const ep = {
      id: 'f1:1', feed_id: 'f1', title: 'Ep', audio_url: 'https://cdn/x.mp3', duration: 60,
      season: 2, episode: 14, episode_type: 'bonus', chapters: true, transcripts: [{ lang: 'en', type: 'text/vtt' }],
      persons: [{ name: 'Ann', role: 'host', group: 'cast' }], soundbites: [{ start: 10, duration: 20 }],
      video: { url: 'https://cdn/x.mp4', mime: 'video/mp4' }, private: true,
    }
    expect(episodeToTrack(ep, feed)).toMatchObject({
      _id: 'f1:1', external: true, season: 2, episode: 14, episode_type: 'bonus', chapters: true,
      transcripts: ep.transcripts, persons: ep.persons, soundbites: ep.soundbites, video: ep.video, private: true,
    })
  })

  it('leaves them out when absent, and marks episodes of a private show', () => {
    const track = episodeToTrack({ id: 'f1:2', feed_id: 'f1', audio_url: 'https://cdn/y.mp3' }, feed)
    for (const k of ['season', 'episode', 'episode_type', 'chapters', 'transcripts', 'persons', 'soundbites', 'video', 'private']) {
      expect(track).not.toHaveProperty(k)
    }
    expect(episodeToTrack({ id: 'f1:3', feed_id: 'f1' }, { ...feed, private: true }).private).toBe(true)
  })
})

describe('liveToTrack', () => {
  it('builds a live track per the contract', () => {
    const track = liveToTrack({ id: 'L9', title: 'On air', status: 'live', url: 'https://stream/live.mp3', mime: 'audio/mpeg' }, feed)
    expect(track).toMatchObject({
      _id: 'live:f1:L9', external: true, live: true, duration: 0, src: 'https://stream/live.mp3',
      title: 'On air', show: 'Show', show_id: 'f1', art: 'tok', link: 'https://show',
    })
  })
})

describe('episodeNumberLabel', () => {
  it('shows season and episode', () => {
    expect(episodeNumberLabel({ season: 2, episode: 14 })).toBe('S2 E14')
    expect(episodeNumberLabel({ episode: 3 })).toBe('E3')
    expect(episodeNumberLabel({ season: 1 })).toBe('S1')
    expect(episodeNumberLabel({})).toBe('')
    expect(episodeNumberLabel({ season: 1.5, episode: 2 })).toBe('S1.5 E2')
  })
})

describe('buildPrivateFeedUrl', () => {
  it('puts the login into the link, URL-encoded', () => {
    expect(buildPrivateFeedUrl('https://host.example/feed.xml?x=1', 'me@mail.com', 'p:a/s s'))
      .toBe('https://me%40mail.com:p%3Aa%2Fs%20s@host.example/feed.xml?x=1')
  })

  it('replaces a login already in the link', () => {
    expect(buildPrivateFeedUrl('https://old:pw@host.example/f', 'new', 'x')).toBe('https://new:x@host.example/f')
  })

  it('leaves the link alone without a username, or when it is not a web link', () => {
    expect(buildPrivateFeedUrl(' https://host.example/f?token=abc ', '', '')).toBe('https://host.example/f?token=abc')
    expect(buildPrivateFeedUrl('ftp://host/f', 'a', 'b')).toBe('ftp://host/f')
    expect(buildPrivateFeedUrl('nope', 'a', 'b')).toBe('nope')
  })
})

/** fetch that answers our API's vouch (for `user`, or a refusal) and records the rest. */
function stubFetch({ user, refuse = false }) {
  const calls = []
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    if (String(url).endsWith('/podcasts/signature')) {
      if (refuse) return new Response('{}', { status: 401 })
      return Response.json({ signature: 'SIG', timestamp: NOW_TS, username: user })
    }
    if (String(url).endsWith('/subscribe')) return Response.json({ results: [{ ok: true, feed_id: 'f9' }] })
    return Response.json({ episode: { id: 'e' }, feed: {} })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

describe('private feeds', () => {
  it('follow sends private aligned with the urls', async () => {
    const calls = stubFetch({ user: 'alice' })
    await followFeeds('alice', ['https://a:b@host/f', '  ', 'https://open/f'], ['A', '', 'B'], [true, false, false])
    const body = JSON.parse(calls.find((c) => c.url.endsWith('/subscribe')).opts.body)
    expect(body.urls).toEqual(['https://a:b@host/f', 'https://open/f'])
    expect(body.titles).toEqual(['A', 'B'])
    expect(body.private).toEqual([true, false])
  })

  it('a plain follow sends no private flag', async () => {
    const calls = stubFetch({ user: 'alice' })
    await followFeeds('alice', ['https://open/f'])
    const body = JSON.parse(calls.find((c) => c.url.endsWith('/subscribe')).opts.body)
    expect(body).not.toHaveProperty('private')
  })

  it('a signed-in read carries the session vouch', async () => {
    const calls = stubFetch({ user: 'carol' })
    await fetchEpisode('f1:1', 'carol')
    const read = calls.find((c) => c.url.includes('/episode/'))
    const qs = new URL(read.url).searchParams
    expect(qs.get('vu')).toBe('carol')
    expect(qs.get('vts')).toBe(String(NOW_TS))
    expect(qs.get('vsig')).toBe('SIG')
    // The vouch is reused for the next read.
    await fetchEpisode('f1:2', 'carol')
    expect(calls.filter((c) => c.url.endsWith('/podcasts/signature'))).toHaveLength(1)
  })

  it('a read never waits on a vouch that fails, and does not ask again at once', async () => {
    const calls = stubFetch({ user: 'dave', refuse: true })
    await fetchEpisode('f1:1', 'dave')
    await fetchEpisode('f1:2', 'dave')
    const reads = calls.filter((c) => c.url.includes('/episode/'))
    expect(reads).toHaveLength(2)
    expect(reads[0].url).not.toContain('vu=')
    expect(calls.filter((c) => c.url.endsWith('/podcasts/signature'))).toHaveLength(1)
  })

  it('a private episode plays through the checker with the vouch', async () => {
    stubFetch({ user: 'erin' })
    const url = await privateAudioUrl('f1:9', 'erin')
    expect(url).toMatch(/\/podcasts\/episode\/f1%3A9\/download\?vu=erin&vts=\d+&vsig=SIG$/)
    // Without a name, the listener the last vouch was for.
    expect(await privateAudioUrl('f1:9')).toBe(url)
  })

  it('a signed-out read asks for no vouch', async () => {
    const calls = stubFetch({ user: 'x' })
    await fetchEpisode('f1:1', null)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).not.toContain('vu=')
  })

  it('OPML export leaves private feeds out and says how many', () => {
    const created = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b) => { created.push(b); return 'blob:x' }, revokeObjectURL: () => {} }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(downloadOpml([{ url: 'https://a/f', title: 'A' }, { url: '', title: 'P', private: true }], 'alice')).toBe(1)
    expect(created).toHaveLength(1)
    expect(downloadOpml([{ url: '', title: 'P', private: true }], 'alice')).toBe(1)
    expect(created).toHaveLength(1)
  })
})
