// Automatic podcast imports (server/import-auto.cjs): which episodes of a
// verified feed get queued, and the settings route. The checker, the batch
// runner and the posting grant are stand-ins; nothing leaves the process.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import express from 'express'

const require = createRequire(import.meta.url)
const FEED_URL = 'https://example.com/feed.xml'
const FEED = { id: '0123456789abcdef01234567', title: 'My Show' }
const HOUR = 3600 * 1000
const key = (n) => String(n).padStart(16, 'A')
const ep = (n, at, extra = {}) => ({ id: `${FEED.id}:${key(n)}`, title: `Episode ${n}`, published_at: new Date(at).toISOString(), duration: 1800, mime: 'audio/mpeg', ...extra })

let work
let server
let base
let auto
let mod
const state = {}

function reset() {
  Object.assign(state, {
    episodes: [ep(2, Date.now() - 48 * HOUR), ep(1, Date.now() - 96 * HOUR)],
    shows: { alice: [{ url: FEED_URL, feed: FEED }] },
    granted: true,
    imported: {},
    queued: [],
  })
}

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'import-auto-'))
  process.env.IMPORT_AUTO_STORE = path.join(work, 'auto.json')
  process.env.IMPORT_BATCH_MONGODB_URI = ''
  process.env.MONGODB_URI = ''
  mod = require('../../server/import-auto.cjs')
  const batchModule = require('../../server/import-batch.cjs')
  reset()
  const app = express()
  app.use(express.json())
  auto = mod.mountImportAuto(app, {
    auth: async (req, res) => {
      const u = req.headers['x-test-user']
      if (!u) { res.status(401).json({ error: 'sign in' }); return null }
      return u
    },
    mw: [],
    batch: {
      ready: Promise.resolve(true),
      parseOptions: async (_u, o) => ({ options: { community: o?.community || 'hive-181335', payout: o?.payout || 'default', beneficiaries: [], nsfw: false, ads: true, reblog: false } }),
      enqueue: (user, sources, options, meta) => { state.queued.push({ user, sources, options, meta }); return { id: `b${state.queued.length}` } },
    },
    verifiedPodcasts: async (user) => state.shows[user] || [],
    feedEpisodes: async () => [...state.episodes].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)),
    rssSourceOf: (feed, e) => ({ sourceId: `rss:${e.id.split(':')[1]}`, platform: 'rss', title: e.title, duration: e.duration }),
    hasPostingGrant: async () => state.granted,
    knownImports: async () => ({ imported: state.imported, inBatch: {} }),
    audioReady: () => true,
    audioTypes: batchModule.AUDIO_TYPES,
    maxDurationS: 4 * 3600,
  })
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => {
  server?.close()
  if (work) fs.rmSync(work, { recursive: true, force: true })
})

// Every test starts from a show that is switched off (switching on starts afresh).
beforeEach(async () => {
  reset()
  await call('PUT', '/api/yt-import/auto', { feedUrl: FEED_URL, enabled: false })
})

