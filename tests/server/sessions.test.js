// Sign in with Hive (wallet challenge/login with a real signature from a throwaway
// key), the session cookies, and what a proven session unlocks: watch and editor
// tokens, the delegated signers, and the gated-video guest list.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { startApi } from './helpers/server.js'
import {
  hiveAccount, accounts, userKey, serviceKey, walletSession, signChallenge, signerOf, cryptoUtils, Signature,
} from './helpers/hive.js'

const lowWeightKey = userKey('erin')
const FIXTURES = {
  accounts: accounts(
    hiveAccount('alice'),
    hiveAccount('bob'),
    hiveAccount('carol', { grant: false }),
    // Holds a posting key, but below the account's threshold.
    { ...hiveAccount('erin'), posting: { weight_threshold: 2, account_auths: [['threespeak', 2]], key_auths: [[lowWeightKey.createPublic().toString(), 1]] } },
  ),
  fetch: [],
}

let api
beforeAll(async () => { api = await startApi({ fixtures: FIXTURES }) })
afterAll(async () => { await api?.stop() })
beforeEach(() => api.setFixtures(FIXTURES))

const post = (pathname, json, opts = {}) => api.request(pathname, { method: 'POST', json, ...opts })
const as = (user) => ({ cookies: { threespeak_wsession: walletSession(api.env.SESSION_SIGNING_SECRET, user) } })
const servicePublic = serviceKey.createPublic().toString()
const cookieNamed = (r, name) => r.cookies.find((c) => c.startsWith(name + '='))

async function challengeFor(username) {
  const r = await post('/api/auth/wallet/challenge', { username })
  expect(r.status).toBe(200)
  return r.body.challenge
}

describe('wallet challenge', () => {
  it('issues a fresh, uncacheable challenge naming the account', async () => {
    const r = await post('/api/auth/wallet/challenge', { username: '  Alice ' })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const [prefix, user, exp, rand, mac] = r.body.challenge.split(':')
    expect([prefix, user]).toEqual(['3speak-login', 'alice'])
    expect(Number(exp)).toBeGreaterThan(Date.now())
    expect(Number(exp)).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000)
    expect(rand).toMatch(/^[0-9a-f]{24}$/)
    expect(mac).toMatch(/^[0-9a-f]{64}$/)
    expect(await challengeFor('alice')).not.toBe(r.body.challenge)
  })

  it('refuses names that cannot be Hive accounts', async () => {
    for (const username of ['ab', '1alice', 'has space', 'a'.repeat(17), 'al:ice', 42, null]) {
      const r = await post('/api/auth/wallet/challenge', { username })
      expect(r.status, String(username)).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid username' })
    }
  })
})

