// The podcast source of the importer (server/youtube-import.cjs): a creator's
// verified RSS feeds, read from the checker. A stub checker answers on loopback;
// nothing reaches a real feed, the checker or Mongo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import express from 'express'

const require = createRequire(import.meta.url)
const FEED = '0123456789abcdef01234567'
const EP1 = `${FEED}:AAAAAAAAAAAAAAAA`
const EP2 = `${FEED}:BBBBBBBBBBBBBBBB`
const LONG = `${FEED}:CCCCCCCCCCCCCCCC`

let checker
let importer
let app
let server
let base
let work
const seen = []

beforeAll(async () => {
  const stub = express()
  stub.use((req, _res, next) => { seen.push(req.originalUrl); next() })
  stub.get('/verify/links/:user', (req, res) => res.json({ links: [] }))
  stub.get('/podcasts/verified', (req, res) => {
    if (req.query.user === 'nolink') return res.json({ success: true, feeds: [] })
    res.json({
      success: true,
      feeds: [
        { url: 'https://example.com/feed.xml', feed: { id: FEED, title: 'My Show', art: 'artTok', link: 'https://example.com' } },
        { url: 'https://example.com/broken', code: 'not_a_podcast' },
      ],
    })
  })
  stub.get(`/podcasts/feed/${FEED}/older`, (req, res) => res.json({
    success: true,
    total: 3,
    next_offset: Number(req.query.offset) + 3,
    episodes: [
      { id: EP1, title: 'Episode 1', summary: 'short notes', duration: 1800, mime: 'audio/mpeg', published_at: '2026-11-01T00:00:00Z' },
      { id: EP2, title: 'Episode 2', duration: 600, mime: 'audio/x-m4a', art: 'epArt' },
      { id: LONG, title: 'Marathon', duration: 6 * 3600, mime: 'audio/mpeg' },
      { id: 'not-an-id', title: 'junk' },
    ],
  }))
  stub.get('/podcasts/episode/:id/notes', (req, res) => res.json({ success: true, html: '<p>Full <b>notes</b> with <a href="https://example.com/x">a link</a></p><img src="x.jpg">' }))
  stub.get('/podcasts/verified/:user/episode/:id/download', (req, res) => {
    if (req.params.user !== 'alice') return res.status(404).end()
    res.set('Content-Type', 'audio/mpeg').send(Buffer.from('ID3 fake audio'))
  })
  await new Promise((r) => { checker = stub.listen(0, '127.0.0.1', r) })

  work = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-import-rss-'))
  process.env.SOCIAL_VERIFIER_URL = `http://127.0.0.1:${checker.address().port}`
  process.env.YT_IMPORT_DIR = path.join(work, 'jobs')
  process.env.YT_IMPORT_STORE = path.join(work, 'imports.json')
  process.env.YTDLP_AUTO_UPDATE = 'false'
  process.env.IMPORT_LIBRARY_MONGODB_URI = ''
  process.env.MONGODB_URI = ''
  importer = require('../../server/youtube-import.cjs')
  app = express()
  app.use(express.json())
  importer.mountYoutubeImport(app, {
    resolveUser: async (req) => req.headers['x-test-user'] || null,
  })
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => {
  checker?.close()
  server?.close()
  if (work) fs.rmSync(work, { recursive: true, force: true })
})

// GET / POST against the mounted routes: { status, body, headers }.
async function call(method, url, { user, body } = {}) {
  const headers = {}
  if (user) headers['x-test-user'] = user
  if (body) headers['content-type'] = 'application/json'
  const r = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body: json, text, headers: Object.fromEntries(r.headers) }
}
const get = (url, user) => call('GET', url, { user })
const post = (url, user, body) => call('POST', url, { user, body })
const list = (user = 'alice', q = '') => get(`/api/yt-import/rss/videos${q}`, user)
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i += 1) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timed out')
}

