const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')
const helmet = require('helmet')
const crypto = require('crypto')
const { Client, PrivateKey, PublicKey, Signature, cryptoUtils } = require('@hiveio/dhive')

// ButrAuth SDK is ESM-only — load via dynamic import at startup.
let butr = null
async function initButrAuth() {
  const { ButrAuthClient } = await import('@mantequilla-soft/butrauth-client')
  butr = new ButrAuthClient({
    baseUrl: MANTEAUTH_URL,
    clientId: MANTEAUTH_CLIENT_ID,
    clientSecret: MANTEAUTH_CLIENT_SECRET
  })
  console.log('[INFO] ButrAuth SDK initialised')
}

const app = express()
const PORT = process.env.SERVER_PORT || 4020

const POSTING_WIF = process.env.THREESPEAK_POSTING_WIF
const HIVE_ACCOUNT = process.env.THREESPEAK_HIVE_ACCOUNT || 'badadib'
// Share of ad revenue split between the creator and the community they posted in.
// MUST match AD_CREATOR_POOL_PCT on the checker: this endpoint signs the message the
// checker verifies, so a disagreement would produce signatures it rejects.
const AD_CREATOR_POOL_PCT = Number(process.env.AD_CREATOR_POOL_PCT) || 50
// Must equal AD_DEFAULT_COMMUNITY_PCT on the checker. Both sides build the signed
// message, so a disagreement here signs one split and stores another.
// 🚨 Zero on purpose: sharing ad income with a community is opt IN. This was 25,
// which quietly donated half of every creator's share for them. Changing it on one
// side only would sign one split and store another, so the checker and BOTH API
// servers move together or not at all.
const AD_DEFAULT_COMMUNITY_PCT = Number.isInteger(Number(process.env.AD_DEFAULT_COMMUNITY_PCT))
  ? Number(process.env.AD_DEFAULT_COMMUNITY_PCT)
  : 0
// Shared app key (same one the embed TUS upload uses) — authenticates wallet
// logins (Keychain/HiveAuth/PeakVault/Ledger) on the post-creation path, which
// can't present a token/cookie. Same trust level the upload pipeline already
// relies on; the path is narrowed to post ops only (see /api/broadcast).
const EMBED_API_KEY = process.env.EMBED_API_KEY || ''
const MANTEAUTH_CLIENT_ID = process.env.MANTEAUTH_CLIENT_ID || 'threespeak'
const MANTEAUTH_CLIENT_SECRET = process.env.MANTEAUTH_CLIENT_SECRET
const MANTEAUTH_URL = process.env.MANTEAUTH_URL || 'https://auth.okinoko.io'

// Secret for signing 3speak's own wallet session tokens + SIWH login challenges.
// Prefer a dedicated env var; otherwise derive a stable, domain-separated key
// from the ButrAuth client secret so this works with no new config. Empty (no
// secret at all) → wallet sessions are disabled and the app-key path stays.
const SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET
  || (MANTEAUTH_CLIENT_SECRET
    ? crypto.createHash('sha256').update('3speak-wallet-session|' + MANTEAUTH_CLIENT_SECRET).digest('hex')
    : '')

// Legacy app-key auth on /api/broadcast: the PUBLIC app key + a CLAIMED username.
// Kept ON by default for backwards-compat; set ALLOW_APPKEY_AUTH=0 to require a
// SIWH wallet session cookie instead (the secure path — see /api/auth/wallet/*).
const ALLOW_APPKEY_AUTH = process.env.ALLOW_APPKEY_AUTH !== '0'

// Allowed origins for CORS — only the trusted 3speak frontends
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://3speak.tv,https://3speak.okinoko.io,http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean)

// Hive client
const client = new Client(['https://api.hive.blog', 'https://api.deathwing.me'], {
  timeout: 4000,
  failoverThreshold: 3
})

app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: false, // Set on the frontend, not the API
}))

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin (server-to-server, curl) AND whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  credentials: true
}))

app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())

// === Rate limits ===
const baseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
})
const exchangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
})
const broadcastLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
})

// Verify a ButrAuth access token locally via the SDK. Returns claims on
// success or null on any failure (bad signature, expired, wrong client, etc).
async function verifyManteAuthToken(token) {
  if (!butr) return null
  try {
    return await butr.verifyAccessToken(token)
  } catch {
    return null
  }
}

// === Session cookies (3speak's own session, not ManteAuth's) ===
const SESSION_COOKIE_NAME = 'threespeak_session'
const PKCE_COOKIE_NAME = 'manteauth_pkce'
const SESSION_TTL_MS = 60 * 60 * 1000 // 1 hour, matches access token

function setSessionCookie(res, accessToken, username) {
  res.cookie(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/'
  })
  // Non-httpOnly username cookie so the frontend can read who is logged in (no token leak)
  res.cookie('threespeak_user', username, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/'
  })
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
  res.clearCookie('threespeak_user', { path: '/' })
  // Also clear any stale PKCE cookie so a fresh /start is required
  res.clearCookie(PKCE_COOKIE_NAME, { path: '/' })
}

// === ButrAuth refresh token (RFC 6749 §6) ===
// The access token above lives ONE HOUR. Without this the session simply ended
// there and every proxied op 401'd, because /api/broadcast could no longer tell
// who the user was. The refresh token is long-lived, httpOnly, and ROTATED on
// every use — so it is replaced on each refresh and a replay of the old value
// revokes the whole chain server-side.
const REFRESH_COOKIE_NAME = 'threespeak_refresh'
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: REFRESH_TTL_MS, path: '/'
  })
}
function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' })
}