describe('wallet login', () => {
  it('a signature from the posting key opens a session', async () => {
    const challenge = await challengeFor('alice')
    const r = await post('/api/auth/wallet/login', { username: 'alice', challenge, signature: signChallenge(userKey('alice'), challenge) })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ success: true, username: 'alice' })

    const session = cookieNamed(r, 'threespeak_wsession')
    expect(session).toMatch(/HttpOnly/)
    expect(session).toMatch(/Secure/)
    expect(session).toMatch(/SameSite=Lax/)
    expect(session).toMatch(/Domain=\.3speak\.tv/)
    expect(cookieNamed(r, 'threespeak_user')).not.toMatch(/HttpOnly/)

    const token = decodeURIComponent(session.split(';')[0].split('=')[1])
    const status = await api.request('/api/auth/wallet/status', { cookies: { threespeak_wsession: token } })
    expect(status.body).toEqual({ user: 'alice' })
  })

  it('a challenge and signature work only once', async () => {
    const challenge = await challengeFor('alice')
    const body = { username: 'alice', challenge, signature: signChallenge(userKey('alice'), challenge) }
    expect((await post('/api/auth/wallet/login', body)).status).toBe(200)
    const again = await post('/api/auth/wallet/login', body)
    expect(again.status).toBe(400)
    expect(again.body).toEqual({ error: 'Challenge already used' })
  })

  it('a signature from another key is refused', async () => {
    const challenge = await challengeFor('alice')
    const r = await post('/api/auth/wallet/login', { username: 'alice', challenge, signature: signChallenge(userKey('bob'), challenge) })
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'Signature verification failed' })
    expect(cookieNamed(r, 'threespeak_wsession')).toBeUndefined()
  })

  it('a signature over different bytes is refused', async () => {
    const challenge = await challengeFor('alice')
    const signature = signChallenge(userKey('alice'), challenge + 'x')
    const r = await post('/api/auth/wallet/login', { username: 'alice', challenge, signature })
    expect(r.status).toBe(401)
  })

  it('garbage in the signature field is refused', async () => {
    const challenge = await challengeFor('alice')
    const r = await post('/api/auth/wallet/login', { username: 'alice', challenge, signature: 'not-a-signature' })
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'Signature verification failed' })
  })

  it('a key below the posting threshold is not enough', async () => {
    const challenge = await challengeFor('erin')
    const r = await post('/api/auth/wallet/login', { username: 'erin', challenge, signature: signChallenge(lowWeightKey, challenge) })
    expect(r.status).toBe(401)
  })

  it('an account that does not exist cannot sign in', async () => {
    const challenge = await challengeFor('nobody')
    const r = await post('/api/auth/wallet/login', { username: 'nobody', challenge, signature: signChallenge(userKey('nobody'), challenge) })
    expect(r.status).toBe(401)
  })

  it('a challenge issued for one account does not sign in another', async () => {
    const challenge = await challengeFor('alice')
    const r = await post('/api/auth/wallet/login', { username: 'bob', challenge, signature: signChallenge(userKey('bob'), challenge) })
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'Invalid or expired challenge' })
  })

  it('a challenge with an edited expiry or a forged one is refused', async () => {
    const challenge = await challengeFor('alice')
    const parts = challenge.split(':')
    parts[2] = String(Number(parts[2]) + 3600 * 1000)
    const edited = parts.join(':')
    const r1 = await post('/api/auth/wallet/login', { username: 'alice', challenge: edited, signature: signChallenge(userKey('alice'), edited) })
    expect(r1.status).toBe(400)

    const exp = Date.now() + 60000
    const forged = `3speak-login:alice:${exp}:${'0'.repeat(24)}:${crypto.createHmac('sha256', 'guess').update('x').digest('hex')}`
    const r2 = await post('/api/auth/wallet/login', { username: 'alice', challenge: forged, signature: signChallenge(userKey('alice'), forged) })
    expect(r2.status).toBe(400)
    expect(r2.body).toEqual({ error: 'Invalid or expired challenge' })
  })

  it('missing fields are a bad request', async () => {
    for (const body of [{}, { username: 'alice' }, { username: 'alice', challenge: 'c' }, { username: 'alice', signature: 's' }]) {
      const r = await post('/api/auth/wallet/login', body)
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid request' })
    }
  })

  it('logout clears the session with and without the domain', async () => {
    const r = await post('/api/auth/wallet/logout', {}, as('alice'))
    expect(r.body).toEqual({ success: true })
    const cleared = r.cookies.filter((c) => c.startsWith('threespeak_wsession=;'))
    expect(cleared).toHaveLength(2)
    expect(cleared.some((c) => c.includes('Domain=.3speak.tv'))).toBe(true)
    expect(cleared.some((c) => !c.includes('Domain='))).toBe(true)
  })
})

describe('HiveSigner session', () => {
  it('a token HiveSigner confirms opens a wallet session for its owner', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [{ url: 'https://hivesigner.com/api/me', method: 'POST', json: { name: 'bob' } }] })
    const r = await post('/api/auth/hivesigner/session', {}, { headers: { Authorization: 'Bearer hs-token' } })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ success: true, username: 'bob' })
    expect(cookieNamed(r, 'threespeak_wsession')).toMatch(/HttpOnly/)
  })

  it('a token for a name that is not a Hive account is refused', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [{ url: 'https://hivesigner.com/api/me', method: 'POST', json: { name: 'Not A Name' } }] })
    const r = await post('/api/auth/hivesigner/session', { token: 'hs-token' })
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'HiveSigner token is invalid or expired' })
  })
})