describe('podcast episodes of verified feeds', () => {
  it('lists the episodes of the first readable show, with every show named', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    expect(res.body.feedId).toBe(FEED)
    expect(res.body.shows).toEqual([
      { url: 'https://example.com/feed.xml', id: FEED, title: 'My Show', code: null },
      { url: 'https://example.com/broken', id: null, title: '', code: 'not_a_podcast' },
    ])
    expect(res.body.videos.map((v) => v.id)).toEqual(['rss:AAAAAAAAAAAAAAAA', 'rss:BBBBBBBBBBBBBBBB', 'rss:CCCCCCCCCCCCCCCC'])
    const [one, two, long] = res.body.videos
    expect(one).toMatchObject({ platform: 'rss', kind: 'audio', type: 'podcast', title: 'Episode 1', description: 'short notes', duration: 1800, tooLong: false, channelTitle: 'My Show', sourceUrl: 'https://example.com' })
    expect(one.thumbnail).toBe(`${process.env.SOCIAL_VERIFIER_URL}/podcasts/art/artTok/512.jpg`)
    expect(two.thumbnail).toMatch(/\/podcasts\/art\/epArt\/512\.jpg$/)
    expect(long.tooLong).toBe(true)
    expect(res.body.hasMore).toBe(false)
    expect(seen).toContain(`/podcasts/feed/${FEED}/older?offset=0&limit=25`)
  })

  it('asks the checker for later pages by offset', async () => {
    expect((await list('alice', '?page=2')).status).toBe(200)
    expect(seen).toContain(`/podcasts/feed/${FEED}/older?offset=50&limit=25`)
  })

  it('without a verified feed: link one first', async () => {
    const res = await list('nolink')
    expect(res.status).toBe(403)
    expect(res.body.errorCode).toBe('no_link')
  })

  it('signed out: 401', async () => {
    expect((await get('/api/yt-import/rss/videos')).status).toBe(401)
  })

  it('show notes come back as plain text with their links, images left out', async () => {
    const { body } = await list()
    const res = await get(`/api/yt-import/rss/notes/${body.videos[0].token}`, 'alice')
    expect(res.body.text).toBe('Full notes with a link [https://example.com/x]')
    expect((await get(`/api/yt-import/rss/notes/${body.videos[0].token}`, 'bob')).status).toBe(404)
  })

  it('downloads an episode through the checker\'s owner-checked route, as audio', async () => {
    const { body } = await list()
    const ep = body.videos[1]
    const job = (await post('/api/yt-import/jobs', 'alice', { token: ep.token })).body
    expect(job.id).toBeTruthy()
    const done = await waitFor(async () => {
      const j = (await get(`/api/yt-import/jobs/${job.id}`, 'alice')).body
      return j.status === 'done' || j.status === 'failed' ? j : null
    })
    expect(done.status).toBe('done')
    expect(seen).toContain(`/podcasts/verified/alice/episode/${encodeURIComponent(EP2)}/download`)
    const file = await get(`/api/yt-import/jobs/${job.id}/file`, 'alice')
    expect(file.status).toBe(200)
    expect(file.text).toBe('ID3 fake audio')
    expect(file.headers['content-type']).toMatch(/^audio\/x-m4a/)
    // Someone else's token is refused before anything is fetched.
    expect((await post('/api/yt-import/jobs', 'bob', { token: ep.token })).status).toBe(404)
  })

  it('an episode over the podcast limit is refused up front', async () => {
    const { body } = await list()
    const res = await post('/api/yt-import/jobs', 'alice', { token: body.videos[2].token })
    expect(res.status).toBe(400)
    expect(res.body.errorCode).toBe('too_long')
    expect(res.body.error).toMatch(/4-hour/)
  })
})

describe('helpers', () => {
  it('rss source ids are recorded like the others', () => {
    const { SOURCE_RE } = importer._test
    expect(SOURCE_RE.test('rss:AAAAAAAAAAAAAAAA')).toBe(true)
    expect(SOURCE_RE.test('rss:short')).toBe(false)
  })
  it('audio file extensions from the episode type', () => {
    const { audioExt } = importer._test
    expect(audioExt('audio/mpeg')).toBe('mp3')
    expect(audioExt('audio/x-m4a; charset=binary')).toBe('m4a')
    expect(audioExt('')).toBe('mp3')
  })
  it('long notes are cut below the post body limit', () => {
    const { notesText } = importer._test
    const text = notesText(`<p>${'word '.repeat(2000)}</p>`)
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(text.endsWith('…')).toBe(true)
  })
})