// Call ButrAuth's token endpoint directly. The published SDK (0.2.0) has no
// refresh grant and its exchangeCode drops `refresh_token`, so both flows go
// through here; swap to client.refreshAccessToken() once a newer SDK ships.
async function butrTokenRequest(body) {
  const r = await fetch(`${MANTEAUTH_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, client_id: MANTEAUTH_CLIENT_ID, client_secret: MANTEAUTH_CLIENT_SECRET })
  })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

/**
 * Resolve the ButrAuth user for a request, transparently refreshing an expired
 * access token. Returns the Hive username, or null when there is no usable
 * session. On a successful refresh the rotated tokens are written back as
 * cookies, so the caller's response carries the renewed session.
 */
async function resolveButrUser(req, res) {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME]
  if (cookieToken) {
    const tokenData = await verifyManteAuthToken(cookieToken)
    if (tokenData?.hiveUsername) return tokenData.hiveUsername
  }
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]
  if (!refreshToken) {
    if (cookieToken) clearSessionCookie(res) // expired with nothing to renew from
    return null
  }
  try {
    const { ok, data } = await butrTokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
    if (!ok || !data.access_token) {
      // Refused (expired, revoked, or a detected replay) — drop both cookies so
      // the user is cleanly logged out instead of retrying a dead token forever.
      clearRefreshCookie(res)
      clearSessionCookie(res)
      return null
    }
    setSessionCookie(res, data.access_token, data.username)
    if (data.refresh_token) setRefreshCookie(res, data.refresh_token)
    return data.username
  } catch (err) {
    console.warn('[butrauth] refresh failed:', err.message)
    return null // transient (ButrAuth down): keep the cookies, retry next request
  }
}

function setPkceCookie(res, verifier) {
  // httpOnly cookie carrying the PKCE verifier across the auth redirect.
  // 2 hours — the verifier is set at the START of the flow, so it must outlive
  // a full signup: reading key warnings, saving keys to a password manager,
  // captcha, the on-chain account creation wait, then the redirect back. The
  // verifier is single-use (cleared on exchange) and httpOnly, so a long TTL is
  // low-risk; the authorization code it pairs with still expires in ~60s.
  res.cookie(PKCE_COOKIE_NAME, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/'
  })
}

function clearPkceCookie(res) {
  res.clearCookie(PKCE_COOKIE_NAME, { path: '/' })
}

// === Wallet ("Sign in with Hive") sessions =================================
// Wallet logins (Keychain/HiveAuth/PeakVault/Ledger) can't present a ButrAuth
// cookie or a HiveSigner token, so historically /api/broadcast trusted the
// PUBLIC app key + a claimed username (anyone could impersonate any opted-in
// user). Instead, the user signs a server-issued nonce with their POSTING key
// once; we verify it against their on-chain posting authority and mint an
// httpOnly session cookie. All subsequent proxied broadcasts trust that cookie.
// Colons delimit our tokens/challenges — a Hive username never contains one.
const WSESSION_COOKIE_NAME = 'threespeak_wsession'
const WSESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days ("remember me"); stateless token, so no per-session revocation — rotate SESSION_SIGNING_SECRET to invalidate all at once
const SIWH_CHALLENGE_TTL_MS = 5 * 60 * 1000     // 5 minutes to sign
const HIVE_USER_RE = /^[a-z][a-z0-9.-]{2,15}$/

// Session token = "v1:<user>:<expMs>:<hmac>"; HMAC over "<user>:<expMs>".
function mintWalletSession(username) {
  const exp = Date.now() + WSESSION_TTL_MS
  const body = `${username}:${exp}`
  const mac = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(body).digest('hex')
  return `v1:${body}:${mac}`
}
function verifyWalletSession(token) {
  if (!token || !SESSION_SIGNING_SECRET) return null
  const parts = String(token).split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  const [, username, expStr, mac] = parts
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null
  const expected = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(`${username}:${expStr}`).digest('hex')
  const a = Buffer.from(mac); const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return username
}
// `domain` makes the session readable across 3speak.tv subdomains. Without it
// the cookie is host-only, so a session minted on preview.3speak.tv is never
// sent to gate.3speak.tv — and the gate identifies the viewer from this cookie,
// so gated playback would show the paywall to everyone, Pro subscribers
// included. SameSite=lax is already satisfied: the subdomains are same-site.
//
// Existing host-only cookies keep working, so nobody is logged out; new logins
// get a domain cookie. A browser holding both sends both, and verifyWalletSession
// checks an HMAC, so either one satisfies it.
const WSESSION_COOKIE_DOMAIN = process.env.WSESSION_COOKIE_DOMAIN || '.3speak.tv'
function setWalletSessionCookie(res, token) {
  res.cookie(WSESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: WSESSION_TTL_MS, path: '/',
    ...(WSESSION_COOKIE_DOMAIN ? { domain: WSESSION_COOKIE_DOMAIN } : {})
  })
}
function clearWalletSessionCookie(res) {
  // Cleared with AND without the domain: a browser may still hold a host-only
  // cookie from before this change, and clearing only the domain form would
  // leave the old one behind and keep the user silently logged in.
  if (WSESSION_COOKIE_DOMAIN) {
    res.clearCookie(WSESSION_COOKIE_NAME, { path: '/', domain: WSESSION_COOKIE_DOMAIN })
  }
  res.clearCookie(WSESSION_COOKIE_NAME, { path: '/' })
}

// Challenge = "3speak-login:<user>:<expMs>:<rand>:<hmac>". Self-authenticating
// (the HMAC binds it to us; the exp bounds replay) so no server-side store is
// needed. The shape is obviously not a serialized Hive tx, so a captured
// signature can never be replayed on-chain.
function issueSiwhChallenge(username) {
  const exp = Date.now() + SIWH_CHALLENGE_TTL_MS
  const rand = crypto.randomBytes(12).toString('hex')
  const body = `${username}:${exp}:${rand}`
  const mac = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update('siwh:' + body).digest('hex')
  return `3speak-login:${body}:${mac}`
}
// Validate a challenge's shape, freshness and HMAC. Returns { rand, exp } on
// success (so the caller can mark the nonce consumed) or null on any failure.
function parseSiwhChallenge(challenge, username) {
  const parts = String(challenge || '').split(':')
  if (parts.length !== 5 || parts[0] !== '3speak-login') return null
  const [, user, expStr, rand, mac] = parts
  if (user !== username) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null
  const expected = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(`siwh:${user}:${expStr}:${rand}`).digest('hex')
  const a = Buffer.from(mac); const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return { rand, exp }
}

// Single-use nonce tracking — defeats replay of a captured (challenge, signature)
// pair within the challenge's validity window. Keyed by the random nonce; entries
// self-expire at the challenge's own expiry. Check-and-set is atomic under Node's
// single-threaded event loop (no await between has() and set()).
const consumedSiwhNonces = new Map() // rand -> expiryMs
function consumeSiwhNonce(rand, expMs) {
  const now = Date.now()
  for (const [k, exp] of consumedSiwhNonces) if (exp <= now) consumedSiwhNonces.delete(k)
  if (consumedSiwhNonces.has(rand)) return false
  consumedSiwhNonces.set(rand, expMs)
  return true
}

// Recover the signer's public key from the signature over sha256(challenge) —
// all wallet providers sign that hash — and require it to be a key in the
// account's POSTING authority (weight >= threshold). Forging a valid signature
// therefore requires actually controlling one of the account's posting keys.
async function verifySiwhSignature(username, challenge, signature) {
  let recovered
  try {
    recovered = Signature.fromString(signature).recover(cryptoUtils.sha256(challenge)).toString()
  } catch {
    return false
  }
  const [account] = await client.database.getAccounts([username])
  if (!account) return false
  const threshold = account.posting.weight_threshold
  return (account.posting.key_auths || []).some(([k, w]) => k === recovered && w >= threshold)
}

// === Custom_json operation whitelist ===
// account_update2 is allowed ONLY to set posting_json_metadata (profile-level
// metadata, e.g. a user's 3Speak interests) — broadcastAsThreespeak enforces
// that it carries no owner/active/posting/memo_key or json_metadata, so posting
// authority is sufficient and it can never touch keys or active-auth metadata.
const ALLOWED_OPS = ['vote', 'comment', 'delete_comment', 'comment_options', 'custom_json', 'claim_reward_balance', 'account_update2']

const ALLOWED_CUSTOM_JSON_IDS = new Set([
  // Hive standard
  'follow',
  'notify',
  // 3Speak playlist operations
  '3speak_playlist_create',
  '3speak_playlist_add',
  '3speak_playlist_remove',
  '3speak_playlist_reorder',
  '3speak_playlist_update',
  '3speak_playlist_delete',
  // Crowd-sourced viewer tag, broadcast in the same tx as a vote (see the app's
  // voteWithAioha). Low-stakes topic label; posting-auth only.
  '3speak-viewer-tag',
  // Community subscribe/unsubscribe. The `community` id ALSO carries admin/mod
  // actions (setRole, mutePost, flagPost, updateProps, …) which must never be
  // proxied under @threespeak's delegated posting key — so the validation below
  // restricts this id to a plain subscribe/unsubscribe (the user's own action).
  'community',
])

// custom_json ids whose payload we further restrict to specific actions. The
// json is a stringified ["<action>", {...}] tuple; only these first-element
// actions are allowed for the given id.
const CUSTOM_JSON_ACTION_WHITELIST = {
  community: new Set(['subscribe', 'unsubscribe']),
}

const OP_USER_FIELD = {
  vote: 'voter',
  comment: 'author',
  delete_comment: 'author',
  comment_options: 'author',
  claim_reward_balance: 'account',
  account_update2: 'account',
}

// =====================================================================
// POST /api/manteauth/start — generate PKCE verifier server-side, set
// httpOnly cookie, return the auth URL with the matching code_challenge
// =====================================================================
app.post('/api/manteauth/start', baseLimiter, (req, res) => {
  try {
    const { redirect_uri, state, signup } = req.body
    if (!redirect_uri || typeof redirect_uri !== 'string') {
      return res.status(400).json({ error: 'Invalid request' })
    }
    if (!butr) return res.status(503).json({ error: 'ButrAuth not ready' })

    res.set('Cache-Control', 'no-store')

    const { url, codeVerifier } = butr.createAuthRequest({
      redirectUri: redirect_uri,
      scope: 'posting',
      state: state || ''
    })
    setPkceCookie(res, codeVerifier)

    // signup:true → tell ButrAuth to jump straight to account creation.
    const finalUrl = signup ? url + (url.includes('?') ? '&' : '?') + 'screen_hint=signup' : url

    res.json({ url: finalUrl })
  } catch (err) {
    console.error('Start error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// =====================================================================
// POST /api/manteauth/exchange — exchange auth code for an access token,
// set it as an httpOnly cookie, never expose it to the frontend.
// =====================================================================
app.post('/api/manteauth/exchange', exchangeLimiter, async (req, res) => {
  try {
    const { code, redirect_uri } = req.body
    const code_verifier = req.cookies?.[PKCE_COOKIE_NAME]
    const existingSession = req.cookies?.[SESSION_COOKIE_NAME]

    // Idempotency: if this request arrives without a PKCE verifier but the user
    // already has a valid session cookie, assume it's a double-invoke (e.g. React
    // StrictMode) and return the current session instead of erroring.
    if (!code_verifier && existingSession) {
      const decoded = await verifyManteAuthToken(existingSession)
      if (decoded?.hiveUsername) {
        return res.json({ username: decoded.hiveUsername })
      }
    }

    if (!code || !redirect_uri || !code_verifier) {
      return res.status(400).json({ error: 'Invalid request' })
    }
    if (!butr) return res.status(503).json({ error: 'ButrAuth not ready' })

    let tokens
    let refreshToken = null
    try {
      // Direct call so the response's refresh_token survives (the SDK drops it).
      // Any transport failure falls back to the SDK, which is the proven path.
      const { ok, data } = await butrTokenRequest({
        code,
        redirect_uri,
        code_verifier,
        grant_type: 'authorization_code'
      })
      if (!ok || !data.access_token) {
        clearPkceCookie(res)
        return res.status(401).json({ error: data.error || 'Token exchange failed' })
      }
      tokens = { accessToken: data.access_token, username: data.username }
      refreshToken = data.refresh_token || null
    } catch {
      try {
        tokens = await butr.exchangeCode({
          code,
          redirectUri: redirect_uri,
          codeVerifier: code_verifier
        })
      } catch (err) {
        clearPkceCookie(res)
        return res.status(401).json({ error: err.message || 'Token exchange failed' })
      }
    }
    clearPkceCookie(res)

    setSessionCookie(res, tokens.accessToken, tokens.username)
    // The access token lasts an hour; the refresh token renews it for 30 days
    // (see resolveButrUser). Without it the session died at the hour mark and
    // every proxied op 401'd.
    if (refreshToken) setRefreshCookie(res, refreshToken)
    // Belt and braces: also mint our own signed session, the same stateless
    // 30-day token wallet logins use (auth path 2 in /api/broadcast). It keeps
    // the user working even if a refresh is ever refused.
    const buser = String(tokens.username || '').toLowerCase()
    if (buser && SESSION_SIGNING_SECRET) setWalletSessionCookie(res, mintWalletSession(buser))
    res.json({ username: tokens.username })
  } catch (err) {
    console.error('Exchange error:', err.message)
    clearPkceCookie(res)
    res.status(500).json({ error: 'Exchange failed' })
  }
})

// GET /api/manteauth/me — return the current ManteAuth session info (username only)
app.get('/api/manteauth/me', baseLimiter, async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const decoded = await verifyManteAuthToken(token)
  if (!decoded?.hiveUsername) {
    clearSessionCookie(res)
    return res.status(401).json({ error: 'Unauthorized' })
  }
  res.json({ username: decoded.hiveUsername })
})

// POST /api/manteauth/logout — clear the session cookie
app.post('/api/manteauth/logout', baseLimiter, (req, res) => {
  console.log('[logout] clearing cookies for:', Object.keys(req.cookies || {}))
  clearSessionCookie(res)
  // A ButrAuth login also carries the refresh token and our own signed session —
  // clear both, or logging out would leave the user able to act.
  clearRefreshCookie(res)
  clearWalletSessionCookie(res)
  res.json({ success: true })
})

// =====================================================================
// POST /api/broadcast — broadcast posting-level operations
// Auth via the httpOnly session cookie (no Bearer token, no localStorage)
// =====================================================================
// Verify a HiveSigner access token by asking hivesigner.com who it belongs to.
// Returns the Hive username on success, or null on any failure/expiry.
async function verifyHiveSignerToken(token) {
  if (!token) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 4000)
  try {
    const resp = await fetch('https://hivesigner.com/api/me', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return data && data.name ? data.name : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// Shared broadcast flow — given a username resolved from EITHER the ButrAuth
// session cookie OR a verified HiveSigner token, validate the ops and broadcast
// them signed with @threespeak's posting key (accepted because the user granted
// @threespeak posting authority). Sends the HTTP response.
async function broadcastAsThreespeak(hiveUsername, operations, res) {
  if (!operations || !operations.length) {
    return res.status(400).json({ error: 'No operations provided' })
  }
  if (operations.length > 20) {
    return res.status(400).json({ error: 'Too many operations' })
  }
  if (!POSTING_WIF) {
    return res.status(500).json({ error: 'Server is not configured' })
  }

  // Verify user granted posting authority to our service account
  const [account] = await client.database.getAccounts([hiveUsername])
  if (!account) return res.status(403).json({ error: 'Authorization required' })
  const grant = account.posting.account_auths.find(([acc]) => acc === HIVE_ACCOUNT)
  if (!grant || grant[1] < account.posting.weight_threshold) {
    return res.status(403).json({ error: 'Authorization required' })
  }

  // Validate every operation
  for (const [opType, opData] of operations) {
    if (!ALLOWED_OPS.includes(opType)) {
      return res.status(400).json({ error: 'Operation not allowed' })
    }
    if (opType === 'custom_json') {
      const auths = opData.required_posting_auths || []
      if (!auths.includes(hiveUsername)) {
        return res.status(403).json({ error: 'Operation not allowed' })
      }
      if (!ALLOWED_CUSTOM_JSON_IDS.has(opData.id)) {
        return res.status(403).json({ error: 'custom_json id not allowed for this app' })
      }
      // For ids with a restricted action set (e.g. `community`), the payload's
      // first element must be an allowed action — so we never proxy the id's
      // more powerful admin/mod variants under @threespeak's posting key.
      const actionSet = CUSTOM_JSON_ACTION_WHITELIST[opData.id]
      if (actionSet) {
        let action = null
        try {
          const parsed = JSON.parse(opData.json)
          action = Array.isArray(parsed) ? parsed[0] : null
        } catch {
          return res.status(400).json({ error: 'Invalid custom_json payload' })
        }
        if (!actionSet.has(action)) {
          return res.status(403).json({ error: 'custom_json action not allowed for this app' })
        }
      }
    } else if (opType === 'account_update2') {
      // Posting authority may ONLY change posting_json_metadata. Reject any
      // field that would require active/owner auth so this can never become a
      // key-rotation or active-metadata oracle for @threespeak.
      if (opData.account !== hiveUsername) {
        return res.status(403).json({ error: 'Operation not allowed' })
      }
      if (opData.owner != null || opData.active != null || opData.posting != null || opData.memo_key != null) {
        return res.status(403).json({ error: 'account_update2 auth fields not allowed' })
      }
      if (opData.json_metadata != null && opData.json_metadata !== '') {
        return res.status(403).json({ error: 'account_update2 json_metadata not allowed (posting auth only)' })
      }
    } else {
      const field = OP_USER_FIELD[opType]
      if (field && opData[field] !== hiveUsername) {
        return res.status(403).json({ error: 'Operation not allowed' })
      }
    }
  }

  const key = PrivateKey.fromString(POSTING_WIF)
  const result = await client.broadcast.sendOperations(operations, key)
  return res.json({ success: true, result })
}

// === Wallet SIWH auth endpoints ===========================================
const walletAuthLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' }
})

// POST /api/auth/wallet/challenge — { username } → { challenge } to be signed.
app.post('/api/auth/wallet/challenge', walletAuthLimiter, (req, res) => {
  try {
    if (!SESSION_SIGNING_SECRET) return res.status(503).json({ error: 'Sessions not configured' })
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
    if (!HIVE_USER_RE.test(username)) return res.status(400).json({ error: 'Invalid username' })
    res.set('Cache-Control', 'no-store')
    return res.json({ challenge: issueSiwhChallenge(username) })
  } catch (err) {
    console.error('Wallet challenge error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/auth/wallet/login — { username, challenge, signature }. Verifies the
// signature against the account's posting authority and mints a session cookie.
app.post('/api/auth/wallet/login', walletAuthLimiter, async (req, res) => {
  try {
    if (!SESSION_SIGNING_SECRET) return res.status(503).json({ error: 'Sessions not configured' })
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
    const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge : ''
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : ''
    if (!HIVE_USER_RE.test(username) || !challenge || !signature) {
      return res.status(400).json({ error: 'Invalid request' })
    }
    const parsed = parseSiwhChallenge(challenge, username)
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid or expired challenge' })
    }
    if (!(await verifySiwhSignature(username, challenge, signature))) {
      return res.status(401).json({ error: 'Signature verification failed' })
    }
    // Burn the nonce only after the signature checks out, so a valid pair can
    // never be replayed to mint a second session.
    if (!consumeSiwhNonce(parsed.rand, parsed.exp)) {
      return res.status(400).json({ error: 'Challenge already used' })
    }
    setWalletSessionCookie(res, mintWalletSession(username))
    // Non-httpOnly hint cookie so the SPA can tell it has a session (no secret leaked).
    res.cookie('threespeak_user', username, {
      httpOnly: false, secure: true, sameSite: 'lax', maxAge: WSESSION_TTL_MS, path: '/'
    })
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, username })
  } catch (err) {
    console.error('Wallet login error:', err.message)
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /api/auth/hivesigner/session — trade a HiveSigner access token for the
// same session cookie the wallet flow mints.
//
// HiveSigner logins have no posting-key signature to give, so they cannot do the
// SIWH challenge/response. They were therefore the one login type with no
// session cookie at all — and since the gate identifies gated-video viewers from
// that cookie, a HiveSigner user looked anonymous forever and hit the paywall on
// videos they were entitled to, 3Speak Pro subscribers included.
//
// The token is proof enough on its own: hivesigner.com tells us whose it is, and
// the user had to authenticate there to hold it. Rate-limited with the other
// wallet auth routes, since it takes an unauthenticated token and calls out.
app.post('/api/auth/hivesigner/session', walletAuthLimiter, async (req, res) => {
  if (!SESSION_SIGNING_SECRET) {
    return res.status(503).json({ error: 'Sessions are not configured on this server' })
  }
  // Accepted from the Authorization header or the body: the frontend already
  // sends this token as a Bearer for broadcasts, so the header form keeps the
  // two call sites identical.
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.body && req.body.token)
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'HiveSigner token required' })
  }

  const username = await verifyHiveSignerToken(token)
  if (!username || !HIVE_USER_RE.test(username)) {
    return res.status(401).json({ error: 'HiveSigner token is invalid or expired' })
  }

  setWalletSessionCookie(res, mintWalletSession(username))
  res.json({ success: true, username })
})

// GET /api/auth/wallet/status — who, if anyone, the session cookie says we are.
//
// The cookie is httpOnly, so the client cannot read it and cannot tell that it
// belongs to a different account than the one now signed in. Switching accounts
// in the UI does not clear it, and the gate trusts it over anything the page
// claims — so a creator who switched to another account kept watching their own
// supporters-only videos as themselves. This lets the client notice and rotate.
app.get('/api/auth/wallet/status', (req, res) => {
  const token = req.cookies?.[WSESSION_COOKIE_NAME]
  res.json({ user: (token && verifyWalletSession(token)) || null })
})

// POST /api/auth/wallet/logout — clear the wallet session cookie.
app.post('/api/auth/wallet/logout', (req, res) => {
  clearWalletSessionCookie(res)
  res.clearCookie('threespeak_user', { path: '/' })
  res.json({ success: true })
})

// ── 🔐 Gated content: guest list ──────────────────────────────────────────────
// Lets a creator add or remove the named accounts that can watch one of their
// supporters-only videos without 3Speak Pro.
//
// This lives HERE rather than in embedvideos on purpose. embedvideos only has
// app-level API keys, and the embed key ships inside the browser bundle, so a
// route there would let anyone edit anyone else's guest list. This service knows
// WHICH USER is calling, which is exactly what the check needs.
const GATE_URL = process.env.GATE_URL || ''
const GATE_INTERNAL_API_KEY = process.env.GATE_INTERNAL_API_KEY || ''
const EMBED_API_BASE = process.env.EMBED_API_BASE || 'https://embed2.3speak.tv'

/**
 * Shared gate for both guest-list routes: who is calling, and do they own this
 * video. Returns { user, video } or null after having already answered.
 *
 * Identity resolution mirrors /api/broadcast minus the legacy app-key path:
 * that path trusts a CLAIMED username, which is fine for posting ops the user
 * signs anyway, and not fine for deciding who may watch a paid video.
 */
async function resolveGatedVideoOwner(req, res) {
  if (!GATE_URL || !GATE_INTERNAL_API_KEY) {
    res.status(503).json({ error: 'Gate is not configured on this instance' })
    return null
  }

  let hiveUsername = await resolveButrUser(req, res)
  if (!hiveUsername) {
    const ws = req.cookies?.[WSESSION_COOKIE_NAME]
    const wu = ws && verifyWalletSession(ws)
    if (wu) hiveUsername = wu
  }
  if (!hiveUsername) {
    const authHeader = req.headers.authorization || ''
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (bearer) hiveUsername = await verifyHiveSignerToken(bearer)
  }
  if (!hiveUsername) {
    res.status(401).json({ error: 'Sign in to manage your guest list' })
    return null
  }

  const permlink = String(req.params.permlink || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(permlink)) {
    res.status(400).json({ error: 'invalid permlink' })
    return null
  }

  // Ownership is checked against the embed record, which is the source of truth
  // for who uploaded the asset. Never trust a client-supplied owner.
  let video
  try {
    const r = await fetch(`${EMBED_API_BASE.replace(/\/+$/, '')}/video/${encodeURIComponent(permlink)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) { res.status(404).json({ error: 'video not found' }); return null }
    video = await r.json()
  } catch {
    res.status(502).json({ error: 'could not verify video ownership' })
    return null
  }

  if (String(video?.owner || '').toLowerCase() !== hiveUsername.toLowerCase()) {
    console.warn(`[gated] @${hiveUsername} tried to touch the guest list of ${permlink} owned by @${video?.owner}`)
    res.status(403).json({ error: 'You can only manage guest lists on your own videos' })
    return null
  }
  if (video?.gated !== true) {
    res.status(400).json({ error: 'That video is not supporters-only' })
    return null
  }

  return { user: hiveUsername, video, permlink }
}

