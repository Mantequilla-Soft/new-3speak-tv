import { Aioha, Asset, KeyTypes, Providers } from '@aioha/aioha'
import { IS_VSC_TESTNET, VSC_NET_ID } from '../utils/vscContract.js'
import { ENABLE_METAMASK_SNAP, EMBED_API_KEY } from '../utils/config.js'
import { getHiveUrl, ensureHealthyNode } from '../utils/hiveNode.js'

const HIVE_API = IS_VSC_TESTNET ? 'https://testnet.techcoderx.com' : getHiveUrl()
const CHAIN_ID = IS_VSC_TESTNET
  ? '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e'
  : 'beeab0de00000000000000000000000000000000000000000000000000000000'

// Manual Aioha setup so we can conditionally register MetaMask Snap
const aioha = new Aioha(HIVE_API)
aioha.registerKeychain()
aioha.registerLedger()
aioha.registerPeakVault()
if (ENABLE_METAMASK_SNAP) {
  aioha.registerMetaMaskSnap()
}
aioha.registerHiveAuth({ name: '3Speak', description: '3Speak - Decentralized Video Platform' })
aioha.registerHiveSigner({
  app: import.meta.env.VITE_HIVESIGNER_APP,
  callbackURL: window.location.origin + '/hivesigner.html',
  scope: ['login', 'vote', 'comment', 'follow', 'transfer'],
})
aioha.setApi(HIVE_API)
// Upgrade to the session's healthy node once the probe resolves.
if (!IS_VSC_TESTNET) {
  ensureHealthyNode().then((u) => { try { aioha.setApi(u) } catch { /* ignore */ } })
}
aioha.loadAuth()
aioha.vscSetNetId(VSC_NET_ID)
if (typeof aioha.setChainId === 'function') {
  aioha.setChainId(CHAIN_ID)
}

// Store for HiveAuth waiting callbacks
let hiveAuthCallbacks = {
  onWaiting: null,
  onComplete: null
};

// Set HiveAuth waiting callbacks (called from React component)
export const setHiveAuthCallbacks = (onWaiting, onComplete) => {
  hiveAuthCallbacks.onWaiting = onWaiting;
  hiveAuthCallbacks.onComplete = onComplete;
};

// Butter Auth sessions only carry posting authority. When an active-key op is
// attempted under a Butter Auth login we don't fail — we hand the operations
// to a registered modal handler that lets the user complete the signature
// themselves (Hive Keychain wallet, or a pasted private active key). The
// handler resolves with { success, result } or rejects if the user cancels.
let activeAuthHandler = null;
export const setActiveAuthHandler = (fn) => { activeAuthHandler = fn; };

const requestButrauthActiveSign = async (operations) => {
  if (typeof activeAuthHandler !== 'function') {
    throw new Error('Active key operations need a Hive wallet. Please reload and try again.')
  }
  // Handler shows the modal and returns the broadcast result, or throws on cancel.
  return activeAuthHandler(operations)
}

// Aioha logins (Keychain/HiveAuth/PeakVault/Ledger/HiveSigner) broadcast
// posting-level ops via @threespeak (the user granted it posting authority), the
// same way ButrAuth uses its cookie path. ButrAuth itself is handled by
// isManteAuthLogin(); a logged-out state returns false. Active-key ops never use
// this — @threespeak only holds posting authority.
const usesThreespeakProxy = () => !!aioha.getCurrentProvider();

// True when a @threespeak broadcast bounced because the user hasn't granted
// @threespeak posting authority yet — the one case where we fall back to letting
// them sign client-side (rather than surfacing a hard error).
const isNotGrantedError = (e) => /Authorization required/i.test(e?.message || '');

// Check if current provider is HiveAuth
export const isHiveAuthProvider = () => {
  return aioha.getCurrentProvider() === Providers.HiveAuth;
};

// Extract a human-readable reason from aioha's `result.error` (which may be a
// string, an object with .message, or a nested Hive node error). Falls back to
// a default label when aioha returns success:false with nothing useful.
const extractAiohaError = (result, fallback) => {
  if (!result) return fallback;
  const e = result.error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') {
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    try { return JSON.stringify(e); } catch { /* ignore */ }
  }
  if (typeof result.message === 'string' && result.message.trim()) return result.message;
  return `${fallback} (no error returned by aioha)`;
};

