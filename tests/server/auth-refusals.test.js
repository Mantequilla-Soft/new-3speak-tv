// Every route that acts for a user or signs with @threespeak's key refuses a request
// that carries no proven identity, with the status and error the handler sends, and
// does so before any network call. Also the "not configured" answers of a bare server.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApi, bareEnv } from './helpers/server.js'
import { walletSession } from './helpers/hive.js'

let api
beforeAll(async () => { api = await startApi() })
afterAll(async () => { await api?.stop() })
beforeEach(() => api.clearNetLog())

const post = (pathname, json, opts = {}) => api.request(pathname, { method: 'POST', json, ...opts })
const networkCalls = () => api.netLog()

// [route, body, status, error body]
const SIGNED_OUT = [
  ['/api/broadcast', { operations: [['vote', { voter: 'alice', author: 'bob', permlink: 'p', weight: 10000 }]] }, 401, { error: 'Unauthorized' }],
  ['/api/openpods/sign-challenge', { challenge: 'hivehangouts:alice:1700000000:abcd' }, 401, { error: 'Unauthorized' }],
  ['/api/snapie-chat/sign-challenge', { challenge: '0b0e2b5e-9f3a-4c56-8d1e-2f4a6b8c0d1e' }, 401, { error: 'Unauthorized' }],
  ['/api/snapie-chat/butrauth-session', {}, 401, { error: 'Unauthorized' }],
  ['/api/ads/opt-out-signature', { adsEnabled: false }, 401, { error: 'Unauthorized' }],
  ['/api/ads/viewer-signature', { rewardsEnabled: true }, 401, { error: 'Unauthorized' }],
  ['/api/ads/identity-signature', {}, 401, { error: 'Your login has expired. Log out and log in again to see your products.' }],
  ['/api/captions/edit-signature', { permlink: 'p', lang: 'en', srtSha256: 'a'.repeat(64) }, 401, { error: 'Unauthorized' }],
  ['/api/comments/pin-signature', { permlink: 'p', comment: 'c', pinned: true }, 401, { error: 'Unauthorized', reason: 'not_signed_in_as' }],
  ['/api/supports/hide-signature', { trx_id: 'a'.repeat(40), hidden: true }, 401, { error: 'Unauthorized', reason: 'not_signed_in_as' }],
  ['/api/verify/sign', { action: 'check', platform: 'youtube', platform_username: 'x' }, 401, { error: 'Unauthorized' }],
  ['/api/announcements/read-signature', {}, 401, { error: 'Not signed in' }],
  ['/api/announcements/reply-signature', { number: 3 }, 401, { error: 'Not signed in' }],
  ['/api/watch/token', { owner: 'alice', permlink: 'video' }, 401, { error: 'Unauthorized' }],
  ['/api/editor-token', { user: 'alice' }, 401, { error: 'sign-in-needed' }],
]

describe('signed-out requests', () => {
  for (const [route, body, status, error] of SIGNED_OUT) {
    it(`POST ${route} answers ${status}`, async () => {
      const r = await post(route, body)
      expect(r.status).toBe(status)
      expect(r.body).toEqual(error)
      expect(networkCalls()).toEqual([])
    })
  }

  it('GET /api/manteauth/me answers 401', async () => {
    const r = await api.request('/api/manteauth/me')
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'Unauthorized' })
  })

  it('the guest-list routes answer 401', async () => {
    const get = await api.request('/api/gated/my-video/allowlist')
    expect(get.status).toBe(401)
    expect(get.body).toEqual({ error: 'Sign in to manage your guest list' })
    const patch = await api.request('/api/gated/my-video/allowlist', { method: 'PATCH', json: { allowlist: ['bob'] } })
    expect(patch.status).toBe(401)
    expect(patch.body).toEqual({ error: 'Sign in to manage your guest list' })
    expect(networkCalls()).toEqual([])
  })

  it('the referral and warm-up routes answer 401, the admin lookup a plain 404', async () => {
    expect((await api.request('/api/referral/links')).status).toBe(401)
    expect((await api.request('/api/warmup/contact')).body).toEqual({ error: 'Not signed in' })
    expect((await api.request('/api/warmup/contact', { method: 'PUT', json: { email: 'a@b.c' } })).status).toBe(401)
    expect((await api.request('/api/warmup/social')).status).toBe(401)
    expect((await post('/api/warmup/social/verify', { platform: 'youtube', platform_username: 'x' })).status).toBe(401)
    const admin = await api.request('/api/warmup/admin/advertiser/somebrand')
    expect(admin.status).toBe(404)
    expect(admin.body).toEqual({ error: 'Not found' })
    expect(networkCalls()).toEqual([])
  })

  it('wallet status reports nobody', async () => {
    const r = await api.request('/api/auth/wallet/status')
    expect(r.body).toEqual({ user: null })
  })
})

