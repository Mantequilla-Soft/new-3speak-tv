// @vitest-environment jsdom
// Outside podcast feeds, the API side (src/lib/podcasts.js): signing follow,
// unfollow and notify changes (our API's vouch first, the wallet second), reads
// that carry the session vouch for private feeds, the query hooks, the bell,
// cover art, live tracks, the stand-in waveform and the OPML download. Splits,
// OPML parsing and episode tracks are in podcasts.test.js. fetch, signing and
// React Query are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  sign: vi.fn(), provider: vi.fn(), mante: vi.fn(), sessionVouch: vi.fn(), lastUser: vi.fn(),
  queryData: undefined, invalidate: vi.fn(),
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  signMessageWithAioha: h.sign,
  getCurrentProvider: h.provider,
  isManteAuthLogin: h.mante,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))
vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: h.sessionVouch, lastVouchUser: h.lastUser }))
// The hooks hand their options back, so each queryFn can be run directly.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts) => { h.lastQuery = opts; return { opts, data: h.queryData } },
  useInfiniteQuery: (opts) => ({ opts }),
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}))

import * as P from '../../../src/lib/podcasts.js'

const API = 'https://checker.example/podcasts'
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const VOUCH = { username: 'alice', signature: 'API-SIG', timestamp: 111 }

let fetchMock
let routes
beforeEach(() => {
  localStorage.clear()
  routes = {}
  fetchMock = vi.fn(async (url) => {
    const r = routes[url.split('?')[0]] ?? routes[url]
    if (r instanceof Error) throw r
    return r ?? reply(200, {})
  })
  vi.stubGlobal('fetch', fetchMock)
  h.sign.mockReset().mockResolvedValue({ success: true, result: 'WALLET-SIG' })
  h.provider.mockReset().mockReturnValue('keychain')
  h.mante.mockReset().mockReturnValue(false)
  h.sessionVouch.mockReset().mockResolvedValue({ signature: 'S', timestamp: 5 })
  h.lastUser.mockReset().mockReturnValue('alice')
  h.queryData = undefined
})