// Wrapper to handle HiveAuth waiting state
export const withHiveAuthWaiting = async (operation, message = 'Waiting for approval...') => {
  const isHiveAuth = isHiveAuthProvider();

  if (isHiveAuth && hiveAuthCallbacks.onWaiting) {
    hiveAuthCallbacks.onWaiting(message);
  }

  try {
    const result = await operation();
    return result;
  } finally {
    if (isHiveAuth && hiveAuthCallbacks.onComplete) {
      hiveAuthCallbacks.onComplete();
    }
  }
};

// Custom_json id for the crowd-sourced "viewer-tag" a user assigns from the vote
// dialog. Broadcast in the SAME transaction as the vote (see voteWithAioha).
export const VIEWER_TAG_CJ_ID = '3speak-viewer-tag';

// Helper function to vote on content. When `viewerTag` is supplied, the vote and
// a `3speak-viewer-tag` custom_json are broadcast together as ONE transaction
// (both posting-auth ops), so the tag choice is atomic with the vote — one signature.
export const voteWithAioha = async (author, permlink, weight = 10000, viewerTag = null) => {
  const tag = viewerTag ? String(viewerTag).trim().toLowerCase() : null;

  // Ops for a given voter: the vote (weight may be NEGATIVE = downvote), plus the
  // tag custom_json when there is one. The tag always records the ABSOLUTE weight.
  const buildOps = (voter) => {
    const ops = [['vote', { voter, author, permlink, weight }]];
    if (tag) {
      ops.push(['custom_json', {
        required_auths: [],
        required_posting_auths: [voter],
        id: VIEWER_TAG_CJ_ID,
        json: JSON.stringify({ app: 'threespeak', author, permlink, tag, weight: Math.abs(weight) }),
      }]);
    }
    return ops;
  };

  if (isManteAuthLogin()) {
    const voter = localStorage.getItem('user_id')
    return broadcastViaManteAuth(buildOps(voter))
  }
  if (usesThreespeakProxy()) {
    try {
      return await broadcastViaThreespeak(buildOps(aioha.getCurrentUser()))
    } catch (e) {
      if (!isNotGrantedError(e)) throw e // not granted → sign it client-side below
    }
  }
  return withHiveAuthWaiting(async () => {
    try {
      // No tag → keep the dedicated single-op vote helper (unchanged for every
      // other caller: comment votes, card votes without a tag, etc).
      const result = tag
        ? await aioha.signAndBroadcastTx(buildOps(aioha.getCurrentUser()), KeyTypes.Posting)
        : await aioha.vote(author, permlink, weight);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        console.error('Vote rejected, full aioha result:', result);
        throw new Error(extractAiohaError(result, 'Vote failed'));
      }
    } catch (error) {
      console.error('Vote error:', error);
      throw error;
    }
  }, 'Approve vote on HiveAuth...');
};

// Tag a video WITHOUT voting — used once the payout window has closed, when a
// vote would be pointless. Broadcasts only the 3speak-viewer-tag custom_json
// (posting auth). weight defaults to 10000 (interpreted as a 100% vote).
export const tagVideoWithAioha = async (author, permlink, tag, weight = 10000) => {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) throw new Error('No tag provided');
  const op = (voter) => ['custom_json', {
    required_auths: [],
    required_posting_auths: [voter],
    id: VIEWER_TAG_CJ_ID,
    json: JSON.stringify({ app: 'threespeak', author, permlink, tag: t, weight }),
  }];

  if (isManteAuthLogin()) {
    return broadcastViaManteAuth([op(localStorage.getItem('user_id'))]);
  }
  if (usesThreespeakProxy()) {
    try {
      return await broadcastViaThreespeak([op(aioha.getCurrentUser())]);
    } catch (e) {
      if (!isNotGrantedError(e)) throw e; // not granted → sign it client-side below
    }
  }
  return withHiveAuthWaiting(async () => {
    const result = await aioha.signAndBroadcastTx([op(aioha.getCurrentUser())], KeyTypes.Posting);
    if (result.success) return { success: true, result: result.result };
    console.error('Tag broadcast rejected, full aioha result:', result);
    throw new Error(extractAiohaError(result, 'Tag failed'));
  }, 'Approve tag on HiveAuth...');
};