describe('credentials that prove nothing', () => {
  it('an invalid ButrAuth cookie is refused and cleared', async () => {
    const r = await post('/api/broadcast', { operations: [] }, { cookies: { threespeak_session: 'forged' } })
    expect(r.status).toBe(401)
    expect(r.cookies.some((c) => /^threespeak_session=;/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c))).toBe(true)
  })

  it('a wallet session signed with another secret is refused', async () => {
    const forged = walletSession('not-the-server-secret', 'alice')
    for (const route of ['/api/broadcast', '/api/watch/token', '/api/editor-token', '/api/verify/sign']) {
      const r = await post(route, { operations: [], owner: 'bob', permlink: 'v' }, { cookies: { threespeak_wsession: forged } })
      expect(r.status, route).toBe(401)
    }
    expect((await api.request('/api/auth/wallet/status', { cookies: { threespeak_wsession: forged } })).body).toEqual({ user: null })
  })

  it('an expired wallet session is refused', async () => {
    const expired = walletSession(api.env.SESSION_SIGNING_SECRET, 'alice', Date.now() - 1000)
    const r = await post('/api/watch/token', { owner: 'bob', permlink: 'v' }, { cookies: { threespeak_wsession: expired } })
    expect(r.status).toBe(401)
    expect((await api.request('/api/auth/wallet/status', { cookies: { threespeak_wsession: expired } })).body).toEqual({ user: null })
  })

  it('a wallet session with an edited username is refused', async () => {
    const real = walletSession(api.env.SESSION_SIGNING_SECRET, 'alice')
    const edited = real.replace(':alice:', ':bob:')
    expect((await api.request('/api/auth/wallet/status', { cookies: { threespeak_wsession: edited } })).body).toEqual({ user: null })
  })

  it('a HiveSigner token that HiveSigner does not confirm is refused', async () => {
    const r = await post('/api/broadcast', { operations: [] }, { headers: { Authorization: 'Bearer not-a-real-token' } })
    expect(r.status).toBe(401)
    expect(networkCalls()).toContainEqual(expect.objectContaining({ kind: 'fetch', url: 'https://hivesigner.com/api/me' }))
  })

  it('a wrong app key with a claimed username is refused', async () => {
    const r = await post('/api/broadcast', { username: 'alice', operations: [['vote', {}]] }, { headers: { 'X-API-Key': 'wrong' } })
    expect(r.status).toBe(401)
  })

  it('the strict signers ignore the app key even when it is right', async () => {
    const key = { 'X-API-Key': api.env.EMBED_API_KEY }
    const cases = [
      ['/api/captions/edit-signature', { username: 'alice', permlink: 'p', lang: 'en', srtSha256: 'a'.repeat(64) }],
      ['/api/comments/pin-signature', { username: 'alice', permlink: 'p', comment: 'c', pinned: true }],
      ['/api/supports/hide-signature', { username: 'alice', trx_id: 'a'.repeat(40), hidden: true }],
      ['/api/verify/sign', { username: 'alice', action: 'check', platform: 'youtube', platform_username: 'x' }],
      ['/api/ads/identity-signature', { username: 'alice' }],
      ['/api/announcements/read-signature', { username: 'alice' }],
      ['/api/watch/token', { username: 'alice', owner: 'bob', permlink: 'v' }],
      ['/api/editor-token', { user: 'alice', username: 'alice' }],
    ]
    for (const [route, body] of cases) {
      const r = await post(route, body, { headers: key })
      expect(r.status, route).toBe(401)
    }
    expect(networkCalls()).toEqual([])
  })
})

describe('validation that answers before identity', () => {
  it('reply-signature needs a positive announcement number', async () => {
    for (const number of [undefined, 0, -1, 1.5, 'x']) {
      const r = await post('/api/announcements/reply-signature', { number })
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid announcement' })
    }
  })

  it('manteauth/start needs a redirect_uri', async () => {
    for (const body of [{}, { redirect_uri: 42 }]) {
      const r = await post('/api/manteauth/start', body)
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid request' })
    }
  })

  it('manteauth/exchange needs a code, a redirect_uri and the PKCE cookie', async () => {
    const cases = [
      [{}, undefined],
      [{ code: 'c' }, { manteauth_pkce: 'v' }],
      [{ code: 'c', redirect_uri: 'https://3speak.tv/cb' }, undefined],
    ]
    for (const [body, cookies] of cases) {
      const r = await post('/api/manteauth/exchange', body, { cookies })
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid request' })
    }
    expect(networkCalls()).toEqual([])
  })

  it('hivesigner/session needs a token', async () => {
    const r = await post('/api/auth/hivesigner/session', {})
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'HiveSigner token required' })
  })

  it('a referral people lookup needs a 24-hex id', async () => {
    const r = await api.request('/api/referral/links/not-an-id/people')
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'Invalid request' })
  })

  it('an invite code of the wrong shape is simply not valid', async () => {
    const r = await api.request('/api/referral/invite/short')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ valid: false })
  })
})