async function call(method, url, body, user = 'alice') {
  const r = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const save = (extra = {}) => call('PUT', '/api/yt-import/auto', {
  feedUrl: FEED_URL, enabled: true,
  settings: { type: 'interview', titleTemplate: '{show} #{episode}: {title}', useNotes: true, addendum: 'Subscribe!', tags: ['Talk', '#hive', 'x', 'talk'], hashtags: false },
  options: { community: 'hive-123456', payout: 'powerup' },
  ...extra,
})
const queuedIds = () => state.queued.flatMap((q) => q.sources.map((s) => s.sourceId))

describe('switching it on', () => {
  it('stores the checked settings and takes what is in the feed now as never imported', async () => {
    const res = await save()
    expect(res.status).toBe(200)
    expect(res.body.config).toMatchObject({
      feedUrl: FEED_URL, feedTitle: 'My Show', enabled: true,
      settings: { type: 'interview', titleTemplate: '{show} #{episode}: {title}', useNotes: true, addendum: 'Subscribe!', tags: ['talk', 'hive'], hashtags: false },
      options: { community: 'hive-123456', payout: 'powerup' },
    })
    expect(res.body.config.enabledAt).toBeTruthy()
    await auto.checkAll()
    expect(state.queued).toEqual([])
  })

  it('refuses a feed that is not verified, a missing grant, and a fixed text left empty', async () => {
    expect((await call('PUT', '/api/yt-import/auto', { feedUrl: 'https://other.example/feed', enabled: true })).body.errorCode).toBe('no_link')
    state.granted = false
    expect((await save()).body.errorCode).toBe('no_grant')
    state.granted = true
    expect((await save({ settings: { useNotes: false, text: '' } })).body.errorCode).toBe('bad_settings')
    expect((await call('GET', '/api/yt-import/auto', null, null)).status).toBe(401)
  })
})

describe('the check', () => {
  it('queues a new episode once, with the show settings, and never again', async () => {
    await save()
    state.episodes.unshift(ep(3, Date.now() - HOUR))
    await auto.checkAll()
    expect(queuedIds()).toEqual([`rss:${key(3)}`])
    expect(state.queued[0].options).toMatchObject({ community: 'hive-123456', payout: 'powerup', audio: { type: 'interview', addendum: 'Subscribe!', hashtags: false } })
    expect(state.queued[0].meta).toEqual({ auto: true, autoFeed: FEED_URL })
    await auto.checkAll()
    expect(queuedIds()).toEqual([`rss:${key(3)}`])
    const { body } = await call('GET', '/api/yt-import/auto')
    expect(body.configs[0].status).toMatchObject({ queued: 1, lastErrorCode: null })
  })

  it('leaves out a back catalogue under new ids, episodes already on 3Speak, and future ones', async () => {
    await save()
    state.episodes.push(ep(90, Date.now() - 30 * 24 * HOUR))
    state.episodes.unshift(ep(4, Date.now() - 2 * HOUR))
    state.imported[`rss:${key(4)}`] = 'already-posted'
    state.episodes.unshift(ep(5, Date.now() + 5 * HOUR))
    await auto.checkAll()
    expect(queuedIds()).toEqual([])
  })

  it('skips an episode over the length limit and names it', async () => {
    await save()
    state.episodes.unshift(ep(6, Date.now() - HOUR, { duration: 5 * 3600 }))
    await auto.checkAll()
    expect(queuedIds()).toEqual([])
    const { body } = await call('GET', '/api/yt-import/auto')
    expect(body.configs[0].status.lastSkipped).toEqual([{ title: 'Episode 6', reason: 'too_long' }])
  })

  it('at most five a day per show, oldest first; the rest wait', async () => {
    await save()
    for (let n = 10; n < 17; n += 1) state.episodes.unshift(ep(n, Date.now() - (20 - n) * 60 * 1000))
    await auto.checkAll()
    expect(queuedIds()).toEqual([10, 11, 12, 13, 14].map((n) => `rss:${key(n)}`))
    const { body } = await call('GET', '/api/yt-import/auto')
    expect(body.configs[0].status.waiting).toBe(2)
  })

  it('a creator who unlinked the feed or took back the grant: nothing queued, the status says why', async () => {
    await save()
    state.episodes.unshift(ep(7, Date.now() - HOUR))
    state.granted = false
    await auto.checkAll()
    expect(queuedIds()).toEqual([])
    expect((await call('GET', '/api/yt-import/auto')).body.configs[0].status.lastErrorCode).toBe('no_grant')
    state.granted = true
    state.shows.alice = []
    await auto.checkAll()
    expect((await call('GET', '/api/yt-import/auto')).body.configs[0].status.lastErrorCode).toBe('no_link')
  })

  it('switched off: nothing; switched on again: only what is new from then', async () => {
    await save()
    await save({ enabled: false })
    state.episodes.unshift(ep(8, Date.now() - HOUR))
    await auto.checkAll()
    expect(queuedIds()).toEqual([])
    await save()
    await auto.checkAll()
    expect(queuedIds()).toEqual([])
    state.episodes.unshift(ep(9, Date.now()))
    await auto.checkAll()
    expect(queuedIds()).toEqual([`rss:${key(9)}`])
  })

  it('editing the settings keeps the starting point', async () => {
    await save()
    state.episodes.unshift(ep(11, Date.now() - HOUR))
    await save({ settings: { titleTemplate: '{title}' } })
    await auto.checkAll()
    expect(queuedIds()).toEqual([`rss:${key(11)}`])
    expect(state.queued[0].options.audio.titleTemplate).toBe('{title}')
  })
})

describe('buildAudioPost with show settings', () => {
  const { buildAudioPost } = require('../../server/import-batch.cjs')
  const source = {
    sourceId: 'rss:AAAAAAAAAAAAAAAA', platform: 'rss', title: 'Hello', description: 'Notes #hive #music', sourceUrl: 'https://example.com/1',
    episode: { show: 'My Show', number: 7, publishedAt: '2026-11-14T10:00:00Z' },
  }
  const opts = (audio) => ({ community: 'hive-181335', payout: 'default', beneficiaries: [], ads: true, audio })

  it('title from the template, notes plus the addendum, fixed tags only, the picked kind', () => {
    const post = buildAudioPost({ user: 'alice', source, playUrl: 'https://p', options: opts({ type: 'interview', titleTemplate: '{show} #{episode}: {title}', useNotes: true, addendum: 'Subscribe!', tags: ['talk'], hashtags: false }), premium: true, duration: 60 })
    expect(post.title).toBe('My Show #7: Hello')
    expect(post.body).toBe('https://p\n\nNotes #hive #music\n\nSubscribe!')
    expect(post.tags).toEqual(['hive-181335', 'talk'])
    expect(post.jsonMetadata.audio).toEqual({ type: 'interview' })
    expect(post.jsonMetadata['threespeak.audio']).toEqual({ type: 'interview', duration: 60 })
  })

  it('a fixed text instead of the notes, with the episode values in it; hashtags on', () => {
    const post = buildAudioPost({ user: 'alice', source, playUrl: 'https://p', options: opts({ titleTemplate: '{title}', useNotes: false, text: 'New from {show}: {title}', tags: [], hashtags: true }), premium: true, duration: 0 })
    expect(post.description).toBe('New from My Show: Hello')
    expect(post.tags).toEqual(['hive-181335', 'hive', 'music'])
    expect(post.type).toBe('podcast')
  })

  it('from the source: the own fields are kept but not used, only the kind counts', () => {
    const post = buildAudioPost({ user: 'alice', source, playUrl: 'https://p', options: opts({ type: 'audiobook', fromSource: true, titleTemplate: '{show}: {title}', useNotes: false, text: 'x', tags: ['mine'], hashtags: false }), premium: true, duration: 0 })
    expect(post.title).toBe('Hello')
    expect(post.description).toBe('Notes #hive #music')
    expect(post.tags).toEqual(['hive-181335', 'hive', 'music'])
    expect(post.type).toBe('audiobook')
  })

  it('as a snap: no title on Hive, a MicroPost with the snap tags first; the title stays for the audio', () => {
    const post = buildAudioPost({ user: 'alice', source, playUrl: 'https://p', options: opts({ type: 'podcast', target: 'snap', fromSource: true }), premium: true, duration: 0 })
    expect(post.snap).toBe(true)
    expect(post.postTitle).toBe('')
    expect(post.title).toBe('Hello')
    expect(post.jsonMetadata.oa).toEqual({ v: 1, object: 'MicroPost' })
    expect(post.tags.slice(0, 3)).toEqual(['audio', 'three-speak', 'mantequilla'])
    expect(post.tags).not.toContain('hive-181335')
    const { parseSettings } = require('../../server/import-auto.cjs')
    const { AUDIO_TYPES } = require('../../server/import-batch.cjs')
    expect(parseSettings({ target: 'snap' }, AUDIO_TYPES).settings.target).toBe('snap')
    expect(parseSettings({ target: 'nonsense' }, AUDIO_TYPES).settings.target).toBe('post')
  })

  it('from the source needs no text of your own; own fields without notes do', () => {
    const { parseSettings } = require('../../server/import-auto.cjs')
    const { AUDIO_TYPES } = require('../../server/import-batch.cjs')
    expect(parseSettings({ fromSource: true, useNotes: false }, AUDIO_TYPES).settings).toMatchObject({ fromSource: true })
    expect(parseSettings({ fromSource: false, useNotes: false }, AUDIO_TYPES).error).toBeTruthy()
  })

  it('long notes are cut so notes and addendum stay under the body limit', () => {
    const post = buildAudioPost({ user: 'alice', source: { ...source, description: 'x'.repeat(6000) }, playUrl: 'https://p', options: opts({ useNotes: true, addendum: 'A'.repeat(500) }), premium: true, duration: 0 })
    expect(post.description.length).toBeLessThanOrEqual(4500)
    expect(post.description.endsWith('A'.repeat(500))).toBe(true)
  })
})