// Helper function to transfer HIVE or HBD
export const transferWithAioha = async (to, amount, currency, memo = '') => {
  // Transfers are an active-key op — a Butter Auth session can't sign them.
  // Route through the same active-auth modal handler as broadcastWithAioha.
  if (isManteAuthLogin()) {
    const from = localStorage.getItem('user_id')
    const formatted = `${Number(amount).toFixed(3)} ${currency}`
    return requestButrauthActiveSign([
      ['transfer', { from, to, amount: formatted, memo: memo || '' }]
    ])
  }
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.transfer(to, amount, currency, memo);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        console.error('Transfer rejected, full aioha result:', result);
        throw new Error(extractAiohaError(result, 'Transfer failed'));
      }
    } catch (error) {
      console.error('Transfer error:', error);
      throw error;
    }
  }, 'Approve transfer on HiveAuth...');
};

// Helper function to follow/unfollow a user
export const followWithAioha = async (target, follow = true) => {
  if (isManteAuthLogin()) {
    const follower = localStorage.getItem('user_id')
    const json = JSON.stringify(['follow', {
      follower,
      following: target,
      what: follow ? ['blog'] : []
    }])
    return broadcastViaManteAuth([['custom_json', {
      required_auths: [],
      required_posting_auths: [follower],
      id: 'follow',
      json
    }]])
  }
  if (usesThreespeakProxy()) {
    const follower = aioha.getCurrentUser()
    const json = JSON.stringify(['follow', { follower, following: target, what: follow ? ['blog'] : [] }])
    try {
      return await broadcastViaThreespeak([['custom_json', {
        required_auths: [], required_posting_auths: [follower], id: 'follow', json,
      }]])
    } catch (e) {
      if (!isNotGrantedError(e)) throw e // not granted → sign it client-side below
    }
  }
  return withHiveAuthWaiting(async () => {
    try {
      let result;
      if (follow) {
        result = await aioha.follow(target);
      } else {
        // Unfollow via custom_json (aioha has no unfollow method)
        const json = JSON.stringify(['follow', {
          follower: aioha.getCurrentUser(),
          following: target,
          what: []
        }]);
        result = await aioha.customJSON(KeyTypes.Posting, 'follow', json, 'Unfollow @' + target);
      }
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        console.error('Follow/Unfollow rejected, full aioha result:', result);
        throw new Error(extractAiohaError(result, 'Follow/Unfollow failed'));
      }
    } catch (error) {
      console.error('Follow error:', error);
      throw error;
    }
  }, follow ? 'Approve follow on HiveAuth...' : 'Approve unfollow on HiveAuth...');
};

// Helper function for custom_json operations
export const customJsonWithAioha = async (keyType, id, json, displayTitle = '') => {
  if (isManteAuthLogin() && keyType === KeyTypes.Posting) {
    const user = localStorage.getItem('user_id')
    return broadcastViaManteAuth([['custom_json', {
      required_auths: [],
      required_posting_auths: [user],
      id,
      json
    }]])
  }
  if (usesThreespeakProxy() && keyType === KeyTypes.Posting) {
    const u = aioha.getCurrentUser()
    try {
      return await broadcastViaThreespeak([['custom_json', {
        required_auths: [], required_posting_auths: [u], id, json,
      }]])
    } catch (e) {
      if (!isNotGrantedError(e)) throw e // not granted → sign it client-side below
    }
  }
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.customJSON(keyType, id, json, displayTitle);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        console.error('Custom JSON rejected, full aioha result:', result);
        throw new Error(extractAiohaError(result, 'Custom JSON failed'));
      }
    } catch (error) {
      console.error('Custom JSON error:', error);
      throw error;
    }
  }, 'Approve action on HiveAuth...');
};

// Helper function to post a comment
export const commentWithAioha = async (parentAuthor, parentPermlink, permlink, title, body, jsonMetadata = {}, options = null) => {
  if (isManteAuthLogin()) {
    const author = localStorage.getItem('user_id')
    const ops = [['comment', {
      parent_author: parentAuthor,
      parent_permlink: parentPermlink,
      author,
      permlink,
      title,
      body,
      json_metadata: JSON.stringify(jsonMetadata)
    }]]
    if (options) {
      ops.push(['comment_options', { author, permlink, ...options }])
    }
    return broadcastViaManteAuth(ops)
  }
  if (usesThreespeakProxy()) {
    const author = aioha.getCurrentUser()
    const ops = [['comment', {
      parent_author: parentAuthor, parent_permlink: parentPermlink, author, permlink,
      title, body, json_metadata: JSON.stringify(jsonMetadata),
    }]]
    if (options) ops.push(['comment_options', { author, permlink, ...options }])
    try {
      return await broadcastViaThreespeak(ops)
    } catch (e) {
      if (!isNotGrantedError(e)) throw e // not granted → sign it client-side below
    }
  }
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.comment(parentAuthor, parentPermlink, permlink, title, body, JSON.stringify(jsonMetadata), options);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        console.error('Comment rejected, full aioha result:', result);
        throw new Error(extractAiohaError(result, 'Comment failed'));
      }
    } catch (error) {
      console.error('Comment error:', error);
      throw error;
    }
  }, 'Approve comment on HiveAuth...');
};