describe('image upload', () => {
  it('needs the app key', async () => {
    for (const headers of [{}, { 'X-API-Key': 'wrong' }]) {
      const r = await api.request('/api/upload-image', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: Buffer.from([1, 2, 3]) })
      expect(r.status).toBe(401)
      expect(r.body).toEqual({ error: 'Unauthorized' })
    }
    expect(networkCalls()).toEqual([])
  })

  it('refuses an empty image before uploading anything', async () => {
    const r = await api.request('/api/upload-image', {
      method: 'POST',
      headers: { 'X-API-Key': api.env.EMBED_API_KEY, 'Content-Type': 'image/png' },
      body: Buffer.alloc(0),
    })
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'No image data' })
    expect(networkCalls()).toEqual([])
  })

  it('reports a failed upstream upload generically', async () => {
    const r = await api.request('/api/upload-image', {
      method: 'POST',
      headers: { 'X-API-Key': api.env.EMBED_API_KEY, 'Content-Type': 'image/png' },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ error: 'Image upload failed' })
  })
})

describe('STT token', () => {
  it('needs the app key', async () => {
    const r = await api.request('/api/stt-token')
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'unauthorized' })
  })

  it('mints an expiring HMAC token with the key', async () => {
    const r = await api.request('/api/stt-token', { headers: { 'X-API-Key': api.env.EMBED_API_KEY } })
    expect(r.status).toBe(200)
    expect(r.body.token).toMatch(/^\d+\.[0-9a-f]{64}$/)
    expect(r.body.exp).toBeGreaterThan(Date.now() / 1000)
  })
})

describe('a server with nothing configured', () => {
  let bare
  beforeAll(async () => { bare = await startApi({ env: bareEnv() }) })
  afterAll(async () => { await bare?.stop() })

  const someone = () => ({ cookies: { threespeak_wsession: 'v1:alice:1:x' } })

  it('the signers answer 500 "Server is not configured"', async () => {
    for (const route of [
      '/api/openpods/sign-challenge', '/api/snapie-chat/sign-challenge', '/api/ads/opt-out-signature',
      '/api/ads/viewer-signature', '/api/ads/identity-signature', '/api/captions/edit-signature',
      '/api/comments/pin-signature', '/api/supports/hide-signature', '/api/verify/sign',
      '/api/announcements/read-signature', '/api/announcements/reply-signature',
    ]) {
      const r = await bare.request(route, { method: 'POST', json: {}, ...someone() })
      expect(r.status, route).toBe(500)
      expect(r.body, route).toEqual({ error: 'Server is not configured' })
    }
  })

  it('the token and session routes answer 503', async () => {
    const cases = [
      ['/api/watch/token', { error: 'Not configured' }],
      ['/api/editor-token', { error: 'Drafts not configured' }],
      ['/api/auth/wallet/challenge', { error: 'Sessions not configured' }],
      ['/api/auth/wallet/login', { error: 'Sessions not configured' }],
      ['/api/auth/hivesigner/session', { error: 'Sessions are not configured on this server' }],
    ]
    for (const [route, error] of cases) {
      const r = await bare.request(route, { method: 'POST', json: { username: 'alice' } })
      expect(r.status, route).toBe(503)
      expect(r.body, route).toEqual(error)
    }
    const stt = await bare.request('/api/stt-token')
    expect(stt.status).toBe(503)
  })

  it('the gate routes answer 503 before looking at the caller', async () => {
    const r = await bare.request('/api/gated/my-video/allowlist')
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ error: 'Gate is not configured on this instance' })
  })

  it('the stream announcer is off', async () => {
    const r = await bare.request('/api/openpods/announce', { method: 'POST', json: {}, ip: null })
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('upload and broadcast still refuse anonymous callers first', async () => {
    expect((await bare.request('/api/upload-image', { method: 'POST', body: 'x' })).status).toBe(401)
    expect((await bare.request('/api/broadcast', { method: 'POST', json: { operations: [] } })).status).toBe(401)
  })
})