const bodyOf = (url) => JSON.parse(fetchMock.mock.calls.find((c) => c[0] === url)[1].body)
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('signed changes', () => {
  it('follows feeds with our API\'s vouch over a hash of the URL list', async () => {
    routes['/api/podcasts/signature'] = reply(200, VOUCH)
    routes[`${API}/subscribe`] = reply(200, { results: [{ url: 'https://a.example/rss', ok: true, feed_id: 'f1' }] })
    const results = await P.followFeeds('alice', [' https://a.example/rss ', '', 'https://b.example/rss'], ['A', '', 'B'])
    expect(results).toEqual([{ url: 'https://a.example/rss', ok: true, feed_id: 'f1' }])
    const hash = await sha256('https://a.example/rss\nhttps://b.example/rss')
    expect(bodyOf('/api/podcasts/signature')).toEqual({ action: 'subscribe', payload: hash })
    expect(bodyOf(`${API}/subscribe`)).toEqual({
      user: 'alice', urls: ['https://a.example/rss', 'https://b.example/rss'], titles: ['A', 'B'], signature: 'API-SIG', timestamp: 111,
    })
    expect(h.sign).not.toHaveBeenCalled()
  })

  it('marks private feeds, and sends no titles when none were given', async () => {
    routes['/api/podcasts/signature'] = reply(200, VOUCH)
    routes[`${API}/subscribe`] = reply(200, {})
    expect(await P.followFeeds('alice', ['https://a/rss', 'https://b/rss'], [], [false, true])).toEqual([])
    expect(bodyOf(`${API}/subscribe`)).toMatchObject({ titles: [], private: [false, true] })
  })

  it('a wallet that can sign does it itself when the API cannot vouch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1700000000000)
    routes['/api/podcasts/signature'] = reply(401, {})
    await P.unfollowFeed('alice', 'f1')
    expect(h.sign).toHaveBeenCalledWith('3speak-podcasts|unsubscribe|alice|f1|1700000000000', 'posting', 'audio.podcasts.walletPrompt')
    expect(bodyOf(`${API}/unsubscribe`)).toEqual({ user: 'alice', feed_id: 'f1', signature: 'WALLET-SIG', timestamp: 1700000000000 })
    vi.useRealTimers()
  })

  it('never uses a vouch for a different account', async () => {
    routes['/api/podcasts/signature'] = reply(200, { ...VOUCH, username: 'mallory' })
    await P.setFeedNotify('alice', 'f1', true)
    expect(h.sign.mock.calls[0][0]).toMatch(/^3speak-podcasts\|notify\|alice\|f1:on\|/)
    expect(bodyOf(`${API}/notify`)).toMatchObject({ notify: true, signature: 'WALLET-SIG' })
  })

  it('HiveSigner sends its token; without a vouch it cannot sign locally', async () => {
    h.provider.mockReturnValue('hivesigner')
    localStorage.setItem('hivesignerToken', 'TOK')
    routes['/api/podcasts/signature'] = new TypeError('offline')
    await expect(P.setFeedNotify('alice', 'f1', false)).rejects.toThrow('audio.podcasts.errors.signIn')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer TOK')
  })

  it('Butter Auth without a vouch cannot sign locally either', async () => {
    h.mante.mockReturnValue(true)
    routes['/api/podcasts/signature'] = reply(500, {})
    await expect(P.unfollowFeed('alice', 'f1')).rejects.toThrow('audio.podcasts.errors.signIn')
  })

  it('reports a wallet that refused to sign', async () => {
    routes['/api/podcasts/signature'] = reply(401, {})
    h.sign.mockResolvedValue({ success: false })
    await expect(P.unfollowFeed('alice', 'f1')).rejects.toThrow('audio.podcasts.errors.signFailed')
  })

  it('passes a checker error on with its status, unless it carries per-URL results', async () => {
    routes['/api/podcasts/signature'] = reply(200, VOUCH)
    routes[`${API}/unsubscribe`] = reply(403, { error: 'bad_signature' })
    await expect(P.unfollowFeed('alice', 'f1')).rejects.toMatchObject({ message: 'bad_signature', status: 403 })
    routes[`${API}/subscribe`] = reply(400, { results: [{ ok: false, code: 'limit' }] })
    expect(await P.followFeeds('alice', ['https://a/rss'])).toEqual([{ ok: false, code: 'limit' }])
    routes[`${API}/notify`] = { ok: false, status: 502, json: async () => { throw new Error('html') } }
    await expect(P.setFeedNotify('alice', 'f1', true)).rejects.toThrow('HTTP 502')
  })
})

describe('outside shows in a playlist', () => {
  it('checks a show with a vouch over the hash of its one URL, without following it', async () => {
    routes['/api/podcasts/signature'] = reply(200, VOUCH)
    routes[`${API}/resolve`] = reply(200, { success: true, feed: { id: 'f1', url: 'https://a.example/rss' } })
    expect(await P.resolveFeed('alice', ' https://a.example/rss ')).toEqual({ success: true, feed: { id: 'f1', url: 'https://a.example/rss' } })
    expect(bodyOf('/api/podcasts/signature')).toEqual({ action: 'resolve', payload: await sha256('https://a.example/rss') })
    expect(bodyOf(`${API}/resolve`)).toEqual({ user: 'alice', url: 'https://a.example/rss', signature: 'API-SIG', timestamp: 111 })
    expect(fetchMock.mock.calls.some((c) => c[0] === `${API}/subscribe`)).toBe(false)
  })

  it('reads a playlist\'s shows unsigned, with the cursor only when there is one', async () => {
    routes[`${API}/bundle`] = reply(200, { feeds: [], episodes: [] })
    await P.fetchPlaylistBundle(['https://a/rss'])
    expect(bodyOf(`${API}/bundle`)).toEqual({ urls: ['https://a/rss'] })
    fetchMock.mockClear()
    await P.fetchPlaylistBundle(['https://a/rss'], '2026-11-01T00:00:00.000Z|x')
    expect(bodyOf(`${API}/bundle`)).toEqual({ urls: ['https://a/rss'], cursor: '2026-11-01T00:00:00.000Z|x' })
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/podcasts/signature')).toBe(false)
  })
})