// Read the current guest list, so the editor can show who is already invited.
app.get('/api/gated/:permlink/allowlist', async (req, res) => {
  try {
    const ctx = await resolveGatedVideoOwner(req, res)
    if (!ctx) return undefined

    const r = await fetch(
      `${GATE_URL.replace(/\/+$/, '')}/internal/videos/${encodeURIComponent(ctx.video.gate_video_id || ctx.permlink)}`,
      { headers: { 'X-API-Key': GATE_INTERNAL_API_KEY }, signal: AbortSignal.timeout(8000) }
    )
    // A gated video that finished encoding is registered with the gate; one that
    // has not got there yet simply has no list to show.
    if (r.status === 404) return res.json({ allowlist: [], registered: false })
    if (!r.ok) return res.status(502).json({ error: 'Could not read the guest list' })

    const body = await r.json()
    return res.json({ allowlist: body.allowlist ?? [], registered: true })
  } catch (err) {
    console.error('GET /api/gated/:permlink/allowlist error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.patch('/api/gated/:permlink/allowlist', async (req, res) => {
  try {
    const ctx = await resolveGatedVideoOwner(req, res)
    if (!ctx) return undefined
    const { user: hiveUsername, video, permlink } = ctx

    const list = req.body?.allowlist
    if (!Array.isArray(list) || list.length > 500) {
      return res.status(422).json({ error: 'allowlist must be an array of at most 500 usernames' })
    }
    const names = [...new Set(list.map((u) => String(u).trim().toLowerCase().replace(/^@/, '')))]
    const bad = names.find((n) => !HIVE_USER_RE.test(n))
    if (bad !== undefined) {
      return res.status(422).json({ error: `"${bad}" is not a valid Hive account name` })
    }

    const gateRes = await fetch(
      `${GATE_URL.replace(/\/+$/, '')}/internal/videos/${encodeURIComponent(video.gate_video_id || permlink)}/allowlist`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': GATE_INTERNAL_API_KEY },
        body: JSON.stringify({ allowlist: names }),
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!gateRes.ok) {
      const text = await gateRes.text().catch(() => '')
      console.error(`[gated] gate rejected allowlist update for ${permlink}: ${gateRes.status} ${text}`)
      return res.status(502).json({ error: 'Could not update the guest list' })
    }

    const body = await gateRes.json()
    console.log(`[gated] @${hiveUsername} set ${names.length} guest(s) on ${permlink}`)
    return res.json({ success: true, allowlist: body.allowlist ?? names })
  } catch (err) {
    console.error('PATCH /api/gated/:permlink/allowlist error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/broadcast', broadcastLimiter, async (req, res) => {
  try {
    let hiveUsername = null

    // 1) ButrAuth httpOnly session cookie — auto-refreshed when the (1 hour)
    //    access token has expired, so the session lasts as long as the refresh
    //    token rather than dying mid-use.
    hiveUsername = await resolveButrUser(req, res)

    // 2) SIWH wallet session cookie (Keychain/HiveAuth/PeakVault/Ledger): the
    //    user proved posting-key control at login, so the username is bound to a
    //    server-signed cookie — no public-key impersonation possible.
    if (!hiveUsername) {
      const ws = req.cookies?.[WSESSION_COOKIE_NAME]
      const wu = ws && verifyWalletSession(ws)
      if (wu) hiveUsername = wu
    }

    // 3) HiveSigner access token via Authorization: Bearer (HiveSigner users
    //    can't sign client-side; verify the token and post on their behalf).
    if (!hiveUsername) {
      const authHeader = req.headers.authorization || ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
      if (bearer) hiveUsername = await verifyHiveSignerToken(bearer)
    }

    // 4) LEGACY app-key path (wallet logins that haven't established a session).
    //    Trusts the PUBLIC app key + a CLAIMED username, so anyone with the key
    //    (it ships in the frontend bundle) could act as any opted-in user —
    //    posting-level only. Disabled by ALLOW_APPKEY_AUTH=0, which makes the
    //    SIWH session cookie (path 2) mandatory for wallet logins.
    if (!hiveUsername && ALLOW_APPKEY_AUTH) {
      const apiKey = req.headers['x-api-key'] || ''
      if (EMBED_API_KEY && apiKey === EMBED_API_KEY) {
        const claimed = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
        const ops = Array.isArray(req.body?.operations) ? req.body.operations : []
        const postingOpsOnly = ops.length > 0 && ops.every(
          ([t]) => t === 'comment' || t === 'comment_options' || t === 'custom_json' || t === 'vote' || t === 'account_update2'
        )
        if (claimed && !postingOpsOnly) {
          return res.status(403).json({ error: 'Operation not allowed for app-key auth' })
        }
        if (claimed) {
          console.warn(`[appkey-auth] /api/broadcast acting as @${claimed} via legacy public-app-key path (no SIWH session)`)
          hiveUsername = claimed
        }
      }
    }

    if (!hiveUsername) return res.status(401).json({ error: 'Unauthorized' })

    return await broadcastAsThreespeak(hiveUsername, req.body.operations, res)
  } catch (err) {
    console.error('Broadcast error:', err.message)
    res.status(500).json({ error: 'Broadcast failed' })
  }
})

// ---------------------------------------------------------------------------
// Delegated challenge signing for OpenPods (Hangouts) and Snapie chat.
//
// These endpoints sign a login *challenge* with @threespeak's posting key on the
// user's behalf, so EVERY login type — including HiveSigner / ManteAuth that
// can't sign client-side — authenticates without a wallet popup. The downstream
// service (Hangouts /auth/verify, Snapie chat /auth/verify) accepts the
// signature because the user granted @threespeak posting authority. This mirrors
// how /api/broadcast already acts for users on 3speak.
//
// SECURITY — these are signing oracles for @threespeak's posting key, so:
//   • username is resolved from a server-side credential where possible
//     (ManteAuth cookie / verified HiveSigner token). Wallet logins
//     (Keychain/HiveAuth/PeakVault/Ledger) have no server credential, so they
//     use the public app key + claimed username — the SAME trust model as
//     /api/broadcast (worst case: act as a user who opted into @threespeak).
//   • each endpoint validates the challenge shape so the signed bytes can never
//     be a serialized Hive transaction (no on-chain replay as @threespeak).
//   • the user must currently grant @threespeak posting authority.
// ---------------------------------------------------------------------------

// Resolve the acting Hive user from cookie → HiveSigner token → app-key+username.
async function resolveDelegatedSignUser(req, res) {
  // Same auto-refresh as /api/broadcast — otherwise the OpenPods / chat handover
  // silently broke an hour after login while broadcasting still worked.
  const butrUser = await resolveButrUser(req, res)
  if (butrUser) return butrUser.toLowerCase()

  // SIWH wallet session cookie — the same credential /api/broadcast checks before
  // it will post a video for someone. The user proved posting-key control at login
  // and the username is bound to a server-signed cookie, so a wallet login that has
  // signed in is identified here rather than falling through to the claimed-name
  // path below. This check was missing, which is why the comment underneath used to
  // claim parity with /api/broadcast that did not exist: broadcast tries this first
  // and gates the app key behind a flag, and this helper did neither.
  const ws = req.cookies?.[WSESSION_COOKIE_NAME]
  const wu = ws && verifyWalletSession(ws)
  if (wu) return String(wu).toLowerCase()

  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (bearer) {
    const u = await verifyHiveSignerToken(bearer)
    if (u) return u.toLowerCase()
  }

  // LEGACY app-key path, now gated by the same ALLOW_APPKEY_AUTH as /api/broadcast.
  // It trusts the PUBLIC app key (it ships in the frontend bundle) plus a CLAIMED
  // username, so anyone holding the key could ask for a signature as any account
  // that opted into @threespeak. Setting ALLOW_APPKEY_AUTH=0 now closes it here too,
  // instead of closing it on broadcast while leaving the signing oracles open.
  if (ALLOW_APPKEY_AUTH) {
    const apiKey = req.headers['x-api-key'] || ''
    if (EMBED_API_KEY && apiKey === EMBED_API_KEY) {
      const claimed = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
      if (claimed) {
        console.warn(`[appkey-auth] delegated signing as @${claimed} via legacy public-app-key path (no SIWH session)`)
        return claimed
      }
    }
  }
  return null
}

// True when `hiveUsername` granted @threespeak posting authority at/above threshold.
async function hasThreespeakPostingGrant(hiveUsername) {
  const [account] = await client.database.getAccounts([hiveUsername])
  if (!account) return false
  const grant = account.posting.account_auths.find(([acc]) => acc === HIVE_ACCOUNT)
  return !!grant && grant[1] >= account.posting.weight_threshold
}

const signChallengeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false })

// POST /api/openpods/sign-challenge — challenge shape: `hivehangouts:<user>:<ts>:<hex>`
app.post('/api/openpods/sign-challenge', signChallengeLimiter, async (req, res) => {
  try {
    if (!POSTING_WIF) return res.status(500).json({ error: 'Server is not configured' })
    const hiveUsername = await resolveDelegatedSignUser(req, res)
    if (!hiveUsername) return res.status(401).json({ error: 'Unauthorized' })

    const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge : ''
    const escapedUser = hiveUsername.replace(/[.\-]/g, '\\$&')
    if (!new RegExp(`^hivehangouts:${escapedUser}:\\d+:[0-9a-f]+$`).test(challenge)) {
      return res.status(400).json({ error: 'Invalid challenge' })
    }
    if (!(await hasThreespeakPostingGrant(hiveUsername))) {
      return res.status(403).json({ error: 'Authorization required' })
    }

    const signature = PrivateKey.fromString(POSTING_WIF).sign(cryptoUtils.sha256(challenge)).toString()
    return res.json({ success: true, signature, username: hiveUsername })
  } catch (err) {
    console.error('OpenPods sign-challenge error:', err.message)
    res.status(500).json({ error: 'Signing failed' })
  }
})

// POST /api/snapie-chat/sign-challenge — Snapie chat challenges are bare UUIDv4s.
// Validating the UUID shape keeps this from signing arbitrary bytes (no tx replay).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
app.post('/api/snapie-chat/sign-challenge', signChallengeLimiter, async (req, res) => {
  try {
    if (!POSTING_WIF) return res.status(500).json({ error: 'Server is not configured' })
    const hiveUsername = await resolveDelegatedSignUser(req, res)
    if (!hiveUsername) return res.status(401).json({ error: 'Unauthorized' })

    const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge.trim() : ''
    if (!UUID_RE.test(challenge)) {
      return res.status(400).json({ error: 'Invalid challenge' })
    }
    if (!(await hasThreespeakPostingGrant(hiveUsername))) {
      return res.status(403).json({ error: 'Authorization required' })
    }

    const signature = PrivateKey.fromString(POSTING_WIF).sign(cryptoUtils.sha256(challenge)).toString()
    return res.json({ success: true, signature, username: hiveUsername })
  } catch (err) {
    console.error('Snapie-chat sign-challenge error:', err.message)
    res.status(500).json({ error: 'Signing failed' })
  }
})

// POST /api/ads/opt-out-signature — sign a creator's ad preference on their behalf.
//
// HiveSigner and Butter Auth sessions hold no signing key in the browser, so those
// creators could never sign the checker's ad-preference message client-side. Without
// this endpoint the people least able to sign would be the only ones unable to turn
// ads off on their own videos — which is exactly backwards for a consent control.
//
// The client sends ONLY a boolean. The message is built here, from the username the
// session resolves to, in the canonical form the checker expects. That is the whole
// safety argument: unlike a generic signing oracle this can never be steered into
// signing arbitrary bytes (a transaction digest, say), because the caller supplies
// none of them. Compare the snapie-chat endpoint, which has to validate a UUID shape
// for the same reason.
app.post('/api/ads/opt-out-signature', signChallengeLimiter, async (req, res) => {
  try {
    if (!POSTING_WIF) return res.status(500).json({ error: 'Server is not configured' })
    const hiveUsername = await resolveDelegatedSignUser(req, res)
    if (!hiveUsername) return res.status(401).json({ error: 'Unauthorized' })

    // Must be a real boolean: `undefined` would quietly become "off" and turn ads
    // off for someone who never asked.
    if (typeof req.body?.adsEnabled !== 'boolean') {
      return res.status(400).json({ error: 'adsEnabled must be true or false' })
    }
    const adsEnabled = req.body.adsEnabled

    // The community's cut of the creator pool. Signed along with everything else so
    // a signature cannot be lifted from one split and reused on another — this is
    // the field that decides where money goes. Absent means 0.
    const shareRaw = req.body.communitySharePct
    const communitySharePct = shareRaw === undefined || shareRaw === null
      ? AD_DEFAULT_COMMUNITY_PCT
      : Number(shareRaw)
    if (!Number.isInteger(communitySharePct) || communitySharePct < 0 || communitySharePct > AD_CREATOR_POOL_PCT) {
      return res.status(400).json({ error: `communitySharePct must be a whole number between 0 and ${AD_CREATOR_POOL_PCT}` })
    }

    // We sign as @threespeak, so the grant has to actually exist — otherwise the
    // checker would reject the signature anyway and the user would see a cryptic
    // failure instead of a reason.
    if (!(await hasThreespeakPostingGrant(hiveUsername))) {
      return res.status(403).json({
        error: `Turning ads off from here needs @${HIVE_ACCOUNT} posting authority on your account. Log in with Keychain, HiveAuth, PeakVault or Ledger to set it directly instead.`,
      })
    }

    const timestamp = Date.now()
    // Keep in lockstep with prefsMessage() in 3speakchecks/routes/advertise.js.
    const message = ['3speak-ads', 'creator-prefs', hiveUsername, adsEnabled ? 'on' : 'off',
      String(communitySharePct), String(timestamp)].join('|')
    const signature = PrivateKey.fromString(POSTING_WIF).sign(cryptoUtils.sha256(Buffer.from(message, 'utf8'))).toString()

    return res.json({ success: true, signature, timestamp, username: hiveUsername, communitySharePct })
  } catch (err) {
    console.error('Ads opt-out signature error:', err.message)
    res.status(500).json({ error: 'Signing failed' })
  }
})

// POST /api/ads/viewer-signature — sign a VIEWER's reward opt-in on their behalf.
//
// Same delegated-signing shape as the creator preference above, and needed for the
// same reason: HiveSigner and Butter Auth sessions hold no key in the browser, so
// without this the viewers least able to sign would be the only ones unable to
// consent to being paid.
//
// ⚠️ The thing being signed here is CONSENT to store a username against viewing.
// It is deliberately not derivable from anything the client sends except the
// logged-in identity this server already established: the body carries a boolean
// and nothing else, so this endpoint cannot be steered into signing a claim about
// somebody else.
app.post('/api/ads/viewer-signature', signChallengeLimiter, async (req, res) => {
  try {
    if (!POSTING_WIF) return res.status(500).json({ error: 'Server is not configured' })
    const hiveUsername = await resolveDelegatedSignUser(req, res)
    if (!hiveUsername) return res.status(401).json({ error: 'Unauthorized' })

    // A real boolean. `undefined` becoming "on" would opt somebody into being
    // identified because their client sent a malformed body.
    if (typeof req.body?.rewardsEnabled !== 'boolean') {
      return res.status(400).json({ error: 'rewardsEnabled must be true or false' })
    }
    const rewardsEnabled = req.body.rewardsEnabled

    if (!(await hasThreespeakPostingGrant(hiveUsername))) {
      return res.status(403).json({
        error: `Setting this from here needs @${HIVE_ACCOUNT} posting authority on your account. Log in with Keychain, HiveAuth, PeakVault or Ledger to set it directly instead.`,
      })
    }

    const timestamp = Date.now()
    // Keep in lockstep with viewerPrefsMessage() in 3speakchecks/routes/advertise.js.
    const message = ['3speak-ads', 'viewer-prefs', hiveUsername, rewardsEnabled ? 'on' : 'off',
      String(timestamp)].join('|')
    const signature = PrivateKey.fromString(POSTING_WIF).sign(cryptoUtils.sha256(Buffer.from(message, 'utf8'))).toString()

    return res.json({ success: true, signature, timestamp, username: hiveUsername, rewardsEnabled })
  } catch (err) {
    console.error('Ads viewer signature error:', err.message)
    res.status(500).json({ error: 'Signing failed' })
  }
})

// POST /api/ads/identity-signature — prove who is logged in, so /advertise can list
// their own applications without them keeping a reference code around.
//
// The checker will not answer "which applications does @x have" on a name alone:
// behind a reference sit contact details, a stated budget, the applicant's brief and
// our private note to them. So it wants a signature, and this endpoint produces one
// for the logins that cannot sign in the browser.
//
// It deliberately does NOT use resolveDelegatedSignUser(). That helper's last branch
// accepts the public app key plus a CLAIMED username, which is fine for a broadcast
// the user is watching happen and useless as proof here — it would let anyone read
// anyone's application by typing a name. Only a real server-side session counts:
// a Butter Auth cookie, or a HiveSigner token we verify with HiveSigner itself.
// Wallet logins (Keychain, HiveAuth, PeakVault, Ledger) hold a key in the browser
// and sign this message client-side instead, so they lose nothing by being refused.
app.post('/api/ads/identity-signature', signChallengeLimiter, async (req, res) => {
  try {
    if (!POSTING_WIF) return res.status(500).json({ error: 'Server is not configured' })

    let hiveUsername = await resolveButrUser(req, res)
    if (!hiveUsername) {
      const authHeader = req.headers.authorization || ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
      if (bearer) hiveUsername = await verifyHiveSignerToken(bearer)
    }
    // This message is shown to the user as-is on /advertise, so it says what to do
    // rather than just refusing. A bare "Unauthorized" is the right status and the
    // wrong sentence.
    if (!hiveUsername) {
      return res.status(401).json({
        error: 'We could not confirm your login from here. Open an application with its reference instead.',
      })
    }
    hiveUsername = hiveUsername.toLowerCase()

    // We sign as @threespeak, so the grant has to actually exist — otherwise the
    // checker rejects the signature and the user sees a cryptic failure instead of
    // a reason they can act on.
    if (!(await hasThreespeakPostingGrant(hiveUsername))) {
      return res.status(403).json({
        error: `Listing your applications from here needs @${HIVE_ACCOUNT} posting authority on your account. You can still look one up with its reference.`,
      })
    }

    const timestamp = Date.now()
    // Keep in lockstep with mineMessage() in 3speakchecks/routes/advertise.js.
    const message = ['3speak-ads', 'mine', hiveUsername, String(timestamp)].join('|')
    const signature = PrivateKey.fromString(POSTING_WIF).sign(cryptoUtils.sha256(Buffer.from(message, 'utf8'))).toString()

    return res.json({ success: true, signature, timestamp, username: hiveUsername })
  } catch (err) {
    console.error('Ads identity signature error:', err.message)
    res.status(500).json({ error: 'Signing failed' })
  }
})

// Image upload — sign the standard images.hive.blog "ImageSigningChallenge" with
// @threespeak's posting key and upload on the user's behalf. Lets every login
// (incl. HiveSigner, which can't sign client-side) attach covers/thumbnails with
// no wallet signature. Gated by the shared app key (same trust as the embed
// upload); the image is hosted under @threespeak and needs no user authority.
const imageUploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false })
app.post('/api/upload-image', imageUploadLimiter, express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || ''
    if (!EMBED_API_KEY || apiKey !== EMBED_API_KEY) return res.status(401).json({ error: 'Unauthorized' })
    if (!POSTING_WIF) return res.status(500).json({ error: 'Server is not configured' })
    const img = req.body
    if (!Buffer.isBuffer(img) || img.length === 0) return res.status(400).json({ error: 'No image data' })

    // Standard hive.blog image auth: sign sha256("ImageSigningChallenge" + bytes).
    const hash = cryptoUtils.sha256(Buffer.concat([Buffer.from('ImageSigningChallenge'), img]))
    const signature = PrivateKey.fromString(POSTING_WIF).sign(hash).toString()

    const contentType = req.headers['content-type'] || 'image/png'
    const form = new FormData()
    form.append('file', new Blob([img], { type: contentType }), 'image')

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20000)
    let hostResp
    try {
      hostResp = await fetch(`https://images.hive.blog/${HIVE_ACCOUNT}/${signature}`, {
        method: 'POST', body: form, signal: ctrl.signal,
      })
    } finally { clearTimeout(t) }

    const data = await hostResp.json().catch(() => ({}))
    if (!hostResp.ok || !data.url) {
      console.error('Image host rejected:', hostResp.status, JSON.stringify(data).slice(0, 200))
      // Tell the caller WHICH failure this is. A 429 from images.hive.blog is the
      // shared @threespeak upload quota running out — it is not the user's file, not
      // retryable in the next second, and not something a generic "upload failed"
      // helps anyone diagnose. It has bitten thumbnails too.
      const quota = hostResp.status === 429 || /qouta|quota/i.test(JSON.stringify(data))
      return res.status(quota ? 503 : 502).json({
        error: quota
          ? "3Speak's image upload quota is exhausted for now — this is on our side, not your file. Try again later."
          : 'Image host rejected the upload',
        upstreamStatus: hostResp.status,
      })
    }
    return res.json({ success: true, url: data.url })
  } catch (e) {
    console.error('Image upload error:', e.message)
    return res.status(500).json({ error: 'Image upload failed' })
  }
})

