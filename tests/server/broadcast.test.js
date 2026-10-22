// POST /api/broadcast (posting ops signed with @threespeak's key under the user's
// grant), the legacy app-key path and ALLOW_APPKEY_AUTH=0, and the server-to-server
// stream announcer /api/openpods/announce. Broadcasts go to a fake Hive node that
// only records them (see helpers/preload.cjs).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApi, configuredEnv } from './helpers/server.js'
import { hiveAccount, accounts, walletSession } from './helpers/hive.js'

const FIXTURES = {
  accounts: accounts(
    hiveAccount('alice'),
    // A badge account that gave alice posting authority over it.
    hiveAccount('badge.one', { accountAuths: [['alice', 1]] }),
    hiveAccount('bob'),
    hiveAccount('carol', { grant: false }),
  ),
}

let api
beforeAll(async () => { api = await startApi({ fixtures: FIXTURES }) })
afterAll(async () => { await api?.stop() })

const as = (user) => ({ cookies: { threespeak_wsession: walletSession(api.env.SESSION_SIGNING_SECRET, user) } })
const broadcast = (operations, opts = as('alice')) => api.request('/api/broadcast', { method: 'POST', json: { operations }, ...opts })
const vote = (voter, author = 'bob') => ['vote', { voter, author, permlink: 'a-post', weight: 10000 }]
const follow = (auths, who = 'bob') => ['custom_json', {
  id: 'follow', required_auths: [], required_posting_auths: auths,
  json: JSON.stringify(['follow', { follower: auths[0], following: who, what: ['blog'] }]),
}]
const broadcastCount = () => api.broadcasts().length

describe('broadcast', () => {
  it('signs and sends a vote by the signed-in user', async () => {
    const before = broadcastCount()
    const r = await broadcast([vote('alice')])
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(r.body.result.id).toMatch(/^[0-9a-f]{40}$/)
    const sent = api.broadcasts().slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0].operations).toEqual([vote('alice')])
    expect(sent[0].signatures).toHaveLength(1)
  })

  it('accepts a ButrAuth session the same way', async () => {
    const r = await broadcast([vote('bob', 'alice')], { cookies: { threespeak_session: 'test-butr:bob' } })
    expect(r.status).toBe(200)
  })

  it('needs at least one and at most 20 operations', async () => {
    for (const operations of [undefined, []]) {
      const r = await broadcast(operations)
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'No operations provided' })
    }
    const many = await broadcast(Array.from({ length: 21 }, () => vote('alice')))
    expect(many.status).toBe(400)
    expect(many.body).toEqual({ error: 'Too many operations' })
  })

  it('refuses users who did not grant @threespeak posting authority', async () => {
    const r = await broadcast([vote('carol')], as('carol'))
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'Authorization required' })
    const ghost = await broadcast([vote('ghost')], as('ghost'))
    expect(ghost.status).toBe(403)
  })

  it('refuses operations outside the posting whitelist', async () => {
    for (const op of [
      ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: '' }],
      ['account_update', { account: 'alice' }],
      ['transfer_to_vesting', { from: 'alice', to: 'alice', amount: '1.000 HIVE' }],
    ]) {
      const r = await broadcast([op])
      expect(r.status, op[0]).toBe(400)
      expect(r.body).toEqual({ error: 'Operation not allowed' })
    }
  })

  it('refuses acting as someone else in a plain operation', async () => {
    for (const op of [
      vote('bob'),
      ['comment', { author: 'bob', permlink: 'x', parent_author: '', parent_permlink: 'hive', title: 't', body: 'b', json_metadata: '{}' }],
      ['delete_comment', { author: 'bob', permlink: 'x' }],
      ['claim_reward_balance', { account: 'bob', reward_hive: '0.000 HIVE', reward_hbd: '0.000 HBD', reward_vests: '1.000000 VESTS' }],
    ]) {
      const r = await broadcast([op])
      expect(r.status, op[0]).toBe(403)
      expect(r.body).toEqual({ error: 'Operation not allowed' })
    }
  })

  it('one bad operation stops the whole batch', async () => {
    const before = broadcastCount()
    const r = await broadcast([vote('alice'), vote('bob')])
    expect(r.status).toBe(403)
    expect(broadcastCount()).toBe(before)
  })

  it('custom_json: only whitelisted ids', async () => {
    const r = await broadcast([['custom_json', { id: 'ssc-mainnet-hive', required_auths: [], required_posting_auths: ['alice'], json: '{}' }]])
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'custom_json id not allowed for this app' })
    expect((await broadcast([follow(['alice'])])).status).toBe(200)
  })

  it('custom_json: community is limited to subscribe and unsubscribe', async () => {
    const community = (json) => ['custom_json', { id: 'community', required_auths: [], required_posting_auths: ['alice'], json }]
    expect((await broadcast([community(JSON.stringify(['subscribe', { community: 'hive-181335' }]))])).status).toBe(200)
    const admin = await broadcast([community(JSON.stringify(['setRole', { community: 'hive-181335', account: 'bob', role: 'admin' }]))])
    expect(admin.status).toBe(403)
    expect(admin.body).toEqual({ error: 'custom_json action not allowed for this app' })
    const broken = await broadcast([community('not json')])
    expect(broken.status).toBe(400)
    expect(broken.body).toEqual({ error: 'Invalid custom_json payload' })
  })

  it('custom_json: acting for another account needs posting authority over it', async () => {
    const r = await broadcast([follow(['bob'])])
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'You do not hold posting authority over @bob' })
    expect((await broadcast([follow(['badge.one'], 'carol')])).status).toBe(200)
    const none = await broadcast([['custom_json', { id: 'follow', required_auths: [], required_posting_auths: [], json: '[]' }]])
    expect(none.status).toBe(403)
  })

  it('custom_json co-signed by the user and another account still needs authority over the other', async () => {
    // The authority check only runs when the user is NOT among required_posting_auths,
    // so ['alice', 'bob'] skips it and @threespeak signs for bob as well.
    const before = broadcastCount()
    const r = await broadcast([follow(['alice', 'bob'])])
    expect(r.status).toBe(403)
    expect(broadcastCount()).toBe(before)
  })

  it('account_update2 may only set posting_json_metadata on the own account', async () => {
    const upd = (data) => ['account_update2', { account: 'alice', json_metadata: '', posting_json_metadata: '{"3speak":{}}', extensions: [], ...data }]
    expect((await broadcast([upd({})])).status).toBe(200)
    const cases = [
      [upd({ account: 'bob' }), 'Operation not allowed'],
      [upd({ posting: { weight_threshold: 1, account_auths: [], key_auths: [] } }), 'account_update2 auth fields not allowed'],
      [upd({ memo_key: 'STM1111111111111111111111111111111114T1Anm' }), 'account_update2 auth fields not allowed'],
      [upd({ json_metadata: '{"x":1}' }), 'account_update2 json_metadata not allowed (posting auth only)'],
    ]
    for (const [op, error] of cases) {
      const r = await broadcast([op])
      expect(r.status).toBe(403)
      expect(r.body).toEqual({ error })
    }
  })
})

