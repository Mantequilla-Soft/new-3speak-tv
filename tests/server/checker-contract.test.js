// Cross-check against the REAL checker code (3speakchecks): the proofs this app
// produces must pass the checker's own routes with enforcement switched on
// (SCHEDULED_POSTS_REQUIRE_SIGNATURE=true, PUSH_REQUIRE_PROOF=true). A message
// format that drifts by one byte (a field order, a lowercased name, a re-formatted
// date) fails here instead of after the owner flips the switches.
//
// The signatures come from our API under test (throwaway service key, see
// helpers/server.js), from the batch importer's signer, and from the browser
// helper's message signed with a user's own key (the wallet path). The checker's
// routes run in this process with its Hive reads answered from fixtures and its
// database faked; nothing touches a real node, database or key.
//
// Needs a checkout of the checker with its node_modules: CHECKER_SRC, default
// /home/dockeruser/3speakchecks-coverage. Skipped when there is none (CI).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { startApi } from './helpers/server.js'
import { hiveAccount, accounts, serviceKey, userKey, walletSession, SERVICE_ACCOUNT } from './helpers/hive.js'

vi.mock('../../src/hive-api/aioha', () => ({
  establishWalletSession: vi.fn(), getCurrentProvider: vi.fn(), getCurrentUser: vi.fn(), isManteAuthLogin: vi.fn(),
  signMessageWithAioha: vi.fn(), KeyTypes: { Posting: 'posting' }, Providers: {},
}))
vi.mock('../../src/i18n', () => ({ t: (k) => k }))

const CHECKER_SRC = process.env.CHECKER_SRC || '/home/dockeruser/3speakchecks-coverage'
const HAVE_CHECKER = fs.existsSync(path.join(CHECKER_SRC, 'routes/scheduledPosts.js'))
  && fs.existsSync(path.join(CHECKER_SRC, 'routes/push.js'))
  && fs.existsSync(path.join(CHECKER_SRC, 'node_modules/express'))

const CHECKER_KEY = 'checker-contract-test-key'
const DAY = 24 * 60 * 60 * 1000
const ENV = {
  API_SECRET_KEY: CHECKER_KEY,
  HIVE_AUTH_REQUIRED: 'true',
  AD_SIGNING_DELEGATES: SERVICE_ACCOUNT,
  SCHEDULED_POSTS_REQUIRE_SIGNATURE: 'true',
  PUSH_REQUIRE_PROOF: 'true',
}

// The Hive accounts both sides see: alice and bob granted @threespeak posting
// authority; @threespeak's posting key is the test service key.
const chainAccounts = {
  alice: hiveAccount('alice'),
  bob: hiveAccount('bob'),
  [SERVICE_ACCOUNT]: hiveAccount(SERVICE_ACCOUNT, { grant: false, key: serviceKey }),
}

function stubModule(req, request, exports) {
  const resolved = req.resolve(request)
  const m = new Module(resolved)
  m.filename = resolved
  m.loaded = true
  m.exports = exports
  req.cache[resolved] = m
}