app.get('/api/health', (req, res) => res.json({ ok: true }))

// === Teleprompter STT token minting ===
// Hands the browser a short-lived SIGNED token for the self-hosted STT WebSocket,
// so the browser never holds STT_SIGNING_SECRET. Token = "<exp>.<hexHMAC(exp)>";
// the STT server verifies the HMAC and expiry (see the STT dual-token auth plan).
// STT_SIGNING_SECRET must match the value on the STT box. Gated by the shared app
// key (same trust model as /api/broadcast) when EMBED_API_KEY is set.
// TODO: tighten to a real per-user session before opening publicly.
const STT_SIGNING_SECRET = process.env.STT_SIGNING_SECRET || ''
const STT_TOKEN_TTL = parseInt(process.env.STT_TOKEN_TTL || '300', 10) // seconds

app.get('/api/stt-token', baseLimiter, (req, res) => {
  if (!STT_SIGNING_SECRET) return res.status(503).json({ error: 'STT tokens not configured' })
  if (EMBED_API_KEY && req.get('X-API-Key') !== EMBED_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const exp = Math.floor(Date.now() / 1000) + STT_TOKEN_TTL
  const sig = crypto.createHmac('sha256', STT_SIGNING_SECRET).update(String(exp)).digest('hex')
  res.json({ token: `${exp}.${sig}`, exp })
})

// Which languages the STT server actually has models for. Proxied server-side so
// the browser doesn't need CORS on the STT box; cached for a minute.
const STT_HTTP_URL = (process.env.STT_HTTP_URL || '').replace(/\/+$/, '')
let sttLangCache = { at: 0, models: [] }

app.get('/api/stt-langs', baseLimiter, async (req, res) => {
  if (!STT_HTTP_URL) return res.json({ models: [] })
  const now = Date.now()
  if (now - sttLangCache.at < 60000 && sttLangCache.models.length) {
    return res.json({ models: sttLangCache.models })
  }
  try {
    const r = await fetch(`${STT_HTTP_URL}/healthz`, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return res.json({ models: sttLangCache.models })
    const j = await r.json()
    const models = Array.isArray(j.models_loaded) ? j.models_loaded : []
    sttLangCache = { at: now, models }
    return res.json({ models })
  } catch {
    return res.json({ models: sttLangCache.models })
  }
})

// === Playlists read proxy ===
// The playlists API (playlists.3speak.tv) requires a secret token once its read
// gate is enabled. We hold that token HERE on the server — never in the browser
// bundle — and attach it to forwarded reads, so a playlist can only be read
// THROUGH us; a raw GET straight to the playlists URL is rejected. This is NOT
// per-user auth: we don't check who is asking, so it stops direct-URL access and
// token-lifting, but not a crafted request through this proxy (accepted tradeoff).
const PLAYLISTS_UPSTREAM = (process.env.PLAYLISTS_UPSTREAM_URL || 'https://playlists.3speak.tv/api').replace(/\/+$/, '')
const PLAYLISTS_API_TOKEN = process.env.PLAYLISTS_API_TOKEN || ''

// Regex route (not '/api/pl/*') — Express 5's router rejects a bare wildcard.
app.get(/^\/api\/pl\/(.*)$/, baseLimiter, async (req, res) => {
  try {
    const subPath = req.params[0] || '' // path after /api/pl/, no query string
    // Whitelist the playlist read paths only — no arbitrary reach into upstream.
    if (!/^(playlists(\/|$)|video\/[^/]+\/[^/]+\/playlists(\/|$))/.test(subPath)) {
      return res.status(404).json({ error: 'not found' })
    }
    const qIdx = req.originalUrl.indexOf('?')
    const qs = qIdx >= 0 ? req.originalUrl.slice(qIdx) : ''
    const headers = { Accept: 'application/json' }
    if (PLAYLISTS_API_TOKEN) headers.Authorization = `Bearer ${PLAYLISTS_API_TOKEN}`
    // Forward the real client IP so the upstream's per-IP rate limiter still
    // buckets per user (otherwise every read looks like it's from this server).
    const fwd = req.headers['x-forwarded-for'] || req.ip
    if (fwd) headers['X-Forwarded-For'] = fwd
    const upstream = await fetch(`${PLAYLISTS_UPSTREAM}/${subPath}${qs}`, { method: 'GET', headers })
    const body = await upstream.text()
    const ct = upstream.headers.get('content-type')
    if (ct) res.set('Content-Type', ct)
    res.status(upstream.status).send(body)
  } catch (e) {
    console.error('playlists proxy error:', e.message)
    res.status(502).json({ error: 'playlists upstream unreachable' })
  }
})

// ===================================================================
// Spotlight — creator link pages ("linktree"). Storage is ON-CHAIN (the user's
// posting_json_metadata.3speak.spotlight) — reads come from Hive, writes go through
// the normal broadcast proxy as an account_update2 (posting auth). So the only
// endpoint here is the standalone public renderer.
// ===================================================================
const spotlight = require('./spotlight')

// Cache the fetched account (name + spotlight metadata) briefly so repeated views
// of a popular page don't hit Hive each time. Short TTL so edits appear quickly.
const spotlightAccountCache = new Map()
async function spotlightAccount(username) {
  const hit = spotlightAccountCache.get(username)
  if (hit && Date.now() - hit.at < 10 * 1000) return hit.acc   // short TTL so edits appear fast
  let acc = null
  try { [acc] = await client.database.getAccounts([username]) } catch { acc = null }
  spotlightAccountCache.set(username, { acc, at: Date.now() })
  return acc
}

// POST /api/spotlight/render — render an ARBITRARY (unsaved) layout to the same HTML
// the public page uses. Backs the editor's iframe preview so it's pixel-identical to
// the final page (and instant — no Hive round-trip, no cache). Renders provided data
// only; not a storage endpoint.
app.post('/api/spotlight/render', baseLimiter, async (req, res) => {
  try {
    const { username, displayName, layout } = req.body || {}
    const u = String(username || 'preview').replace(/^@/, '').toLowerCase()
    const page = spotlight.sanitizeLayout(layout || {})
    await resolveDynamicSections(page, u)
    const html = spotlight.renderSpotlightHtml(u, page, { displayName: String(displayName || '') })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.set('Cache-Control', 'no-store')
    return res.send(html)
  } catch (err) {
    console.error('Spotlight preview render error:', err.message)
    res.status(500).send('preview error')
  }
})

// ── link unfurl (rich embed cards) ──────────────────────────────────────────
// POST /api/spotlight/unfurl { url } → { url, title, description, image, siteName }
// Resolves a pasted link's preview metadata (like Discord/Slack unfurls) ONCE at edit
// time; the result is stored in the layout so the public page needs no live fetch.
// Native fast-path for Hive front-ends via bridge.get_post; everything else is an
// SSRF-guarded Open-Graph/Twitter-card fetch.
const dnsp = require('dns').promises
const net = require('net')

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number)
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 169 && p[1] === 254) return true                 // link-local / metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true    // CGNAT
    if (p[0] >= 224) return true                                  // multicast / reserved
    return false
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase()
    if (s === '::1' || s === '::') return true
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7))   // v4-mapped
    return s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')
  }
  return true                                                     // unknown → block
}
async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) { if (isPrivateIp(hostname)) throw new Error('blocked host'); return }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new Error('blocked host')
  const addrs = await dnsp.lookup(hostname, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error('dns')
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('blocked host')
}

