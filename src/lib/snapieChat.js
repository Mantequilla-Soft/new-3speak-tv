import { ChatClient } from '@snapie/chat-client'
import aioha, {
  signMessageWithAioha,
  getCurrentProvider,
  isManteAuthLogin,
  KeyTypes,
  Providers,
} from '../hive-api/aioha'
import { EMBED_API_KEY } from '../utils/config'

// preview-3speak's own backend (broadcast/manteauth/sign). Same base aioha uses.
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api'

// The SDK talks to `{baseUrl}/api/chat/*`. The Snapie chat API does not send
// CORS headers, so we can't hit https://snapie.io directly from the browser —
// instead we go same-origin through a dev-server/nginx proxy. `/snapie-chat` is
// rewritten to https://snapie.io (see vite.config.js `server.proxy`). Override
// with VITE_SNAPIE_CHAT_BASE_URL if a different Snapie instance is wanted.
export const SNAPIE_CHAT_BASE_URL =
  import.meta.env.VITE_SNAPIE_CHAT_BASE_URL || '/snapie-chat'

let client = null

/** Lazily create the one shared ChatClient. */
export function getChatClient() {
  if (!client) {
    client = new ChatClient({ baseUrl: SNAPIE_CHAT_BASE_URL })
  }
  return client
}

// Chat auth is a Hive posting-key *signMessage* challenge. Only providers that
// can sign an arbitrary buffer client-side qualify. HiveSigner can't sign
// buffers, and Butter Auth / ManteAuth sessions hold no client-side key (they
// broadcast posting ops through @threespeak) — neither can satisfy the
// challenge, so we surface a clear reason instead of a cryptic signing error.
const SIGN_CAPABLE_PROVIDERS = new Set([
  Providers.Keychain,
  Providers.HiveAuth,
  Providers.PeakVault,
  Providers.Ledger,
])

export function canSignChatChallenge() {
  if (isManteAuthLogin()) return false
  return SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider())
}

export function chatAuthUnavailableReason() {
  if (isManteAuthLogin()) {
    return 'Chat needs a wallet that can sign a login challenge. Butter Auth sessions can’t — log in with Keychain, HiveAuth, PeakVault or Ledger to use chat.'
  }
  if (getCurrentProvider() === Providers.HiveSigner) {
    return 'HiveSigner can’t sign the chat login challenge. Log in with Keychain, HiveAuth, PeakVault or Ledger to use chat.'
  }
  return 'Chat requires a wallet that can sign a login challenge (Keychain, HiveAuth, PeakVault or Ledger).'
}

// Sign a chat challenge (a UUID) via @threespeak through the preview backend, so
// the background service signs for ALL logins — no wallet popup. Backend auth:
// HiveSigner → Bearer token; ManteAuth → httpOnly cookie; wallet → public app
// key + claimed username (same trust as /api/broadcast). Throws on failure so
// the caller may fall back to a client-side signature.
async function signChatChallengeViaThreespeak(challenge, username) {
  const provider = getCurrentProvider()
  const headers = { 'Content-Type': 'application/json' }
  const body = { challenge }
  if (provider === Providers.HiveSigner) {
    const token = localStorage.getItem('hivesignerToken')
    if (!token) throw new Error('HiveSigner session expired — reconnect and try again')
    headers.Authorization = `Bearer ${token}`
  } else if (!isManteAuthLogin()) {
    headers['X-API-Key'] = EMBED_API_KEY
    body.username = username
  }
  const res = await fetch(`${THREESPEAK_API}/snapie-chat/sign-challenge`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.signature) {
    throw new Error(data.error || 'Could not sign the chat challenge')
  }
  return data.signature
}

async function signChatChallengeClientSide(challenge) {
  const res = await signMessageWithAioha(challenge, KeyTypes.Posting, 'Sign in to 3Speak Chat')
  if (!res?.success || !res.result) {
    throw new Error('Chat login signature was rejected.')
  }
  return res.result
}

// Chat ids Snapie gives ButrAuth warm-up users: `~<butrauth userId>`. `~` is
// never part of a Hive name, so this tells the two kinds of identity apart.
export const isWarmupChatId = (id) => typeof id === 'string' && id.startsWith('~')

// Hand the SDK a session the 3Speak server obtained for us. chat-client 0.4.0
// has useSession for exactly this; 0.3.0 only reads its token from storage at
// construction, so there the live fields are set as well.
function adoptChatSession(c, token, username) {
  if (typeof c.useSession === 'function') { c.useSession(token, username); return }
  try {
    localStorage.setItem('snapie-chat-token', token)
    localStorage.setItem('snapie-chat-token-user', username)
  } catch { /* private mode: the session still works until reload */ }
  if (c.service) {
    c.service.token = token
    c.service.tokenUsername = username
  }
}

// Sign in with the ButrAuth session (httpOnly cookie) through the 3Speak server,
// which hands Snapie the access token. The only way in for warm-up users, who
// have no Hive account to sign with. Throws with `status` set (404 = Snapie has
// not switched ButrAuth sign-in on yet).
async function authenticateViaButrAuth(c) {
  const res = await fetch(`${THREESPEAK_API}/snapie-chat/butrauth-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: '{}',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.token || !data.username) {
    throw Object.assign(new Error(data.error || 'Chat sign-in failed'), { status: res.status })
  }
  adoptChatSession(c, data.token, data.username)
  return data
}

/**
 * Sign a warm-up user (ButrAuth, no Hive account) in to chat. Reuses a stored
 * warm-up session when there is one.
 */
export async function authenticateWarmupChat() {
  const c = getChatClient()
  if (c.isAuthenticated() && isWarmupChatId(c.getUsername())) return c
  await authenticateViaButrAuth(c)
  return c
}

/**
 * Authenticate the shared client for `username` against the Snapie chat API.
 * Reuses an existing valid token when one is already stored for this user.
 *
 * Tries the background @threespeak signer first (no wallet popup, works for
 * every login type). If that fails — e.g. the user never granted @threespeak
 * posting authority — and `allowClientFallback` is set and the provider can sign
 * client-side, it falls back to a wallet signature. Returns the ChatClient;
 * throws with a human-readable message on failure.
 */
export async function authenticateChat(username, { allowClientFallback = true } = {}) {
  const c = getChatClient()
  if (c.isAuthenticated() && c.getUsername() === username) return c

  // ButrAuth logins try their own session first: it needs no @threespeak
  // posting grant, and the first sign-in under a freshly graduated Hive name is
  // what carries the warm-up conversations over to it. Any failure (Snapie not
  // set up for it yet, a session for some other name) falls through to the
  // signed challenge below.
  if (isManteAuthLogin()) {
    try {
      const s = await authenticateViaButrAuth(c)
      if (s.username === username) return c
      c.logout()
    } catch { /* fall through */ }
  }

  try {
    await c.authenticate(username, (challenge) =>
      signChatChallengeViaThreespeak(challenge, username)
    )
    return c
  } catch (bgErr) {
    if (allowClientFallback && canSignChatChallenge()) {
      await c.authenticate(username, signChatChallengeClientSide)
      return c
    }
    throw bgErr
  }
}

export { aioha }
