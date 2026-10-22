// Offline stand-in for @mantequilla-soft/butrauth-client (see ../preload.cjs).
//
// Access tokens are strings the tests make up:
//   'test-butr:<hiveUsername>'          a signed-in Hive account
//   'test-butr-incubating:<handle>'     a warm-up user with no Hive account
// Anything else fails verification, as a forged or expired token would. Every call
// that would reach the ButrAuth service fails like an outage.

function offline() {
  const err = new Error('[fake butrauth] network disabled in tests')
  err.code = 'ECONNREFUSED'
  return err
}

export class ButrAuthClient {
  constructor(opts) {
    this.opts = opts
  }

  async getPublicKey() {
    return 'fake-butrauth-public-key'
  }

  async verifyAccessToken(token) {
    const s = String(token || '')
    let m = /^test-butr:([a-z][a-z0-9.-]{2,15})$/.exec(s)
    if (m) return { hiveUsername: m[1], userId: `user-${m[1]}`, incubation: false, handle: null }
    m = /^test-butr-incubating:([a-z0-9][a-z0-9.-]{0,63})$/.exec(s)
    if (m) return { hiveUsername: null, userId: `user-~${m[1]}`, incubation: true, handle: m[1] }
    throw new Error('invalid token')
  }

  createAuthRequest({ redirectUri, scope, state, invite }) {
    const url = new URL('https://butrauth.test.invalid/authorize')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', scope)
    url.searchParams.set('state', state)
    if (invite) url.searchParams.set('invite', invite)
    return { url: url.href, codeVerifier: 'fake-verifier-' + Math.random().toString(36).slice(2) }
  }

  async exchangeCode() { throw offline() }
  async getInvite() { throw offline() }
  async getReferralLinks() { throw offline() }
  async getReferralPeople() { throw offline() }
}
