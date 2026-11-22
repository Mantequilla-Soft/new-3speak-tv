// ⏳ The batch import under the free plan's daily upload limits (server/import-batch.cjs):
// a free account's next video waits for the embed service's next free upload
// instead of failing. The embed service is a stub on loopback.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let stub
let batch
let lastQuotaCall = null

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/uploads/quota') {
      lastQuotaCall = { owner: url.searchParams.get('owner'), key: req.headers['x-api-key'] }
      if (url.searchParams.get('owner') === 'down') { res.statusCode = 503; return res.end('{"error":"x"}') }
      return res.end(JSON.stringify({ enabled: true, exempt: false, reason: null, video: { limit: 1, used: 1, remaining: 0, next_at: '2026-11-23T10:00:00Z' }, short: { limit: 3, used: 0, remaining: 3, next_at: null } }))
    }
    if (url.pathname === '/uploads/token') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (body.owner === 'full') {
          res.statusCode = 429
          return res.end('{"error":"Daily upload limit reached","code":"daily_upload_limit","kind":"video","limit":1,"used":1,"next_at":"2026-11-23T10:00:00Z"}')
        }
        if (body.owner === 'fullnodate') { res.statusCode = 429; return res.end('{"code":"daily_upload_limit"}') }
        res.end('{"token":"tok"}')
      })
      return undefined
    }
    res.statusCode = 404
    return res.end('{}')
  })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  process.env.EMBED_API_BASE = `http://127.0.0.1:${stub.address().port}`
  process.env.EMBED_API_KEY = 'embed-test-key'
  batch = require('../../server/import-batch.cjs')
})

afterAll(() => { stub?.close() })

const NOW = Date.parse('2026-11-22T12:00:00Z')
const HOUR = 3600 * 1000
const quota = (video, short) => ({ enabled: true, exempt: false, video, short })
const room = { limit: 3, used: 0, remaining: 3, next_at: null }
const usedUp = (at) => ({ limit: 1, used: 1, remaining: 0, next_at: at })

describe('quotaWaitUntil', () => {
  it('no wait when exempt, off, unknown, or there is room', () => {
    expect(batch.quotaWaitUntil(null, { duration: 600 }, NOW)).toBeNull()
    expect(batch.quotaWaitUntil({ enabled: false }, { duration: 600 }, NOW)).toBeNull()
    expect(batch.quotaWaitUntil({ enabled: true, exempt: true }, { duration: 600 }, NOW)).toBeNull()
    expect(batch.quotaWaitUntil(quota({ limit: 1, used: 0, remaining: 1, next_at: null }, room), { duration: 600 }, NOW)).toBeNull()
  })

  it('a long video waits for the next video slot', () => {
    const at = '2026-11-23T10:00:00Z'
    expect(batch.quotaWaitUntil(quota(usedUp(at), room), { duration: 600 }, NOW)).toBe(Date.parse(at))
  })

  it('a source that may be a Short only waits when both kinds are used up', () => {
    const v = '2026-11-23T10:00:00Z'
    const s = '2026-11-22T18:00:00Z'
    expect(batch.quotaWaitUntil(quota(usedUp(v), room), { duration: 45 }, NOW)).toBeNull()
    expect(batch.quotaWaitUntil(quota(usedUp(v), { limit: 3, used: 3, remaining: 0, next_at: s }), { duration: 45 }, NOW)).toBe(Date.parse(s))
    // Unknown length: may be either.
    expect(batch.quotaWaitUntil(quota(usedUp(v), room), {}, NOW)).toBeNull()
  })

  it('used up without a next time: looks again in an hour', () => {
    expect(batch.quotaWaitUntil(quota(usedUp(null), room), { duration: 600 }, NOW)).toBe(NOW + HOUR)
  })
})

describe('holdItem / isHeld', () => {
  it('queues the item: shows the next free upload, rechecks within the hour', () => {
    const it0 = { status: 'uploading', progress: 70, jobId: 'j', error: 'x' }
    batch.holdItem(it0, NOW + 20 * HOUR, NOW)
    expect(it0).toMatchObject({ status: 'queued', progress: 0, jobId: null, error: null })
    expect(Date.parse(it0.waitUntil)).toBe(NOW + 20 * HOUR + 60 * 1000)
    expect(Date.parse(it0.recheckAt)).toBe(NOW + HOUR)
    expect(batch.isHeld(it0, NOW + HOUR - 1)).toBe(true)
    expect(batch.isHeld(it0, NOW + HOUR)).toBe(false)
  })

  it('a time soon: rechecks at that time; no time: an hour', () => {
    const soon = batch.holdItem({}, NOW + 10 * 60 * 1000, NOW)
    expect(soon.recheckAt).toBe(soon.waitUntil)
    const none = batch.holdItem({}, null, NOW)
    expect(Date.parse(none.waitUntil)).toBe(NOW + HOUR + 60 * 1000)
  })

  it('an item never held is not held', () => {
    expect(batch.isHeld({ status: 'queued' }, NOW)).toBe(false)
  })
})

describe('embed service calls', () => {
  it('embedQuota reads the owner with the server key, null when unreadable', async () => {
    const q = await batch.embedQuota('badadib')
    expect(lastQuotaCall).toEqual({ owner: 'badadib', key: 'embed-test-key' })
    expect(q.video.remaining).toBe(0)
    expect(await batch.embedQuota('down')).toBeNull()
  })

  it('the upload token refusal carries the next free upload time', async () => {
    await expect(batch.mintUploadToken('full', false)).rejects.toMatchObject({ code: 'daily_upload_limit', nextAt: Date.parse('2026-11-23T10:00:00Z') })
    await expect(batch.mintUploadToken('fullnodate', false)).rejects.toMatchObject({ code: 'daily_upload_limit', nextAt: null })
    await expect(batch.mintUploadToken('badadib', false)).resolves.toMatchObject({ token: 'tok' })
  })
})