describe('ButrAuth session', () => {
  it('/me reports the Hive account behind the cookie', async () => {
    const r = await api.request('/api/manteauth/me', { cookies: { threespeak_session: 'test-butr:alice' } })
    expect(r.body).toEqual({ username: 'alice', incubation: false, handle: null })
  })

  it('/me keeps a warm-up user signed in without a Hive account', async () => {
    const r = await api.request('/api/manteauth/me', { cookies: { threespeak_session: 'test-butr-incubating:sunny' } })
    expect(r.body).toEqual({ username: null, incubation: true, handle: 'sunny' })
  })

  it('start hands back the auth URL and keeps the PKCE verifier in an httpOnly cookie', async () => {
    const r = await post('/api/manteauth/start', { redirect_uri: 'https://3speak.tv/callback', signup: true, invite: 'ABCDE12345' })
    expect(r.status).toBe(200)
    const url = new URL(r.body.url)
    expect(url.searchParams.get('screen_hint')).toBe('signup')
    expect(url.searchParams.get('invite')).toBe('abcde12345')
    expect(cookieNamed(r, 'manteauth_pkce')).toMatch(/HttpOnly; Secure; SameSite=Lax/)
  })

  it('an exchange that ButrAuth cannot confirm sets no session', async () => {
    const r = await post('/api/manteauth/exchange', { code: 'c', redirect_uri: 'https://3speak.tv/cb' }, { cookies: { manteauth_pkce: 'v' } })
    expect(r.status).toBe(401)
    expect(cookieNamed(r, 'threespeak_session')).toBeUndefined()
    expect(cookieNamed(r, 'threespeak_wsession')).toBeUndefined()
  })
})

describe('watch token', () => {
  it('names the proven viewer and one video, signed with the watch secret', async () => {
    const r = await post('/api/watch/token', { owner: 'Bob', permlink: 'My-Video' }, as('alice'))
    expect(r.status).toBe(200)
    expect(r.body.viewer).toBe('alice')
    const [payload, sig] = r.body.token.split('.')
    const expected = crypto.createHmac('sha256', api.env.WATCH_TOKEN_SECRET).update(payload).digest('base64url')
    expect(sig).toBe(expected)
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    expect(claims).toMatchObject({ v: 'alice', a: '3speak', p: 'bob/my-video' })
    expect(claims.e - Date.now() / 1000).toBeGreaterThan(500)
    expect(claims.e - Date.now() / 1000).toBeLessThanOrEqual(600)
  })

  it('refuses a malformed owner or permlink', async () => {
    for (const body of [{ owner: 'b', permlink: 'v' }, { owner: 'bob', permlink: '' }, { owner: 'bob', permlink: 'a/b' }]) {
      const r = await post('/api/watch/token', body, as('alice'))
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid owner/permlink' })
    }
  })
})

describe('editor token', () => {
  const verify = (token) => {
    const [v, body, sig] = token.split('.')
    expect(v).toBe('v1')
    expect(sig).toBe(crypto.createHmac('sha256', api.env.EDITOR_TOKEN_SECRET).update(body).digest('hex'))
    return JSON.parse(Buffer.from(body, 'base64url').toString())
  }

  it('gives a free account one project for a week when the checker cannot be reached', async () => {
    const r = await post('/api/editor-token', {}, as('alice'))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ user: 'alice', pro: false, maxProjects: 1, ttlHours: 168 })
    expect(verify(r.body.token)).toMatchObject({ u: 'alice', pro: false })
  })

  it('gives a Pro account three projects for thirty days', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [{ url: 'https://checker.test.invalid/premium/bob', json: { premium: true } }] })
    const r = await post('/api/editor-token', { user: 'bob' }, as('bob'))
    expect(r.body).toMatchObject({ user: 'bob', pro: true, maxProjects: 3, ttlHours: 720 })
    expect(verify(r.body.token).pro).toBe(true)
  })

  it('picks the requested account among proven sessions and never adds one', async () => {
    const cookies = { threespeak_session: 'test-butr:alice', threespeak_wsession: walletSession(api.env.SESSION_SIGNING_SECRET, 'bob') }
    expect((await post('/api/editor-token', { user: 'bob' }, { cookies })).body.user).toBe('bob')
    expect((await post('/api/editor-token', { user: 'alice' }, { cookies })).body.user).toBe('alice')
    const other = await post('/api/editor-token', { user: 'carol' }, { cookies })
    expect(other.status).toBe(401)
    expect(other.body).toEqual({ error: 'sign-in-needed' })
  })
})