describe('listenVouch', () => {
  it('reuses one vouch for most of a day, per user', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    routes['/api/podcasts/signature'] = reply(200, { ...VOUCH, timestamp: 1000 })
    expect(await P.listenVouch('alice')).toEqual({ user: 'alice', signature: 'API-SIG', timestamp: 1000 })
    await P.listenVouch('alice')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf('/api/podcasts/signature')).toEqual({ action: 'listen', payload: 'session' })
    vi.setSystemTime(1000 + 20 * 3600 * 1000)
    await P.listenVouch('alice')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('is null signed out or when the session cannot be proven', async () => {
    expect(await P.listenVouch(null)).toBeNull()
    routes['/api/podcasts/signature'] = reply(401, {})
    expect(await P.listenVouch('bob')).toBeNull()
  })
})

describe('vouched reads', () => {
  it('vouchQuery is the session vouch as vu/vts/vsig, or empty', async () => {
    expect(await P.vouchQuery('alice')).toBe('vu=alice&vts=5&vsig=S')
    expect(await P.vouchQuery()).toBe('vu=alice&vts=5&vsig=S')
    h.lastUser.mockReturnValue(null)
    expect(await P.vouchQuery()).toBe('')
    h.sessionVouch.mockResolvedValue(null)
    expect(await P.vouchQuery('alice')).toBe('')
  })

  it('privateAudioUrl streams through the checker, or is null without a vouch', async () => {
    expect(await P.privateAudioUrl('ep/1', 'alice')).toBe(`${API}/episode/ep%2F1/download?vu=alice&vts=5&vsig=S`)
    h.sessionVouch.mockResolvedValue(null)
    expect(await P.privateAudioUrl('ep1', 'alice')).toBeNull()
  })

  it('fetchPrivateChapters reads with the vouch and is empty on any failure', async () => {
    routes[`${API}/episode/ep1/chapters`] = reply(200, { chapters: [{ start: 0 }] })
    expect(await P.fetchPrivateChapters('ep1', 'alice')).toEqual([{ start: 0 }])
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/episode/ep1/chapters?vu=alice&vts=5&vsig=S`)
    routes[`${API}/episode/ep1/chapters`] = reply(404, { error: 'not_found', code: 'nf' })
    expect(await P.fetchPrivateChapters('ep1', 'alice')).toEqual([])
    routes[`${API}/episode/ep1/chapters`] = reply(200, { chapters: 'x' })
    expect(await P.fetchPrivateChapters('ep1', 'alice')).toEqual([])
  })

  it('fetchEpisode and fetchOlderEpisodes add the vouch after an existing query with &', async () => {
    await P.fetchEpisode('ep1', 'alice')
    await P.fetchOlderEpisodes('f1', 60, '2026-01-01', '2026-02-01', 'bees', 'alice')
    h.lastUser.mockReturnValue(null)
    await P.fetchOlderEpisodes('f1', 0)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${API}/episode/ep1?vu=alice&vts=5&vsig=S`,
      `${API}/feed/f1/older?offset=60&limit=60&since=2026-01-01&until=2026-02-01&q=bees&vu=alice&vts=5&vsig=S`,
      `${API}/feed/f1/older?offset=0&limit=60`,
    ])
  })

  it('a failed read throws with the status and code', async () => {
    routes[`${API}/search`] = reply(429, { error: 'slow down', code: 'rate' })
    await expect(P.searchPodcasts('bees', 'de')).rejects.toMatchObject({ message: 'slow down', status: 429, code: 'rate' })
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/search?q=bees&country=de`)
  })

  it('searchPeople encodes the name', async () => {
    await P.searchPeople('Ann & Bo')
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/person?q=Ann%20%26%20Bo`)
  })
})