// Fetch HTML with manual redirect following (each hop re-validated), a 6s timeout,
// and a ~512KB read cap. Returns { html, finalUrl }.
async function fetchHtml(rawUrl, maxHops = 3) {
  let url = rawUrl
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('proto')
    if (u.port && !['80', '443', ''].includes(u.port)) throw new Error('port')
    await assertPublicHost(u.hostname)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    let res
    try {
      res = await fetch(u.toString(), {
        method: 'GET', redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 3SpeakBot/1.0; +https://3speak.tv)', Accept: 'text/html,application/xhtml+xml' },
      })
    } finally { clearTimeout(timer) }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u).toString()
      continue
    }
    if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return { html: '', finalUrl: u.toString() }
    const reader = res.body.getReader()
    const dec = new TextDecoder('utf-8')
    let html = ''; const CAP = 512 * 1024
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      html += dec.decode(value, { stream: true })
      if (html.length >= CAP) { try { await reader.cancel() } catch { /* ignore */ } break }
    }
    return { html, finalUrl: u.toString() }
  }
  throw new Error('too many redirects')
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return '' } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)) } catch { return '' } })
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
}
function parseOg(html, baseUrl) {
  const meta = {}
  const tagRe = /<meta\b[^>]*>/gi
  let m
  while ((m = tagRe.exec(html))) {
    const tag = m[0]
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1]
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1]
    if (!key || val == null) continue
    const k = key.toLowerCase()
    if (!(k in meta)) meta[k] = decodeEntities(val)
  }
  const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || ''
  const title = meta['og:title'] || meta['twitter:title'] || decodeEntities(titleTag)
  const description = meta['og:description'] || meta['twitter:description'] || meta.description || ''
  let image = meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'] || ''
  if (image) { try { image = new URL(image, baseUrl).toString() } catch { image = '' } }
  const siteName = meta['og:site_name'] || ''
  return {
    title: title.trim().slice(0, 160),
    description: description.trim().slice(0, 300),
    image: /^https?:\/\//i.test(image) ? image : '',
    siteName: siteName.trim().slice(0, 80),
  }
}

