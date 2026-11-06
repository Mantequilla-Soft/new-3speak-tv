// server/scheduled-post-proof.cjs (the message and signature for the checker's
// scheduled-post writes) and the batch importer's writes that carry it
// (server/import-batch.cjs). No server is started: the checker is a stubbed fetch.
// The messages are pinned to what 3speakchecks routes/scheduledPosts.js builds;
// checker-contract.test.js checks them against the checker itself when it is there.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { serviceKey, signerOf } from './helpers/hive.js'

const require = createRequire(import.meta.url)
const { scheduledPostMessage, parseScheduledPostRequest, signScheduledPost } = require('../../server/scheduled-post-proof.cjs')

const AT = '2026-12-01T10:00:00.000Z'

describe('scheduledPostMessage', () => {
  it('builds the checker\'s three messages', () => {
    expect(scheduledPostMessage({ action: 'create', owner: 'alice', permlink: 'p', scheduledOn: AT, timestamp: 9 })).toBe(`scheduled-post|create|alice|p|${AT}|9`)
    expect(scheduledPostMessage({ action: 'update', owner: 'alice', permlink: 'p', scheduledOn: AT, timestamp: 9 })).toBe('scheduled-post|update|alice|p|9')
    expect(scheduledPostMessage({ action: 'cancel', owner: 'alice', permlink: 'p', timestamp: 9 })).toBe('scheduled-post|cancel|alice|p|9')
  })
})

describe('parseScheduledPostRequest', () => {
  it('keeps the fields exactly as given, and scheduledOn only for create', () => {
    expect(parseScheduledPostRequest({ action: 'create', owner: 'alice', permlink: 'p', scheduledOn: AT, extra: 1 }))
      .toEqual({ action: 'create', owner: 'alice', permlink: 'p', scheduledOn: AT })
    expect(parseScheduledPostRequest({ action: 'cancel', owner: 'alice', permlink: 'p', scheduledOn: AT }))
      .toEqual({ action: 'cancel', owner: 'alice', permlink: 'p' })
  })

  it('refuses a body that is not an object', () => {
    expect(parseScheduledPostRequest(null)).toEqual({ error: 'invalid action' })
    expect(parseScheduledPostRequest('x')).toEqual({ error: 'invalid action' })
  })
})

describe('signScheduledPost', () => {
  it('signs the message at the given time with the key', () => {
    const fields = { action: 'create', owner: 'alice', permlink: 'p', scheduledOn: AT }
    const { signature, timestamp } = signScheduledPost(serviceKey.toString(), fields, 1234)
    expect(timestamp).toBe(1234)
    expect(signerOf(signature, `scheduled-post|create|alice|p|${AT}|1234`)).toBe(serviceKey.createPublic().toString())
  })
})

describe('the batch importer\'s writes', () => {
  let batch
  let fetchMock
  beforeAll(() => {
    process.env.CHECKER_URL = 'https://checker.test.invalid'
    process.env.CHECKER_API_KEY = 'ck'
    const p = require.resolve('../../server/import-batch.cjs')
    delete require.cache[p]
    batch = require(p)
  })
  afterAll(() => { delete process.env.CHECKER_URL; delete process.env.CHECKER_API_KEY })

  const stubChecker = () => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ success: true }) }))
    vi.stubGlobal('fetch', fetchMock)
  }
  const sent = (i = 0) => ({ url: fetchMock.mock.calls[i][0], ...fetchMock.mock.calls[i][1], body: JSON.parse(fetchMock.mock.calls[i][1].body) })

  it('create is signed over the scheduledOn it sends, right before sending', async () => {
    stubChecker()
    const sign = vi.fn((fields) => ({ ...signScheduledPost(serviceKey.toString(), fields), extra: 'never sent' }))
    await batch.scheduleOnChecker({ owner: 'bob', permlink: 'import-1', scheduledOn: AT, title: 't' }, sign)
    expect(sign).toHaveBeenCalledWith({ action: 'create', owner: 'bob', permlink: 'import-1', scheduledOn: AT })
    const req = sent()
    expect(req.url).toBe('https://checker.test.invalid/scheduled-posts/create')
    expect(req.headers.Authorization).toBe('Bearer ck')
    expect(Object.keys(req.body).sort()).toEqual(['owner', 'permlink', 'scheduledOn', 'signature', 'timestamp', 'title'])
    expect(signerOf(req.body.signature, `scheduled-post|create|bob|import-1|${AT}|${req.body.timestamp}`)).toBe(serviceKey.createPublic().toString())
  })

  it('cancel is signed too', async () => {
    stubChecker()
    expect(await batch.cancelOnChecker('bob', 'import-1', (f) => signScheduledPost(serviceKey.toString(), f))).toBe(true)
    const req = sent()
    expect(req.url).toBe('https://checker.test.invalid/scheduled-posts/cancel')
    expect(signerOf(req.body.signature, `scheduled-post|cancel|bob|import-1|${req.body.timestamp}`)).toBe(serviceKey.createPublic().toString())
  })

  it('no signer, or one that fails: the write still goes out, unsigned', async () => {
    stubChecker()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await batch.scheduleOnChecker({ owner: 'bob', permlink: 'import-2', scheduledOn: AT })
    await batch.scheduleOnChecker({ owner: 'bob', permlink: 'import-3', scheduledOn: AT }, () => { throw new Error('no key') })
    await batch.cancelOnChecker('bob', 'import-3', () => null)
    for (const i of [0, 1, 2]) expect(sent(i).body).not.toHaveProperty('signature')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not sign the create of @bob\/import-3: no key/))
  })
})