describe.skipIf(!HAVE_CHECKER)('proofs pass the checker with enforcement on', () => {
  let api
  let checker
  let checkerUrl
  let saved
  let importBatch
  let proofModule
  let dhiveClient
  let realCall
  const writes = []

  beforeAll(async () => {
    saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]))
    Object.assign(process.env, ENV)

    const creq = createRequire(path.join(CHECKER_SRC, 'package.json'))
    // Never the checker's .env, its database, or its push sender.
    const noop = () => ({ parsed: {} })
    stubModule(creq, 'dotenv', { config: noop, configDotenv: noop, parse: () => ({}), populate: () => ({}) })
    const collection = {
      findOneAndUpdate: async (filter, update) => {
        writes.push({ filter, update })
        return { value: { _id: 'id-1', status: update.$set?.status || 'scheduled', scheduledOn: new Date() } }
      },
      findOne: async () => null,
    }
    stubModule(creq, './utils/db', { getDb: async () => ({ collection: () => collection }) })
    stubModule(creq, './services/scheduledPosts', { COLLECTION: 'scheduled-posts', hasThreespeakPostingAuthority: async () => true })
    stubModule(creq, './utils/webPush', {
      isConfigured: () => true, KINDS: ['videos'], publicKey: () => 'k',
      getPrefs: async () => ({}), savePrefs: async (_u, p) => p,
      saveSubscription: async () => {}, removeSubscription: async () => 1, sendToUser: async () => ({}),
    })
    // Its Hive reads, from the same accounts our API sees. Assigned rather than
    // vi.spyOn: the config's restoreMocks would undo a spy before each test.
    dhiveClient = creq('@hiveio/dhive').Client.prototype
    realCall = dhiveClient.call
    dhiveClient.call = async (_api, method, params) => {
      if (method !== 'get_accounts') throw new Error(`[contract test] no stub for ${method}`)
      return (params[0] || []).map((n) => chainAccounts[n]).filter(Boolean)
    }

    const express = creq('express')
    const app = express()
    app.use(creq('./utils/jsonBody').jsonBody)
    app.use('/scheduled-posts', creq('./routes/scheduledPosts'))
    app.use('/push', creq('./routes/push'))
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }))
    checker = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    checkerUrl = `http://127.0.0.1:${checker.address().port}`

    api = await startApi({ fixtures: { accounts: accounts(chainAccounts.alice, chainAccounts.bob), fetch: [] } })

    // The batch importer posts to CHECKER_URL with CHECKER_API_KEY, read when it loads.
    process.env.CHECKER_URL = checkerUrl
    process.env.CHECKER_API_KEY = CHECKER_KEY
    const req = createRequire(import.meta.url)
    const batchPath = req.resolve('../../server/import-batch.cjs')
    delete req.cache[batchPath]
    importBatch = req(batchPath)
    proofModule = req('../../server/scheduled-post-proof.cjs')
  })

  afterAll(async () => {
    await api?.stop()
    await new Promise((r) => (checker ? checker.close(r) : r()))
    if (dhiveClient && realCall) dhiveClient.call = realCall
    for (const [k, v] of Object.entries(saved || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    delete process.env.CHECKER_URL
    delete process.env.CHECKER_API_KEY
  })

  const as = (user) => ({ cookies: { threespeak_wsession: walletSession(api.env.SESSION_SIGNING_SECRET, user) } })
  const proofFromApi = async (fields, user = fields.owner) => {
    const r = await api.request('/api/scheduled-posts/signature', { method: 'POST', json: fields, ...as(user) })
    expect(r.status).toBe(200)
    return { signature: r.body.signature, timestamp: r.body.timestamp }
  }
  const toChecker = async (route, body) => {
    const r = await fetch(`${checkerUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHECKER_KEY}` },
      body: JSON.stringify(body),
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }
  const at = () => new Date(Date.now() + DAY).toISOString()

  describe('scheduled posts (signed by @threespeak through our API)', () => {
    it('create is taken, and only with the scheduledOn it was signed over', async () => {
      const scheduledOn = at()
      const proof = await proofFromApi({ action: 'create', owner: 'alice', permlink: 'my-video-42', scheduledOn })
      const ok = await toChecker('/scheduled-posts/create', { owner: 'alice', permlink: 'my-video-42', scheduledOn, title: 't', ...proof })
      expect(ok.status).toBe(201)

      // Same instant, written differently: not the bytes that were signed.
      const reformatted = scheduledOn.replace(/\.\d{3}Z$/, 'Z')
      const bad = await toChecker('/scheduled-posts/create', { owner: 'alice', permlink: 'my-video-42', scheduledOn: reformatted, ...proof })
      expect(bad.status).toBe(401)
      expect(bad.body.error).toBe('Invalid signature')
    })

    it('update and cancel are taken', async () => {
      const upd = await proofFromApi({ action: 'update', owner: 'alice', permlink: 'my-video-42' })
      expect((await toChecker('/scheduled-posts/update', { owner: 'alice', permlink: 'my-video-42', updates: { title: 'x' }, ...upd })).status).toBe(200)
      const can = await proofFromApi({ action: 'cancel', owner: 'alice', permlink: 'my-video-42' })
      expect((await toChecker('/scheduled-posts/cancel', { owner: 'alice', permlink: 'my-video-42', ...can })).status).toBe(200)
    })

    it('a proof never carries over to another action, post or owner', async () => {
      const can = await proofFromApi({ action: 'cancel', owner: 'alice', permlink: 'my-video-42' })
      expect((await toChecker('/scheduled-posts/update', { owner: 'alice', permlink: 'my-video-42', updates: {}, ...can })).status).toBe(401)
      expect((await toChecker('/scheduled-posts/cancel', { owner: 'alice', permlink: 'other-post', ...can })).status).toBe(401)
      expect((await toChecker('/scheduled-posts/cancel', { owner: 'bob', permlink: 'my-video-42', ...can })).status).toBe(401)
    })

    it('an unsigned write is refused once enforcement is on (what the fallback guards against)', async () => {
      const r = await toChecker('/scheduled-posts/cancel', { owner: 'alice', permlink: 'my-video-42' })
      expect(r.status).toBe(401)
      expect(r.body.error).toBe('Signature required')
    })
  })

  describe('scheduled posts (signed by the owner\'s own wallet)', () => {
    it('the browser helper\'s message, signed with the owner\'s posting key, is taken', async () => {
      const { scheduledPostMessage } = await import('../../src/utils/scheduledPostProof.js')
      const { cryptoUtils } = createRequire(import.meta.url)('@hiveio/dhive')
      const walletSign = (fields) => {
        const timestamp = Date.now()
        const message = scheduledPostMessage({ ...fields, timestamp })
        return { signature: userKey('alice').sign(cryptoUtils.sha256(Buffer.from(message, 'utf8'))).toString(), timestamp }
      }
      const scheduledOn = at()
      const create = walletSign({ action: 'create', owner: 'alice', permlink: 'wallet-post', scheduledOn })
      expect((await toChecker('/scheduled-posts/create', { owner: 'alice', permlink: 'wallet-post', scheduledOn, ...create })).status).toBe(201)
      const upd = walletSign({ action: 'update', owner: 'alice', permlink: 'wallet-post' })
      expect((await toChecker('/scheduled-posts/update', { owner: 'alice', permlink: 'wallet-post', updates: { title: 'y' }, ...upd })).status).toBe(200)
      const can = walletSign({ action: 'cancel', owner: 'alice', permlink: 'wallet-post' })
      expect((await toChecker('/scheduled-posts/cancel', { owner: 'alice', permlink: 'wallet-post', ...can })).status).toBe(200)
    })
  })

  describe('scheduled posts (the batch importer)', () => {
    it('its create and cancel go through signed', async () => {
      const sign = (fields) => proofModule.signScheduledPost(serviceKey.toString(), fields)
      const before = writes.length
      await importBatch.scheduleOnChecker({ owner: 'bob', permlink: 'import-abc123', scheduledOn: at(), title: 't', body: 'b' }, sign)
      expect(await importBatch.cancelOnChecker('bob', 'import-abc123', sign)).toBe(true)
      expect(writes.length).toBe(before + 2)
      // And without a signer, enforcement refuses it: the batch must be given one.
      await expect(importBatch.scheduleOnChecker({ owner: 'bob', permlink: 'import-x', scheduledOn: at() })).rejects.toThrow(/HTTP 401/)
    })
  })

  describe('push notification choices (the session vouch)', () => {
    const vouchFor = async (user, action = 'push') => {
      const r = await api.request('/api/podcasts/signature', { method: 'POST', json: { action, payload: 'session', username: user }, ...as(user) })
      expect(r.status).toBe(200)
      return { signature: r.body.signature, timestamp: r.body.timestamp }
    }

    it('saving prefs is taken with the vouch, and refused without or with another one', async () => {
      const v = await vouchFor('alice')
      expect((await toChecker('/push/prefs', { username: 'alice', prefs: { videos: false }, ...v })).status).toBe(200)
      // The checker cleans the name the same way the app does.
      expect((await toChecker('/push/prefs', { username: '@Alice', prefs: {}, ...v })).status).toBe(200)
      expect((await toChecker('/push/prefs', { username: 'bob', prefs: {}, ...v })).status).toBe(401)
      expect((await toChecker('/push/prefs', { username: 'alice', prefs: {} })).status).toBe(401)
      const progress = await vouchFor('alice', 'progress')
      expect((await toChecker('/push/prefs', { username: 'alice', prefs: {}, ...progress })).status).toBe(401)
    })

    it('unsubscribing every browser of an account takes the same vouch', async () => {
      const v = await vouchFor('bob')
      expect((await toChecker('/push/unsubscribe', { username: 'bob', ...v })).status).toBe(200)
      expect((await toChecker('/push/unsubscribe', { username: 'bob' })).status).toBe(401)
    })
  })
})