describe('delegated signers', () => {
  it('OpenPods: signs a hangouts challenge for the signed-in account with the service key', async () => {
    const challenge = 'hivehangouts:alice:1700000000:abcdef'
    const r = await post('/api/openpods/sign-challenge', { challenge }, as('alice'))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ success: true, username: 'alice' })
    expect(signerOf(r.body.signature, challenge)).toBe(servicePublic)
  })

  it('OpenPods: refuses a challenge for another account, a bad shape, or no grant', async () => {
    const other = await post('/api/openpods/sign-challenge', { challenge: 'hivehangouts:bob:1:ab' }, as('alice'))
    expect(other.status).toBe(403)
    expect(other.body).toEqual({ error: 'Signed in as a different account' })
    for (const challenge of ['hivehangouts:alice:1:XYZ', 'login:alice:1:ab', 'hivehangouts:alice:1:ab\n']) {
      const r = await post('/api/openpods/sign-challenge', { challenge }, as('alice'))
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error: 'Invalid challenge' })
    }
    const noGrant = await post('/api/openpods/sign-challenge', { challenge: 'hivehangouts:carol:1:ab' }, as('carol'))
    expect(noGrant.status).toBe(403)
    expect(noGrant.body).toEqual({ error: 'Authorization required' })
  })

  it('Snapie chat: signs only a UUID', async () => {
    const challenge = crypto.randomUUID()
    const r = await post('/api/snapie-chat/sign-challenge', { challenge }, as('alice'))
    expect(r.status).toBe(200)
    expect(signerOf(r.body.signature, challenge)).toBe(servicePublic)
    const bad = await post('/api/snapie-chat/sign-challenge', { challenge: 'deadbeef' }, as('alice'))
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'Invalid challenge' })
  })

  it('ad preferences: builds the message itself and validates the inputs', async () => {
    const r = await post('/api/ads/opt-out-signature', { adsEnabled: true, rollsEnabled: false, communitySharePct: 10 }, as('alice'))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ success: true, username: 'alice', communitySharePct: 10 })
    const message = `3speak-ads|creator-prefs|alice|no-rolls|10|${r.body.timestamp}`
    expect(signerOf(r.body.signature, message)).toBe(servicePublic)

    const bad = [
      [{}, 'adsEnabled must be true or false'],
      [{ adsEnabled: 'false' }, 'adsEnabled must be true or false'],
      [{ adsEnabled: true, rollsEnabled: 'no' }, 'rollsEnabled must be true or false'],
      [{ adsEnabled: true, communitySharePct: 51 }, 'communitySharePct must be a whole number between 0 and 50'],
      [{ adsEnabled: true, communitySharePct: 2.5 }, 'communitySharePct must be a whole number between 0 and 50'],
      [{ adsEnabled: true, communitySharePct: -1 }, 'communitySharePct must be a whole number between 0 and 50'],
    ]
    for (const [body, error] of bad) {
      const res = await post('/api/ads/opt-out-signature', body, as('alice'))
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error })
    }
  })

  it('ad preferences: an account without the posting grant is told why', async () => {
    const r = await post('/api/ads/opt-out-signature', { adsEnabled: false }, as('carol'))
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/needs @threespeak posting authority/)
  })

  it('viewer rewards: needs a real boolean', async () => {
    const ok = await post('/api/ads/viewer-signature', { rewardsEnabled: true }, as('alice'))
    expect(signerOf(ok.body.signature, `3speak-ads|viewer-prefs|alice|on|${ok.body.timestamp}`)).toBe(servicePublic)
    const bad = await post('/api/ads/viewer-signature', { rewardsEnabled: 1 }, as('alice'))
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'rewardsEnabled must be true or false' })
  })

  it('captions: signs the session user, never a name from the body', async () => {
    const sha = 'ab'.repeat(32)
    const r = await post('/api/captions/edit-signature', { username: 'bob', permlink: 'my-video', lang: 'pt-BR', srtSha256: sha }, as('alice'))
    expect(r.body.username).toBe('alice')
    expect(signerOf(r.body.signature, `3speak-captions|edit|alice|my-video|pt-br|${sha}|${r.body.timestamp}`)).toBe(servicePublic)
    for (const body of [{ permlink: 'My Video', lang: 'en', srtSha256: sha }, { permlink: 'v', lang: 'english', srtSha256: sha }, { permlink: 'v', lang: 'en', srtSha256: 'abc' }]) {
      expect((await post('/api/captions/edit-signature', body, as('alice'))).status).toBe(400)
    }
  })

  it('comment pins: the named account must be one this request is signed in as', async () => {
    const mismatch = await post('/api/comments/pin-signature', { username: 'bob', permlink: 'v', comment: 'c', pinned: true }, as('alice'))
    expect(mismatch.status).toBe(401)
    expect(mismatch.body).toEqual({ error: 'Unauthorized', reason: 'not_signed_in_as' })
    const ok = await post('/api/comments/pin-signature', { username: 'alice', permlink: 'v', comment: 'c', pinned: false }, as('alice'))
    expect(signerOf(ok.body.signature, `3speak-comments|unpin|alice|v|c|${ok.body.timestamp}`)).toBe(servicePublic)
    const noAction = await post('/api/comments/pin-signature', { permlink: 'v', comment: 'c' }, as('alice'))
    expect(noAction.status).toBe(400)
  })

  it('hiding a tip: needs a 40-hex transaction id', async () => {
    const trx = 'f'.repeat(40)
    const ok = await post('/api/supports/hide-signature', { trx_id: trx.toUpperCase(), hidden: true }, as('alice'))
    expect(signerOf(ok.body.signature, `3speak-supports|hide|alice|${trx}|${ok.body.timestamp}`)).toBe(servicePublic)
    expect((await post('/api/supports/hide-signature', { trx_id: 'xyz', hidden: true }, as('alice'))).status).toBe(400)
  })

  it('social verification: validates action, platform and name', async () => {
    const ok = await post('/api/verify/sign', { action: 'check', platform: 'youtube', platform_username: ' Chan ' }, as('alice'))
    expect(ok.body.hive_username).toBe('alice')
    expect(signerOf(ok.body.signature, `3speak-social-verifier|check|alice|youtube|Chan|${ok.body.timestamp}`)).toBe(servicePublic)
    const cases = [
      [{ action: 'delete', platform: 'youtube', platform_username: 'x' }, 'invalid action'],
      [{ action: 'check', platform: 'You Tube', platform_username: 'x' }, 'invalid platform'],
      [{ action: 'check', platform: 'youtube', platform_username: 'a|b' }, 'invalid platform_username'],
      [{ action: 'check', platform: 'youtube', platform_username: '' }, 'invalid platform_username'],
    ]
    for (const [body, error] of cases) {
      const r = await post('/api/verify/sign', body, as('alice'))
      expect(r.status).toBe(400)
      expect(r.body).toEqual({ error })
    }
  })

  it('identity and announcement vouches need no posting grant', async () => {
    const id = await post('/api/ads/identity-signature', {}, as('carol'))
    expect(id.body).toMatchObject({ success: true, username: 'carol', vouched: true })
    expect(signerOf(id.body.signature, `3speak-ads|mine-vouch|carol|${id.body.timestamp}`)).toBe(servicePublic)
    const reply = await post('/api/announcements/reply-signature', { number: 7 }, as('carol'))
    expect(signerOf(reply.body.signature, `3speak-announce|reply-vouch|carol|7|${reply.body.timestamp}`)).toBe(servicePublic)
  })

  it('a warm-up user is vouched for as ~handle, which can never be a Hive name', async () => {
    const r = await post('/api/announcements/read-signature', {}, { cookies: { threespeak_session: 'test-butr-incubating:sunny' } })
    expect(r.body.username).toBe('~sunny')
  })

  it('the signatures verify against the service key, not the user key', async () => {
    const r = await post('/api/ads/identity-signature', {}, as('alice'))
    const digest = cryptoUtils.sha256(Buffer.from(`3speak-ads|mine-vouch|alice|${r.body.timestamp}`, 'utf8'))
    expect(Signature.fromString(r.body.signature).recover(digest).toString()).not.toBe(userKey('alice').createPublic().toString())
  })
})

