// The owner's proof for a scheduled-post write on the checker
// (3speakchecks routes/scheduledPosts.js: create, update, cancel).
//
// The checker takes a scheduled post from the public app key, and its cron later
// publishes the post AS its owner under the posting authority they granted
// @threespeak. So create/update/cancel carry a signature under the owner's posting
// authority: the owner's own key (a wallet signs it in the browser), or
// @threespeak's posting key, which this API uses only after it has verified the
// owner's session (POST /api/scheduled-posts/signature) or, for the batch
// importer, after the owner started the batch from a verified session.
//
// 🚨 Keep scheduledPostMessage() in lockstep with buildCreateMessage /
// buildUpdateMessage / buildCancelMessage in the checker, and with
// src/utils/scheduledPostProof.js. tests/server/checker-contract.test.js
// checks a signature from here against the checker's own verifier.
const { PrivateKey, cryptoUtils } = require('@hiveio/dhive')

const ACTIONS = new Set(['create', 'update', 'cancel'])
const OWNER_RE = /^[a-z][a-z0-9.-]{2,15}$/
// Wider than the app's own permlinks ([a-z0-9-]) so an older post can still be
// edited or cancelled; never `|`, whitespace or anything else that could blur a field.
const PERMLINK_RE = /^[A-Za-z0-9._-]{1,255}$/

/**
 * The exact message the checker verifies. `scheduledOn` (create only) is the
 * string sent in the create body, byte for byte: the checker signs over it as sent.
 */
function scheduledPostMessage({ action, owner, permlink, scheduledOn, timestamp }) {
  return action === 'create'
    ? ['scheduled-post', 'create', owner, permlink, scheduledOn, String(timestamp)].join('|')
    : ['scheduled-post', action, owner, permlink, String(timestamp)].join('|')
}

/**
 * Validates a request to sign. Returns the clean fields, or { error }.
 * The owner and permlink are used exactly as given (no trimming or lowercasing),
 * because the checker builds its message from the body it receives and the two
 * must match byte for byte. `|` can never appear in any field, so a field can
 * never shift the message's other parts.
 */
function parseScheduledPostRequest(body) {
  const b = body || {}
  const action = typeof b.action === 'string' ? b.action : ''
  const owner = typeof b.owner === 'string' ? b.owner : ''
  const permlink = typeof b.permlink === 'string' ? b.permlink : ''
  if (!ACTIONS.has(action)) return { error: 'invalid action' }
  if (!OWNER_RE.test(owner)) return { error: 'invalid owner' }
  if (!PERMLINK_RE.test(permlink)) return { error: 'invalid permlink' }
  if (action !== 'create') return { action, owner, permlink }
  const scheduledOn = typeof b.scheduledOn === 'string' ? b.scheduledOn : ''
  if (!scheduledOn || scheduledOn.length > 64 || scheduledOn.includes('|') || !Number.isFinite(Date.parse(scheduledOn))) {
    return { error: 'invalid scheduledOn' }
  }
  return { action, owner, permlink, scheduledOn }
}

/** { signature, timestamp } over the message for `fields`, signed with `wif`. */
function signScheduledPost(wif, fields, now = Date.now()) {
  const timestamp = now
  const message = scheduledPostMessage({ ...fields, timestamp })
  const signature = PrivateKey.fromString(wif).sign(cryptoUtils.sha256(Buffer.from(message, 'utf8'))).toString()
  return { signature, timestamp }
}

module.exports = { scheduledPostMessage, parseScheduledPostRequest, signScheduledPost, OWNER_RE, PERMLINK_RE }