// Generic broadcast for raw operations
// ManteAuth only supports posting-level ops — active key ops (transfers, etc.) will fail
export const broadcastWithAioha = async (operations, keyType = KeyTypes.Active) => {
  if (isManteAuthLogin() && keyType === KeyTypes.Posting) {
    return broadcastViaManteAuth(operations)
  }
  if (isManteAuthLogin() && keyType === KeyTypes.Active) {
    // Posting-only Butter Auth session — let the user sign this active op
    // with their own wallet / active key via the modal handler.
    return requestButrauthActiveSign(operations)
  }
  if (usesThreespeakProxy() && keyType === KeyTypes.Posting) {
    try {
      return await broadcastViaThreespeak(operations)
    } catch (e) {
      if (!isNotGrantedError(e)) throw e // not granted → sign it client-side below
    }
  }
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.signAndBroadcastTx(operations, keyType);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        console.error('Broadcast rejected, full aioha result:', result);
        throw new Error(extractAiohaError(result, 'Broadcast failed'));
      }
    } catch (error) {
      console.error('Broadcast error:', error);
      throw error;
    }
  }, 'Approve transaction on HiveAuth...');
};

// Sign an arbitrary message with the given key (used for image-upload challenges).
export const signMessageWithAioha = async (message, keyType = KeyTypes.Posting, displayTitle = 'Approve image upload signature') => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.signMessage(message, keyType);
      if (result.success && result.result) {
        return { success: true, result: result.result };
      }
      console.error('Sign message rejected, full aioha result:', result);
      throw new Error(result.error || result.errorMessage || 'Sign message failed');
    } catch (error) {
      console.error('Sign message error:', error);
      throw error;
    }
  }, displayTitle);
};

// ManteAuth proxy broadcast via 3speak backend service
// Auth happens via httpOnly cookie set during /api/manteauth/exchange — no token in JS.
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api'

// Honors the VITE_ENABLE_BUTRAUTH=false flag (when disabled, treat ManteAuth
// state as absent so no manteauth-specific code paths run) unless the hidden
// soft-launch unlock (butrauth_unlocked) has been set, which forces it on.
export const isManteAuthLogin = () => {
  const unlocked = localStorage.getItem('butrauth_unlocked') === 'true';
  if (import.meta.env.VITE_ENABLE_BUTRAUTH === 'false' && !unlocked) return false;
  return localStorage.getItem('manteauth_login') === 'true'
}

export const broadcastViaManteAuth = async (operations) => {
  const res = await fetch(`${THREESPEAK_API}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ operations })
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || 'Broadcast failed')
  }
  return { success: true, result: data.result }
}

// "Sign in with Hive" session for wallet logins (Keychain/HiveAuth/PeakVault/
// Ledger). The user signs a server-issued nonce with their POSTING key once; the
// server verifies it against their on-chain posting authority and sets an
// httpOnly session cookie. The @threespeak broadcast proxy then trusts that
// cookie instead of a public app key + a claimed username — so nobody can act as
// another user. No-op for ManteAuth (own cookie) and HiveSigner (own token).
/**
 * Make the server session belong to whoever is signed in NOW.
 *
 * The session cookie is httpOnly and survives an account switch, and the gate
 * trusts it over anything the page claims. So after switching accounts the
 * cookie still named the previous user — and since a video's own creator is
 * always entitled, a creator who switched accounts kept watching their own
 * supporters-only videos in full instead of hitting the paywall.
 *
 * Clearing before re-establishing matters: a stale cookie outranks the new
 * login on the server, so leaving it in place would keep the old identity even
 * after a successful mint.
 */
export const syncWalletSession = async () => {
  const current = aioha.getCurrentUser()
  try {
    const resp = await fetch(`${THREESPEAK_API}/auth/wallet/status`, { credentials: 'include' })
    if (!resp.ok) return false
    const { user } = await resp.json()
    if (user === current) return true          // already correct
    if (!user && !current) return false        // nobody logged in either side
    await fetch(`${THREESPEAK_API}/auth/wallet/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
    walletSessionPromise = null                // the de-dupe cache is for the OLD user
    if (!current) return false                 // logged out — cleared, nothing to mint
    return await establishWalletSession()
  } catch {
    return false
  }
}