// The public app key plus a claimed name, sent to every route that trusted it.
const APPKEY_CASES = [
  ['/api/broadcast', { username: 'bob', operations: [vote('bob', 'alice')] }],
  ['/api/ads/opt-out-signature', { username: 'bob', adsEnabled: true, communitySharePct: 50 }],
  ['/api/ads/viewer-signature', { username: 'bob', rewardsEnabled: true }],
  ['/api/snapie-chat/sign-challenge', { username: 'bob', challenge: '0b0e2b5e-9f3a-4c56-8d1e-2f4a6b8c0d1e' }],
  ['/api/openpods/sign-challenge', { username: 'bob', challenge: 'hivehangouts:bob:1:ab' }],
]

describe('legacy app-key path (off by default where wallet sessions work)', () => {
  it('the app key plus a claimed name identifies nobody, on any route', async () => {
    const before = broadcastCount()
    for (const [route, json] of APPKEY_CASES) {
      const r = await api.request(route, { method: 'POST', headers: { 'X-API-Key': api.env.EMBED_API_KEY }, json })
      expect(r.status, route).toBe(401)
    }
    expect(broadcastCount()).toBe(before)
  })
})

describe('with ALLOW_APPKEY_AUTH=1 (the rollback switch)', () => {
  let legacy
  beforeAll(async () => { legacy = await startApi({ env: { ...configuredEnv(), ALLOW_APPKEY_AUTH: '1' }, fixtures: FIXTURES }) })
  afterAll(async () => { await legacy?.stop() })
  const key = () => ({ 'X-API-Key': legacy.env.EMBED_API_KEY })

  it('acts as the claimed user for posting operations', async () => {
    const r = await legacy.request('/api/broadcast', { method: 'POST', headers: key(), json: { username: 'Bob', operations: [vote('bob', 'alice')] } })
    expect(r.status).toBe(200)
  })

  it('refuses anything but post-type operations', async () => {
    const op = ['claim_reward_balance', { account: 'bob', reward_hive: '0.000 HIVE', reward_hbd: '0.000 HBD', reward_vests: '0.000000 VESTS' }]
    const r = await legacy.request('/api/broadcast', { method: 'POST', headers: key(), json: { username: 'bob', operations: [op] } })
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'Operation not allowed for app-key auth' })
  })
})