describe('buildPrivateFeedUrl', () => {
  it.each([
    ['https://feeds.example/rss?x=1#a', 'me@x', 'p:ss', 'https://me%40x:p%3Ass@feeds.example/rss?x=1#a'],
    ['https://feeds.example/rss', 'me', '', 'https://me:@feeds.example/rss'],
    [' https://feeds.example/rss?token=1 ', '', 'x', 'https://feeds.example/rss?token=1'],
    ['not a url', 'me', 'pw', 'not a url'],
    ['ftp://feeds.example/rss', 'me', 'pw', 'ftp://feeds.example/rss'],
    [null, 'me', 'pw', ''],
  ])('%j with %j / %j -> %j', (url, user, pass, out) => {
    expect(P.buildPrivateFeedUrl(url, user, pass)).toBe(out)
  })
})

describe('query hooks', () => {
  it('config and discover read plain endpoints', async () => {
    const { opts: cfg } = P.usePodcastConfig()
    const { opts: disc } = P.usePodcastDiscover()
    expect(cfg.queryKey).toEqual(['podcasts', 'config'])
    await cfg.queryFn()
    await disc.queryFn()
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${API}/config`, `${API}/discover`])
  })

  it('subscriptions are vouched, saved for offline, and offered from that copy first', async () => {
    routes[`${API}/subscriptions`] = reply(200, { subscriptions: [{ feed_id: 'f1' }] })
    const { opts } = P.usePodcastSubscriptions('alice')
    expect(opts.enabled).toBe(true)
    expect(opts.initialData()).toBeUndefined()
    expect(await opts.queryFn()).toEqual([{ feed_id: 'f1' }])
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/subscriptions?user=alice&vu=alice&vts=5&vsig=S`)
    expect(P.usePodcastSubscriptions('alice').opts.initialData()).toEqual([{ feed_id: 'f1' }])
    expect(P.usePodcastSubscriptions(null).opts).toMatchObject({ enabled: false })
    expect(P.usePodcastSubscriptions(null).opts.initialData()).toBeUndefined()
  })

  it('subscriptions default to an empty list and survive a broken offline copy', async () => {
    localStorage.setItem('podcast-subs-snapshot:alice', '{broken')
    expect(P.usePodcastSubscriptions('alice').opts.initialData()).toBeUndefined()
    routes[`${API}/subscriptions`] = reply(200, {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
    expect(await P.usePodcastSubscriptions('alice').opts.queryFn()).toEqual([])
  })

  it('latest episodes page by date, 30 at a time, and only the first page is saved', async () => {
    const episodes = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, published_at: `2026-01-${String(30 - i).padStart(2, '0')}` }))
    routes[`${API}/latest`] = reply(200, { episodes })
    const { opts } = P.usePodcastLatest('alice')
    expect(opts.initialData()).toBeUndefined()
    const first = await opts.queryFn({ pageParam: null })
    expect(opts.getNextPageParam(first)).toBe('2026-01-01')
    expect(opts.getNextPageParam({ episodes: episodes.slice(0, 5) })).toBeUndefined()
    await opts.queryFn({ pageParam: '2026-01-01' })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${API}/latest?user=alice&limit=30&vu=alice&vts=5&vsig=S`,
      `${API}/latest?user=alice&limit=30&before=2026-01-01&vu=alice&vts=5&vsig=S`,
    ])
    expect(P.usePodcastLatest('alice').opts.initialData()).toEqual({ pages: [{ episodes }], pageParams: [null] })
    expect(P.usePodcastLatest(null).opts.initialData()).toBeUndefined()
  })

  it('a show page carries its date filter, search and the reader', async () => {
    const { opts } = P.usePodcastFeed('f1', '2026-01-01', '', 'a b', 'alice')
    expect(opts.queryKey).toEqual(['podcasts', 'feed', 'f1', '2026-01-01', '', 'a b', 'alice'])
    expect(opts.placeholderData('prev')).toBe('prev')
    await opts.queryFn()
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/feed/f1?limit=60&since=2026-01-01&q=a%20b&vu=alice&vts=5&vsig=S`)
    expect(P.usePodcastFeed('').opts.enabled).toBe(false)
  })

  it('episode and notes hooks read the episode, and notes default to empty', async () => {
    routes[`${API}/episode/ep1/notes`] = reply(200, {})
    expect(P.usePodcastEpisode('ep1').opts.queryKey).toEqual(['podcasts', 'episode', 'ep1', ''])
    await P.usePodcastEpisode('ep1').opts.queryFn()
    expect(await P.useEpisodeNotes('ep1', 'alice').opts.queryFn()).toBe('')
    routes[`${API}/episode/ep1/notes`] = reply(200, { html: '<p>Hi</p>' })
    expect(await P.useEpisodeNotes('ep1').opts.queryFn()).toBe('<p>Hi</p>')
  })

  it('charts need a country; charts and trending default to empty lists', async () => {
    expect(P.usePodcastCharts('', '').opts.enabled).toBe(false)
    expect(P.usePodcastCharts('de', 'Music', false).opts.enabled).toBe(false)
    expect(await P.usePodcastCharts('de', 'Music').opts.queryFn()).toEqual([])
    routes[`${API}/trending`] = reply(200, { results: [{ id: 1 }] })
    expect(await P.usePodcastTrending('en', '').opts.queryFn()).toEqual([{ id: 1 }])
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${API}/charts?country=de&cat=Music`, `${API}/trending?lang=en&cat=`])
  })

  it('useInvalidatePodcasts refreshes every podcast query', () => {
    const { result } = renderHook(() => P.useInvalidatePodcasts())
    result.current()
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['podcasts'] })
  })
})

describe('the bell', () => {
  const data = {
    feeds: { f1: { title: 'Show' } },
    episodes: [
      { id: 'old', feed_id: 'f1', first_seen_at: '2026-01-01T00:00:00Z' },
      { id: 'new', feed_id: 'f2', first_seen_at: '2026-03-01T00:00:00Z' },
    ],
  }

  it('counts episodes newer than the last look, and marking seen re-renders', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'))
    P.markPodcastNotificationsSeen('alice')
    h.queryData = data
    const { result } = renderHook(() => P.usePodcastNotifications('alice'))
    expect(result.current.unseenCount).toBe(1)
    expect(result.current.episodes.map((e) => [e.id, e.seen, e.feed?.title ?? null])).toEqual([['old', true, 'Show'], ['new', false, null]])
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'))
    act(() => P.markPodcastNotificationsSeen('alice'))
    expect(result.current.unseenCount).toBe(0)
    vi.useRealTimers()
  })

  it('signed out the bell is empty, and marking does nothing', async () => {
    P.markPodcastNotificationsSeen(null)
    expect(localStorage.length).toBe(0)
    const { result } = renderHook(() => P.usePodcastNotifications(null))
    expect(result.current).toEqual({ episodes: [], unseenCount: 0 })
  })

  it('reads notifications with the vouch, every five minutes', async () => {
    renderHook(() => P.usePodcastNotifications('al ice'))
    expect(h.lastQuery).toMatchObject({ queryKey: ['podcasts', 'notifications', 'al ice'], enabled: true, refetchInterval: 300000 })
    await h.lastQuery.queryFn()
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/notifications?user=al%20ice&vu=al+ice&vts=5&vsig=S`)
  })

  it('a blocked storage reads as never looked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    h.queryData = data
    expect(() => P.markPodcastNotificationsSeen('alice')).not.toThrow()
    const { result } = renderHook(() => P.usePodcastNotifications('alice'))
    expect(result.current.unseenCount).toBe(2)
  })
})