// Known Hive front-ends → parse @author/permlink so we can build a card straight from
// chain data (fast + reliable, no scraping).
const HIVE_SITE_NAMES = { '3speak.tv': '3Speak', 'peakd.com': 'PeakD', 'hive.blog': 'Hive', 'ecency.com': 'Ecency', 'inleo.io': 'InLeo', 'leofinance.io': 'InLeo' }
function parseHivePermalink(u) {
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  if (!(host in HIVE_SITE_NAMES)) return null
  if (host === '3speak.tv') {
    const v = u.searchParams.get('v')
    if (v && v.includes('/')) { const [a, p] = v.split('/'); if (a && p) return { author: a.toLowerCase(), permlink: p.toLowerCase(), site: HIVE_SITE_NAMES[host] } }
  }
  const m = u.pathname.match(/@([a-z0-9.\-]{3,16})\/([a-z0-9.\-]{1,255})/i)
  if (!m) return null
  return { author: m[1].toLowerCase(), permlink: m[2].toLowerCase(), site: HIVE_SITE_NAMES[host] }
}
async function hiveCard(author, permlink, originalUrl, site) {
  const post = await client.call('bridge', 'get_post', { author, permlink })
  if (!post || !post.author) return null
  let jm = post.json_metadata
  if (typeof jm === 'string') { try { jm = JSON.parse(jm) } catch { jm = {} } }
  let image = (jm && Array.isArray(jm.image) && jm.image[0]) || (jm && typeof jm.image === 'string' ? jm.image : '') || `https://images.hive.blog/u/${author}/avatar`
  if (!/^https?:\/\//i.test(image)) image = `https://images.hive.blog/u/${author}/avatar`
  return {
    url: originalUrl,
    title: (post.title || `@${author}`).slice(0, 160),
    description: hiveExcerpt(post.body).slice(0, 240),
    image,
    siteName: site || 'Hive',
  }
}

// Markdown/HTML post body → a plain-text excerpt for card descriptions.
function hiveExcerpt(raw) {
  return String(raw || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// The author's most recent TOP-LEVEL, non-reblog, non-crosspost Hive posts → cards.
// Cached 60s per (account,count). Backs the embed block's "My latest Hive posts" source.
const recentPostsCache = new Map()
async function recentHivePosts(account, count) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account)) return []
  const n = Math.max(1, Math.min(6, count || 3))
  const key = `${account}:${n}`
  const hit = recentPostsCache.get(key)
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.items
  // sort:'posts' = the account's own root posts (excludes reblogs & replies).
  // NOTE: bridge caps limit at 20.
  let posts = []
  try { posts = await client.call('bridge', 'get_account_posts', { sort: 'posts', account, limit: 20 }) } catch { posts = [] }
  const items = []
  for (const p of (posts || [])) {
    if (!p || p.author !== account) continue                       // reblog → author differs
    if (p.reblogged_by && p.reblogged_by.length) continue
    if (typeof p.depth === 'number' && p.depth > 0) continue        // top-level only
    let jm = p.json_metadata
    if (typeof jm === 'string') { try { jm = JSON.parse(jm) } catch { jm = {} } }
    jm = jm || {}
    if (jm.original_author || jm.original_permlink) continue         // crosspost
    const tags = Array.isArray(jm.tags) ? jm.tags.map(String) : []
    if (tags.includes('cross-post') || tags.includes('crosspost')) continue
    let image = (Array.isArray(jm.image) && jm.image[0]) || (typeof jm.image === 'string' ? jm.image : '')
    if (!/^https?:\/\//i.test(image)) image = `https://images.hive.blog/u/${account}/avatar`
    const isVideo = /3speak/i.test(String(jm.app || '')) || !!jm.video
    items.push({
      url: isVideo ? `https://3speak.tv/watch?v=${p.author}/${p.permlink}` : `https://peakd.com/@${p.author}/${p.permlink}`,
      title: (p.title || 'Untitled').slice(0, 160),
      description: hiveExcerpt(p.body).slice(0, 170),
      image,
      siteName: isVideo ? '3Speak' : 'Hive',
    })
    if (items.length >= n) break
  }
  recentPostsCache.set(key, { at: Date.now(), items })
  return items
}

// Fill live data into dynamic sections (currently the hive-recent embed) before render.
async function resolveDynamicSections(page, ownerUsername) {
  if (!page || !Array.isArray(page.sections)) return page
  const jobs = []
  for (const s of page.sections) {
    if (s && s.type === 'embed' && s.source === 'hive-recent') {
      jobs.push(recentHivePosts(s.account || ownerUsername, s.count || 3)
        .then((items) => { s._items = items }).catch(() => { s._items = [] }))
    }
  }
  if (jobs.length) await Promise.all(jobs)
  return page
}

app.post('/api/spotlight/unfurl', baseLimiter, async (req, res) => {
  try {
    const raw = String((req.body && req.body.url) || '').trim()
    if (!raw || raw.length > 2000) return res.status(400).json({ error: 'bad url' })
    let u
    try { u = new URL(raw) } catch { return res.status(400).json({ error: 'bad url' }) }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return res.status(400).json({ error: 'bad url' })
    const host = u.hostname.replace(/^www\./, '')

    const hp = parseHivePermalink(u)
    if (hp) {
      try { const card = await hiveCard(hp.author, hp.permlink, raw, hp.site); if (card) return res.json(card) } catch { /* fall through */ }
    }
    try {
      const { html, finalUrl } = await fetchHtml(raw)
      const og = parseOg(html, finalUrl)
      return res.json({ url: raw, title: og.title, description: og.description, image: og.image, siteName: og.siteName || host })
    } catch {
      // Failure still yields a usable card (domain title), so the block isn't lost.
      return res.json({ url: raw, title: '', description: '', image: '', siteName: host })
    }
  } catch (err) {
    console.error('Spotlight unfurl error:', err.message)
    return res.status(500).json({ error: 'unfurl failed' })
  }
})

// GET /spotlight-page/:username — the PUBLIC page as a standalone, chrome-free HTML
// document (served by nginx for /@user/links). No SPA, no app bundle → near-instant.
app.get('/spotlight-page/:username', baseLimiter, async (req, res) => {
  const username = String(req.params.username || '').replace(/^@/, '').toLowerCase()
  try {
    const account = await spotlightAccount(username)
    const page = spotlight.readSpotlightFromAccount(account)   // parses + sanitizes
    await resolveDynamicSections(page, username)
    let displayName = ''
    try {
      const meta = account && account.posting_json_metadata ? JSON.parse(account.posting_json_metadata) : {}
      displayName = (meta && meta.profile && meta.profile.name) || ''
    } catch { /* no name */ }
    const html = spotlight.renderSpotlightHtml(username, page, { displayName })
    res.set('Content-Type', 'text/html; charset=utf-8')
    // Short cache so an edit shows up quickly (on-chain propagation is the real floor).
    res.set('Cache-Control', 'public, max-age=15')
    return res.send(html)
  } catch (err) {
    console.error('Spotlight render error:', err.message)
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.status(500).send('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">Could not load this page.</body>')
  }
})

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal error' })
})

// Block startup until the SDK is initialised (also primes the public-key cache)
;(async () => {
  try {
    await initButrAuth()
    await butr.getPublicKey()
  } catch (err) {
    console.error('[FATAL]', err.message)
    process.exit(1)
  }


  app.listen(PORT, () => {
    console.log(`3Speak backend service running on :${PORT}`)
  })
})()