describe('gated-video guest list', () => {
  const embed = (permlink, json, status = 200) => ({ url: `https://embed.test.invalid/video/${permlink}`, status, json })
  const gate = (path, json, method = 'GET') => ({ url: `https://gate.test.invalid/internal/videos/${path}`, method, json })

  it('only the owner of the video may read or change it', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [embed('bobs-video', { owner: 'bob', gated: true })] })
    for (const method of ['GET', 'PATCH']) {
      const json = method === 'PATCH' ? { allowlist: ['carol'] } : undefined
      const r = await api.request('/api/gated/bobs-video/allowlist', { method, json, ...as('alice') })
      expect(r.status).toBe(403)
      expect(r.body).toEqual({ error: 'You can only manage guest lists on your own videos' })
    }
  })

  it('reads and replaces the owner\'s list through the gate', async () => {
    api.setFixtures({
      ...FIXTURES,
      fetch: [
        embed('my-video', { owner: 'alice', gated: true, gate_video_id: 'g1' }),
        gate('g1', { allowlist: ['bob'] }),
        gate('g1/allowlist', { allowlist: ['bob', 'carol'] }, 'PATCH'),
      ],
    })
    const get = await api.request('/api/gated/my-video/allowlist', as('alice'))
    expect(get.body).toEqual({ allowlist: ['bob'], registered: true })
    const patch = await api.request('/api/gated/my-video/allowlist', { method: 'PATCH', json: { allowlist: ['@Bob', 'carol', 'bob'] }, ...as('alice') })
    expect(patch.body).toEqual({ success: true, allowlist: ['bob', 'carol'] })
  })

  it('validates the list before contacting the gate', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [embed('my-video', { owner: 'alice', gated: true })] })
    const cases = [
      [{ allowlist: 'bob' }, 'allowlist must be an array of at most 500 usernames'],
      [{ allowlist: Array.from({ length: 501 }, (_, i) => `user${i}`) }, 'allowlist must be an array of at most 500 usernames'],
      [{ allowlist: ['bob', 'no spaces'] }, '"no spaces" is not a valid Hive account name'],
    ]
    for (const [json, error] of cases) {
      api.clearNetLog()
      const r = await api.request('/api/gated/my-video/allowlist', { method: 'PATCH', json, ...as('alice') })
      expect(r.status).toBe(422)
      expect(r.body).toEqual({ error })
      expect(api.netLog().some((e) => e.url?.startsWith('https://gate.test.invalid'))).toBe(false)
    }
  })

  it('refuses an odd permlink, a missing video, a public video, and an unreachable embed API', async () => {
    api.setFixtures({ ...FIXTURES, fetch: [embed('gone', { error: 'nope' }, 404), embed('public-video', { owner: 'alice', gated: false })] })
    const bad = await api.request('/api/gated/-bad/allowlist', as('alice'))
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'invalid permlink' })
    const gone = await api.request('/api/gated/gone/allowlist', as('alice'))
    expect(gone.status).toBe(404)
    expect(gone.body).toEqual({ error: 'video not found' })
    const open = await api.request('/api/gated/public-video/allowlist', as('alice'))
    expect(open.status).toBe(400)
    expect(open.body).toEqual({ error: 'That video is not members-only' })
    const down = await api.request('/api/gated/unknown-video/allowlist', as('alice'))
    expect(down.status).toBe(502)
    expect(down.body).toEqual({ error: 'could not verify video ownership' })
  })
})