describe('cover art and tracks', () => {
  it('artUrl builds a checker URL per size, or empty without art', () => {
    expect(P.artUrl('tok')).toBe(`${API}/art/tok/128.jpg`)
    expect(P.artUrl('tok', 512)).toBe(`${API}/art/tok/512.jpg`)
    expect(P.artUrl('')).toBe('')
    expect(P.ART_SIZES).toEqual([64, 128, 256, 512])
  })

  it('onArtError swaps a broken cover for the placeholder once', () => {
    const img = document.createElement('img')
    img.src = 'https://broken.example/x.jpg'
    P.onArtError({ currentTarget: img })
    expect(img.src).toBe(P.PODCAST_PLACEHOLDER)
    const set = vi.spyOn(img, 'src', 'set')
    P.onArtError({ currentTarget: img })
    expect(set).not.toHaveBeenCalled()
  })

  it('a live stream becomes a LIVE track with no length', () => {
    const feed = { id: 'f1', title: 'Show', image: 'i.png', art: 'a', link: 'https://show', value: { v: 1 }, funding: [{}], url: 'https://rss', private: true }
    expect(P.liveToTrack({ id: 'l1', url: 'https://live/stream.m3u8', mime: 'application/x-mpegURL' }, feed)).toEqual({
      _id: 'live:f1:l1', external: true, live: true, src: 'https://live/stream.m3u8', mime: 'application/x-mpegURL',
      title: 'Show', owner: '', show: 'Show', show_id: 'f1', thumbnail_url: 'i.png', art: 'a', duration: 0, summary: '',
      link: 'https://show', value: { v: 1 }, funding: [{}], feed_url: 'https://rss', private: true,
    })
    expect(P.liveToTrack({ id: 'l2', url: 'u', title: 'Now', link: 'https://l' }, null)).toMatchObject({
      _id: 'live::l2', title: 'Now', link: 'https://l', mime: '', value: null, funding: [],
    })
  })

  it('episodeToTrack keeps Podcasting 2.0 extras and the private flag', () => {
    const track = P.episodeToTrack({ id: 'e1', feed_id: 'f1', season: 2, episode: 3, transcripts: [], persons: null, private: true }, null)
    expect(track).toMatchObject({ season: 2, episode: 3, transcripts: [], private: true, show: '', funding: [] })
    expect(track).not.toHaveProperty('persons')
  })

  it.each([
    [{ season: 2, episode: 14 }, 'S2 E14'],
    [{ episode: '14' }, 'E14'],
    [{ season: 2 }, 'S2'],
    [{ season: 0, episode: -1 }, ''],
    [null, ''],
  ])('episodeNumberLabel(%j) is %j', (ep, label) => {
    expect(P.episodeNumberLabel(ep)).toBe(label)
  })

  it('builds the audio page paths', () => {
    expect(P.podcastPath('f1')).toBe('/audio?type=external&podcast=f1')
    expect(P.episodePath('a/b')).toBe('/audio?type=external&episode=a%2Fb')
  })
})