let walletSessionPromise = null
export const establishWalletSession = async (wantAccount = null) => {
  if (isManteAuthLogin()) return false
  // This module holds its OWN Aioha instance, separate from the one the login
  // hook builds, and each only calls loadAuth() when it is constructed. This
  // one is constructed at page load, so a login that happens afterwards on the
  // other instance is invisible to it until the next reload. Re-reading the
  // persisted auth here picks it up. Without this, establishing at login is a
  // no-op and the session is only ever minted lazily, on the first broadcast —
  // so a viewer who never posts stays anonymous to the gate and sees the
  // paywall on videos they are entitled to.
  //
  // 🚨 And re-read it when this instance holds a DIFFERENT account from the one
  // being acted for. Switching accounts happens on the other instance, so an
  // "is anybody logged in" check passes with the OLD user still loaded here —
  // and re-minting then produces a session for the account you just left. That
  // is what made a switched account keep signing as the previous one.
  const current = aioha.getCurrentUser()
  const stale = !!wantAccount && !!current
    && String(current).toLowerCase() !== String(wantAccount).toLowerCase()
  if (!current || stale) {
    try { aioha.loadAuth() } catch { /* nothing persisted yet */ }
  }
  const provider = aioha.getCurrentProvider()
  if (!provider) return false

  // HiveSigner cannot do the SIWH challenge — it has no posting key to sign
  // with — so it trades its access token for the same cookie instead. The
  // server verifies the token against hivesigner.com before minting anything.
  if (provider === Providers.HiveSigner) {
    const hsToken = localStorage.getItem('hivesignerToken')
    if (!hsToken) return false
    try {
      const resp = await fetch(`${THREESPEAK_API}/auth/hivesigner/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hsToken}` },
        credentials: 'include',
        body: '{}',
      })
      return resp.ok
    } catch {
      return false
    }
  }

  const username = aioha.getCurrentUser()
  if (!username) return false
  if (walletSessionPromise) return walletSessionPromise // de-dupe concurrent calls
  walletSessionPromise = (async () => {
    try {
      const chRes = await fetch(`${THREESPEAK_API}/auth/wallet/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username })
      })
      const chData = await chRes.json().catch(() => ({}))
      if (!chRes.ok || !chData.challenge) throw new Error(chData.error || 'Could not start sign-in')
      // MUST go through withHiveAuthWaiting: on HiveAuth the approval happens in
      // the user's phone app, and this wrapper is what raises the "waiting for
      // approval" prompt (QR / deep link). Without it the signature request is
      // sent but the user is never shown anything to approve, so sign-in silently
      // times out — and every HiveAuth user then fails /api/broadcast with 401.
      const signed = await withHiveAuthWaiting(
        () => aioha.signMessage(chData.challenge, KeyTypes.Posting),
        'Approve sign-in on HiveAuth...',
      )
      if (!signed?.success || !signed.result) {
        throw new Error(extractAiohaError(signed, 'Sign-in signature was declined'))
      }
      const loginRes = await fetch(`${THREESPEAK_API}/auth/wallet/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, challenge: chData.challenge, signature: signed.result })
      })
      const loginData = await loginRes.json().catch(() => ({}))
      if (!loginRes.ok || !loginData.success) throw new Error(loginData.error || 'Sign-in failed')
      return true
    } catch (e) {
      console.warn('Wallet session establishment failed:', e?.message || e)
      return false
    } finally {
      walletSessionPromise = null
    }
  })()
  return walletSessionPromise
}

// Clear BOTH server-side session cookies (ManteAuth + SIWH wallet). Used when a
// proxy broadcast resolves to the WRONG user — i.e. a session cookie left over
// from a previously logged-in account (switching wallets without logging out).
// Safe in the wallet broadcast path: a ManteAuth cookie present there is stale,
// because ManteAuth logins never take this path.
export const clearServerSession = async () => {
  walletSessionPromise = null
  await Promise.allSettled([
    fetch(`${THREESPEAK_API}/auth/wallet/logout`, { method: 'POST', credentials: 'include' }),
    fetch(`${THREESPEAK_API}/manteauth/logout`, { method: 'POST', credentials: 'include' }),
  ])
}

