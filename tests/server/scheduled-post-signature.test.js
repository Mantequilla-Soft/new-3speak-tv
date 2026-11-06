// POST /api/scheduled-posts/signature (the owner's proof for the checker's
// scheduled-post create/update/cancel) and the push-notification vouch of
// POST /api/podcasts/signature: who may get one, for which account, and the exact
// bytes signed. Signatures come from a throwaway service key; nothing is real.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApi } from './helpers/server.js'
import { hiveAccount, accounts, serviceKey, walletSession, signerOf } from './helpers/hive.js'

const FIXTURES = {
  accounts: accounts(hiveAccount('alice'), hiveAccount('bob'), hiveAccount('carol', { grant: false })),
  fetch: [],
}

let api
beforeAll(async () => { api = await startApi({ fixtures: FIXTURES }) })
afterAll(async () => { await api?.stop() })
beforeEach(() => api.setFixtures(FIXTURES))

const post = (pathname, json, opts = {}) => api.request(pathname, { method: 'POST', json, ...opts })
const sign = (json, opts) => post('/api/scheduled-posts/signature', json, opts)
const wallet = (user) => walletSession(api.env.SESSION_SIGNING_SECRET, user)
const as = (user) => ({ cookies: { threespeak_wsession: wallet(user) } })
const servicePublic = serviceKey.createPublic().toString()
const AT = '2026-12-01T10:00:00.000Z'

describe('the signed message', () => {
  it('create: signs scheduledOn exactly as sent', async () => {
    for (const scheduledOn of [AT, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00+01:00']) {
      const r = await sign({ action: 'create', owner: 'alice', permlink: 'my-video-42', scheduledOn }, as('alice'))
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.body).toMatchObject({ success: true, username: 'alice' })
      expect(Math.abs(r.body.timestamp - Date.now())).toBeLessThan(10000)
      expect(signerOf(r.body.signature, `scheduled-post|create|alice|my-video-42|${scheduledOn}|${r.body.timestamp}`)).toBe(servicePublic)
    }
  })

  it.each(['update', 'cancel'])('%s: owner, permlink and time only (a scheduledOn is ignored)', async (action) => {
    const r = await sign({ action, owner: 'alice', permlink: 'my-video-42', scheduledOn: AT }, as('alice'))
    expect(r.status).toBe(200)
    expect(signerOf(r.body.signature, `scheduled-post|${action}|alice|my-video-42|${r.body.timestamp}`)).toBe(servicePublic)
  })

  it('an older permlink with dots or capitals can still be cancelled', async () => {
    const r = await sign({ action: 'cancel', owner: 'alice', permlink: 'Old.Post_1' }, as('alice'))
    expect(signerOf(r.body.signature, `scheduled-post|cancel|alice|Old.Post_1|${r.body.timestamp}`)).toBe(servicePublic)
  })

  it('refuses fields that are not exactly an owner, a permlink and a date', async () => {
    const cases = [
      [{ action: 'publish', owner: 'alice', permlink: 'p' }, 'invalid action'],
      [{ owner: 'alice', permlink: 'p' }, 'invalid action'],
      [{ action: 'cancel', owner: 'Alice', permlink: 'p' }, 'invalid owner'],
      [{ action: 'cancel', owner: ' alice', permlink: 'p' }, 'invalid owner'],
      [{ action: 'cancel', owner: 'al|ce', permlink: 'p' }, 'invalid owner'],
      [{ action: 'cancel', owner: ['alice'], permlink: 'p' }, 'invalid owner'],
      [{ action: 'cancel', owner: 'alice', permlink: '' }, 'invalid permlink'],
      [{ action: 'cancel', owner: 'alice', permlink: 'a|b' }, 'invalid permlink'],
      [{ action: 'cancel', owner: 'alice', permlink: 'a b' }, 'invalid permlink'],
      [{ action: 'cancel', owner: 'alice', permlink: 'x'.repeat(256) }, 'invalid permlink'],
      [{ action: 'create', owner: 'alice', permlink: 'p' }, 'invalid scheduledOn'],
      [{ action: 'create', owner: 'alice', permlink: 'p', scheduledOn: 'tomorrow' }, 'invalid scheduledOn'],
      [{ action: 'create', owner: 'alice', permlink: 'p', scheduledOn: `${AT}|x` }, 'invalid scheduledOn'],
      [{ action: 'create', owner: 'alice', permlink: 'p', scheduledOn: 1764583200000 }, 'invalid scheduledOn'],
    ]
    for (const [body, error] of cases) {
      const r = await sign(body, as('alice'))
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect(r.body).toEqual({ error })
    }
  })
})