describe('with ALLOW_APPKEY_AUTH=0', () => {
  let strict
  beforeAll(async () => { strict = await startApi({ env: { ...configuredEnv(), ALLOW_APPKEY_AUTH: '0' }, fixtures: FIXTURES }) })
  afterAll(async () => { await strict?.stop() })

  it('the app key no longer identifies anyone', async () => {
    const headers = { 'X-API-Key': strict.env.EMBED_API_KEY }
    for (const [route, json] of APPKEY_CASES) {
      const r = await strict.request(route, { method: 'POST', headers, json })
      expect(r.status, route).toBe(401)
    }
    expect(strict.broadcasts()).toEqual([])
  })

  it('a wallet session still works', async () => {
    const r = await strict.request('/api/broadcast', {
      method: 'POST',
      json: { operations: [vote('alice')] },
      cookies: { threespeak_wsession: walletSession(strict.env.SESSION_SIGNING_SECRET, 'alice') },
    })
    expect(r.status).toBe(200)
  })
})

describe('stream announcer', () => {
  const ANNOUNCE = { host: 'alice', room: 'my-stream-room', title: 'Live now', description: 'hello', tags: ['live'] }
  const announce = (json, { secret = api.env.OPENPODS_ANNOUNCE_SECRET, ip = null, headers = {} } = {}) =>
    api.request('/api/openpods/announce', { method: 'POST', json, ip, headers: { ...(secret ? { 'X-Announce-Secret': secret } : {}), ...headers } })

  beforeEach(() => api.clearNetLog())

  it('accepts only direct loopback calls, not ones through the proxy', async () => {
    for (const opts of [{ ip: '203.0.113.9' }, { headers: { 'X-Real-IP': '203.0.113.9' } }]) {
      const r = await announce(ANNOUNCE, opts)
      expect(r.status).toBe(403)
      expect(r.body).toEqual({ ok: false, reason: 'forbidden' })
    }
  })

  it('needs the shared secret', async () => {
    for (const secret of [null, 'wrong', api.env.OPENPODS_ANNOUNCE_SECRET + 'x']) {
      const r = await announce(ANNOUNCE, { secret })
      expect(r.status).toBe(401)
      expect(r.body).toEqual({ ok: false, reason: 'unauthorized' })
    }
    expect(api.netLog()).toEqual([])
  })

  it('names the first invalid field', async () => {
    const cases = [
      [{ ...ANNOUNCE, host: 'No Such' }, 'host'],
      [{ ...ANNOUNCE, room: '' }, 'room'],
      [{ ...ANNOUNCE, title: '' }, 'title'],
      [{ ...ANNOUNCE, thumbnail: 'http://insecure.example/x.jpg' }, 'thumbnail'],
      [{ ...ANNOUNCE, tags: 'live' }, 'tags'],
      [{ ...ANNOUNCE, beneficiaries: [{ account: 'bob', weight: 0 }] }, 'beneficiary weight'],
    ]
    for (const [json, field] of cases) {
      const r = await announce(json)
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ ok: false, reason: 'invalid', field })
    }
  })

  it('a dry run returns the operations without broadcasting', async () => {
    const before = broadcastCount()
    const r = await announce({ ...ANNOUNCE, dryRun: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, dryRun: true, permlink: 'my-stream-room' })
    const comment = r.body.operations.find(([t]) => t === 'comment')
    expect(comment[1]).toMatchObject({ author: 'alice', permlink: 'my-stream-room', title: 'Live now' })
    expect(broadcastCount()).toBe(before)
  })

  it('posts for a host who granted @threespeak posting authority', async () => {
    const before = broadcastCount()
    const r = await announce(ANNOUNCE)
    expect(r.body).toEqual({ ok: true, permlink: 'my-stream-room' })
    const [tx] = api.broadcasts().slice(before)
    expect(tx.operations.every(([, op]) => !op.author || op.author === 'alice')).toBe(true)
  })

  it('reports a host without the grant', async () => {
    const r = await announce({ ...ANNOUNCE, host: 'carol' })
    expect(r.body).toEqual({ ok: false, reason: 'no_posting_authority' })
  })
})