describe('pseudoWaveform', () => {
  it('draws 800 samples in [-1, 1], alternating sign, the same for the same episode', () => {
    const [wave] = P.pseudoWaveform('ep-1')
    expect(wave).toHaveLength(800)
    expect(wave.every((v) => v >= -1 && v <= 1)).toBe(true)
    expect(wave[0]).toBeGreaterThan(0)
    expect(wave[1]).toBeLessThan(0)
    expect(P.pseudoWaveform('ep-1')).toBe(P.pseudoWaveform('ep-1'))
    expect(P.pseudoWaveform('ep-2')[0]).not.toEqual(wave)
  })

  it('keeps at most 50 episodes cached', () => {
    const first = P.pseudoWaveform('cache-0', 10)
    for (let i = 1; i <= 51; i += 1) P.pseudoWaveform(`cache-${i}`, 10)
    expect(P.pseudoWaveform('cache-0', 10)).not.toBe(first)
    expect(P.pseudoWaveform('cache-0', 10)[0]).toEqual(first[0])
  })
})

describe('downloadOpml', () => {
  it('saves only the public feeds and says how many were left out', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:opml')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const left = P.downloadOpml([{ url: 'https://a/rss', title: 'A' }, { url: 'https://p/rss', private: true }, { title: 'no url' }], 'alice')
    expect(left).toBe(2)
    expect(click).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('text/x-opml')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:opml')
    vi.useRealTimers()
  })

  it('does nothing when every feed is private', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(P.downloadOpml([{ url: 'https://p/rss', private: true }], 'alice')).toBe(1)
    expect(click).not.toHaveBeenCalled()
  })
})