describe('who it signs for', () => {
  const cancel = (owner = 'alice') => ({ action: 'cancel', owner, permlink: 'p' })

  it('a wallet-login session (Keychain, HiveAuth, PeakVault, Ledger)', async () => {
    expect((await sign(cancel(), as('alice'))).status).toBe(200)
  })

  it('a Butter Auth session', async () => {
    const r = await sign(cancel(), { cookies: { threespeak_session: 'test-butr:alice' } })
    expect(r.status).toBe(200)
    expect(r.body.username).toBe('alice')
  })

  it('a HiveSigner token, verified with hivesigner.com', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [{ url: 'https://hivesigner.com/api/me', method: 'POST', json: { name: 'bob' } }] })
    const r = await sign(cancel('bob'), { headers: { Authorization: 'Bearer hs-token' } })
    expect(r.status).toBe(200)
    expect(r.body.username).toBe('bob')
  })

  it('two logins in one browser: the post owner, whichever session comes first', async () => {
    const both = { cookies: { threespeak_session: 'test-butr:alice', threespeak_wsession: wallet('bob') } }
    const forBob = await sign(cancel('bob'), both)
    expect(forBob.status).toBe(200)
    expect(signerOf(forBob.body.signature, `scheduled-post|cancel|bob|p|${forBob.body.timestamp}`)).toBe(servicePublic)
    const forAlice = await sign(cancel('alice'), both)
    expect(forAlice.body.username).toBe('alice')
  })

  it('never for an account the request is not signed in as', async () => {
    const r = await sign(cancel('bob'), as('alice'))
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'Not signed in as this account', reason: 'not_signed_in_as' })
    expect((await sign(cancel('alice'))).status).toBe(401)
  })

  it('never on the public app key plus a claimed name', async () => {
    const r = await sign({ ...cancel('alice'), username: 'alice' }, { headers: { 'X-API-Key': api.env.EMBED_API_KEY } })
    expect(r.status).toBe(401)
    expect(r.body.reason).toBe('not_signed_in_as')
  })

  it('not for an expired or forged wallet session', async () => {
    const expired = walletSession(api.env.SESSION_SIGNING_SECRET, 'alice', Date.now() - 1000)
    expect((await sign(cancel(), { cookies: { threespeak_wsession: expired } })).status).toBe(401)
    expect((await sign(cancel(), { cookies: { threespeak_wsession: walletSession('wrong-secret', 'alice') } })).status).toBe(401)
  })

  it('an owner who has not granted @threespeak posting authority is told why', async () => {
    const r = await sign(cancel('carol'), as('carol'))
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'Scheduling needs @threespeak posting authority on your account.', reason: 'no_grant' })
  })
})

describe('the push-notification vouch', () => {
  const vouch = (json, opts) => post('/api/podcasts/signature', json, opts)

  it('signs 3speak-podcasts|push-vouch|<user>|session|<ms>, with no posting grant needed', async () => {
    const r = await vouch({ action: 'push', payload: 'session' }, as('carol'))
    expect(r.status).toBe(200)
    expect(r.body.username).toBe('carol')
    expect(signerOf(r.body.signature, `3speak-podcasts|push-vouch|carol|session|${r.body.timestamp}`)).toBe(servicePublic)
    const bad = await vouch({ action: 'push', payload: 'alice' }, as('carol'))
    expect(bad.status).toBe(400)
  })

  it('a named account: only a verified session of exactly that account', async () => {
    const both = { cookies: { threespeak_session: 'test-butr:alice', threespeak_wsession: wallet('bob') } }
    const forBob = await vouch({ action: 'push', payload: 'session', username: 'Bob' }, both)
    expect(forBob.body.username).toBe('bob')
    expect(signerOf(forBob.body.signature, `3speak-podcasts|push-vouch|bob|session|${forBob.body.timestamp}`)).toBe(servicePublic)
    const other = await vouch({ action: 'push', payload: 'session', username: 'carol' }, both)
    expect(other.status).toBe(401)
    expect(other.body).toEqual({ error: 'Not signed in', reason: 'not_signed_in_as' })
  })

  it('with no name, as before: the first verified session, or a warm-up ~handle', async () => {
    const both = { cookies: { threespeak_session: 'test-butr:alice', threespeak_wsession: wallet('bob') } }
    expect((await vouch({ action: 'progress', payload: 'session' }, both)).body.username).toBe('alice')
    const warm = await vouch({ action: 'progress', payload: 'session' }, { cookies: { threespeak_session: 'test-butr-incubating:sunny' } })
    expect(warm.body.username).toBe('~sunny')
  })
})