// @threespeak proxy broadcast — the user granted @threespeak posting authority
// (via the upload gate), so the server signs posting-level ops on their behalf,
// no wallet popup per action. Authentication of WHICH user, by provider:
//   • HiveSigner → Authorization: Bearer <token> (verified against hivesigner.com).
//   • ManteAuth → its own httpOnly session cookie (see broadcastViaManteAuth).
//   • Keychain/HiveAuth/PeakVault/Ledger → the SIWH session cookie (credentials:
//     include). The legacy X-API-Key + claimed username is still sent as a
//     fallback while the server keeps ALLOW_APPKEY_AUTH on; once that's off, a
//     401 here means "no session yet" → establish one and retry.
export const broadcastViaThreespeak = async (operations) => {
  const provider = aioha.getCurrentProvider()
  const isWallet = provider && provider !== Providers.HiveSigner

  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' }
    const body = { operations }
    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken')
      if (!token) {
        throw new Error('HiveSigner session expired — please reconnect HiveSigner and try again')
      }
      headers.Authorization = `Bearer ${token}`
    } else {
      headers['X-API-Key'] = EMBED_API_KEY // legacy fallback; SIWH cookie is preferred
      body.username = aioha.getCurrentUser()
    }
    const res = await fetch(`${THREESPEAK_API}/broadcast`, {
      method: 'POST',
      headers,
      credentials: 'include', // send the SIWH / ManteAuth session cookie
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  let { res, data } = await doPost()
  // Recover from a missing OR mismatched server session:
  //   • 401                          → no session yet (app-key auth disabled).
  //   • 403 "Operation not allowed"  → the session cookie is bound to a DIFFERENT
  //     account than the one we're posting for (e.g. switched wallets without
  //     logging out). Clear the stale cookies first, then establish fresh.
  // A 403 "Authorization required" is different (no @threespeak grant) and is
  // left to the caller's client-side-signing fallback.
  const mismatch = res.status === 403 && /operation not allowed/i.test(data.error || '')
  if (mismatch) {
    // A stale session cookie (from a previously logged-in account) outranked our
    // current credential on the server. Clear it, then retry with the right
    // identity — wallet logins re-establish a SIWH session; HiveSigner's Bearer
    // token authenticates on its own once the stale cookie is gone.
    await clearServerSession()
    if (!isWallet || await establishWalletSession()) {
      ({ res, data } = await doPost())
    }
  } else if (isWallet && res.status === 401) {
    if (await establishWalletSession()) {
      ({ res, data } = await doPost())
    }
  }
  if (!res.ok || !data.success) {
    // A bare 401 "Unauthorized" from the server tells the user nothing. Since
    // ALLOW_APPKEY_AUTH=0 the legacy public-app-key path is closed, so a 401
    // here always means "this login has no usable server session" — say which
    // login and what to do about it.
    if (res.status === 401) {
      throw new Error(
        provider === Providers.HiveSigner
          ? 'Your HiveSigner session has expired. Please reconnect HiveSigner (log out and back in) and try again.'
          : 'Could not verify your Hive account. Approve the sign-in request from your wallet, or log out and back in, then try again.',
      )
    }
    throw new Error(data.error || data.message || 'Broadcast via @threespeak failed')
  }
  return { success: true, result: data.result }
}

// Check if user is logged in (aioha or ManteAuth)
export const isLoggedIn = () => {
  return aioha.isLoggedIn() || isManteAuthLogin();
};

// Get current user
export const getCurrentUser = () => {
  return aioha.getCurrentUser();
};

/**
 * The account an operation should be attributed to.
 *
 * A ButrAuth session never logs into aioha (there is no wallet provider behind
 * it), so `aioha.getCurrentUser()` is null for those users. Building an op with
 * that null puts `required_posting_auths: [null]` on the wire, and the server
 * rejects it as "Operation not allowed" — which is why every broadcast helper
 * above reads `user_id` on the ButrAuth branch. Anything assembling ops BY HAND
 * must use this instead of getCurrentUser().
 */
export const getOperationUser = () => {
  if (isManteAuthLogin()) {
    try { return localStorage.getItem('user_id') || null; } catch { return null; }
  }
  return aioha.getCurrentUser();
};

// Get current provider
export const getCurrentProvider = () => {
  return aioha.getCurrentProvider();
};

export { Asset, KeyTypes, Providers };
export default aioha;
