// ⏳ The batch import under the free plan's daily limits (server/import-batch.cjs):
// a free account's next video is scheduled on the checker's next free PUBLISH
// time (1 video + 3 Shorts per 24 hours) and only fetched shortly before it; an
// embed service that still caps uploads holds it back too. Neither refuses the
// item. The embed service and the checker are one stub on loopback.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let stub
let batch
let lastQuotaCall = null
// The checker stub: 'limit' = video taken before FREE_AT, 'down' = unreadable,
// 'always' = every create refused. Creates are recorded.
const checker = { mode: 'limit', creates: [], quotaCalls: [] }
const FREE_AT = '2026-11-23T10:00:00.000Z'

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/uploads/quota') {
      lastQuotaCall = { owner: url.searchParams.get('owner'), key: req.headers['x-api-key'] }
      if (url.searchParams.get('owner') === 'down') { res.statusCode = 503; return res.end('{"error":"x"}') }
      return res.end(JSON.stringify({ enabled: true, exempt: false, reason: null, video: { limit: 1, used: 1, remaining: 0, next_at: '2026-11-23T10:00:00Z' }, short: { limit: 3, used: 0, remaining: 3, next_at: null } }))
    }
    if (url.pathname.startsWith('/publish-quota/')) {
      const owner = decodeURIComponent(url.pathname.split('/').pop())
      const kind = url.searchParams.get('kind')
      const at = url.searchParams.get('at')
      checker.quotaCalls.push({ owner, kind, at })
      if (checker.mode === 'down') { res.statusCode = 404; return res.end('{"error":"Not found"}') }
      const taken = kind === 'video' && Date.parse(at) < Date.parse(FREE_AT)
      return res.end(JSON.stringify({
        success: true, enabled: true, exempt: false, reason: null, kind, limit: kind === 'video' ? 1 : 3, window_hours: 24, at,
        allowed: !taken,
        conflicts: taken ? [{ permlink: 'my-trip', title: 'My trip', at: '2026-11-22T10:00:00.000Z', scheduled: false }] : [],
        next_free_at: taken ? FREE_AT : at,
      }))
    }
    if (url.pathname === '/scheduled-posts/create') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        checker.creates.push(body)
        const refused = checker.mode === 'always' || Date.parse(body.scheduledOn) < Date.parse(FREE_AT)
        if (refused) {
          res.statusCode = 429
          return res.end(JSON.stringify({ error: 'Daily publish limit reached', code: 'daily_publish_limit', kind: 'video', limit: 1, conflicts: [], next_free_at: FREE_AT }))
        }
        res.statusCode = 201
        return res.end('{"success":true}')
      })
      return undefined
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
  process.env.CHECKER_URL = `http://127.0.0.1:${stub.address().port}`
  process.env.CHECKER_API_KEY = 'checker-test-key'
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

describe('publishWaitUntil (the checker\'s publish quota)', () => {
  const answer = (extra) => ({ success: true, enabled: true, exempt: false, allowed: false, next_free_at: FREE_AT, ...extra })

  it('no wait when free, exempt, off, unknown or not answered', () => {
    expect(batch.publishWaitUntil([answer({ allowed: true })], NOW)).toBeNull()
    expect(batch.publishWaitUntil([answer({ exempt: true, reason: 'pro' })], NOW)).toBeNull()
    expect(batch.publishWaitUntil([answer({ enabled: false })], NOW)).toBeNull()
    expect(batch.publishWaitUntil([null], NOW)).toBeNull()
    expect(batch.publishWaitUntil([answer({ success: false })], NOW)).toBeNull()
    expect(batch.publishWaitUntil([], NOW)).toBeNull()
  })

  it('taken: the next free time', () => {
    expect(batch.publishWaitUntil([answer()], NOW)).toBe(Date.parse(FREE_AT))
  })

  it('a source that may be either kind waits only when both are taken, for the sooner one', () => {
    const shortFree = answer({ allowed: true })
    expect(batch.publishWaitUntil([answer(), shortFree], NOW)).toBeNull()
    const shortAt = '2026-11-22T18:00:00.000Z'
    expect(batch.publishWaitUntil([answer(), answer({ next_free_at: shortAt })], NOW)).toBe(Date.parse(shortAt))
  })

  it('taken without a next time: looks again in an hour', () => {
    expect(batch.publishWaitUntil([answer({ next_free_at: null })], NOW)).toBe(NOW + HOUR)
  })
})

describe('holdItem lead', () => {
  it('rechecks `lead` before the free time, so the download is ready in time', () => {
    const lead = 20 * 60 * 1000
    const soon = batch.holdItem({}, NOW + 30 * 60 * 1000, NOW, { lead })
    expect(Date.parse(soon.waitUntil)).toBe(NOW + 30 * 60 * 1000 + 60 * 1000)
    expect(Date.parse(soon.recheckAt)).toBe(NOW + 30 * 60 * 1000 + 60 * 1000 - lead)
    // Far off: still looks again within the hour.
    const far = batch.holdItem({}, NOW + 20 * HOUR, NOW, { lead })
    expect(Date.parse(far.recheckAt)).toBe(NOW + HOUR)
  })
})

describe('checker publish quota calls', () => {
  beforeEach(() => { checker.mode = 'limit'; checker.creates = []; checker.quotaCalls = [] })

  it('publishQuota asks for the owner, kind and time; null when unreadable', async () => {
    const at = Date.parse('2026-11-22T12:07:00.000Z')
    const q = await batch.publishQuota('badadib', 'video', at)
    expect(checker.quotaCalls[0]).toEqual({ owner: 'badadib', kind: 'video', at: new Date(at).toISOString() })
    expect(q).toMatchObject({ allowed: false, next_free_at: FREE_AT, conflicts: [{ title: 'My trip' }] })
    checker.mode = 'down'
    expect(await batch.publishQuota('badadib', 'video', at)).toBeNull()
  })

  it('freePublishSlot: the slot when free, else just past the next free time; fail open when unreadable', async () => {
    const slot = Date.parse('2026-11-22T12:07:00.000Z')
    expect(await batch.freePublishSlot('badadib', 'video', slot)).toBe(Date.parse(FREE_AT) + 60 * 1000)
    expect(await batch.freePublishSlot('badadib', 'short', slot)).toBe(slot)
    const later = Date.parse('2026-11-24T12:00:00.000Z')
    expect(await batch.freePublishSlot('badadib', 'video', later)).toBe(later)
    checker.mode = 'down'
    expect(await batch.freePublishSlot('badadib', 'video', slot)).toBe(slot)
  })

  it('scheduleOnFreeTime: a create refused over the limit goes again on the next free time', async () => {
    const slot = Date.parse('2026-11-22T12:07:00.000Z')
    const at = await batch.scheduleOnFreeTime({ owner: 'badadib', permlink: 'p1', title: 'Video p1' }, slot, null)
    expect(at).toBe(Date.parse(FREE_AT) + 60 * 1000)
    expect(checker.creates.map((c) => c.scheduledOn)).toEqual([new Date(slot).toISOString(), new Date(at).toISOString()])
    expect(checker.creates[1]).toMatchObject({ owner: 'badadib', permlink: 'p1', title: 'Video p1' })
  })

  it('scheduleOnFreeTime: gives up after three refusals with the limit\'s code', async () => {
    checker.mode = 'always'
    const slot = Date.parse('2026-11-23T12:00:00.000Z')
    await expect(batch.scheduleOnFreeTime({ owner: 'badadib', permlink: 'p2' }, slot, null)).rejects.toMatchObject({ code: 'daily_publish_limit' })
    expect(checker.creates).toHaveLength(3)
  })
})
