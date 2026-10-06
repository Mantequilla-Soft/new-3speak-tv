// 3Speak's warm-up backend: the incubation SDK's ready-made proxy, pointed at
// Butter Auth's hosted incubation service, with 3Speak's own goals.
//
// Everything generic (which routes the frontend may reach, who may do what,
// passing refusals through) is the SDK's createWarmupHandler. What is 3Speak's
// is only this file:
//
//   goals         the ladders a person climbs before the team reviews them for
//                 a Hive account, one per kind of user (viewer, creator,
//                 advertiser). The counts come from the hosted service; watch
//                 time is 3Speak's own measurement (the player writes it into
//                 3Speak's database) and comes from the checker.
//
//   claim assets  at graduation, uploads made under the warm-up handle move to
//                 the new Hive account. Those are 3Speak's embed-video records,
//                 so the checker does the write.
//
// The SDK is ESM and this server is CommonJS under Node 18, so the SDK's pieces
// are handed in by index.cjs after its dynamic import.

const CHECKER_INTERNAL_URL = (process.env.CHECKER_INTERNAL_URL || 'http://127.0.0.1:3131').replace(/\/+$/, '')

// What a person has to do before the team reviews them for a Hive account,
// by what they told us they are here for (the SDK's WarmupGoals tracks). They
// pick on the welcome screen or on their profile.
//
// `time` is last in every list because it is the only goal you cannot go and
// do: a minimum age between signing up and being reviewable.
const watch = (need) => ({ type: 'watch', need, unit: 'seconds', measure: ({ handle }) => watchSeconds(handle) })
const TRACKS = {
  viewer: [
    watch(3600),
    { type: 'comment', need: 10 },
    { type: 'follow', need: 5 },
    { type: 'subscription', need: 1 },
    { type: 'time', from: 'days', need: 5 }
  ],
  creator: [
    { type: 'video', need: 1 },
    { type: 'short', need: 1 },
    { type: 'follow', need: 5 },
    { type: 'subscription', need: 2 },
    watch(1200),
    { type: 'comment', need: 5 },
    { type: 'time', from: 'days', need: 3 }
  ],
  // A brand is judged by its profile: name, about and logo filled in (no banner,
  // owner 2026-10-01: keep it as simple as possible). Whether they fit the brand is
  // the reviewer's call.
  //
  // Then a way to reach the business: an email (required), plus EITHER a postal
  // address OR a website on the profile. Email and address are private and
  // off-chain (see contactComplete); the website is a public profile field.
  advertiser: [
    { type: 'profile', need: 3, fields: ['name', 'about', 'profile_image'] },
    { type: 'contact', need: 1, measure: ({ userId, stats }) => contactComplete(userId, stats) },
    { type: 'time', from: 'days', need: 1 }
  ]
}
// Which tracks a NEW pick may choose. The advertiser track is closed at the public
// signup launch (owner 2026-10-06: viewers and creators only for now). People
// already on it keep their goals, because TRACKS above still has them.
// WARMUP_ADVERTISER_SIGNUP=true reopens it (and VITE_ENABLE_ADVERTISER_SIGNUP in
// the frontend shows the option again).
function trackOpen(track) {
  if (track === 'viewer' || track === 'creator') return true
  return track === 'advertiser' && process.env.WARMUP_ADVERTISER_SIGNUP === 'true'
}

// A length floor for a reply to count, not a quality judgement.
const MIN_COMMENT_CHARS = 20

async function watchSeconds(handle) {
  const r = await fetch(`${CHECKER_INTERNAL_URL}/incubation/internal/watch/${encodeURIComponent(handle)}`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!r.ok) throw new Error(`checker watch returned ${r.status}`)
  return Number((await r.json()).seconds) || 0
}

/**
 * 1 once an advertiser has given an email and either an address or a website.
 *
 * 🚨 The email and address live ONLY in the checker's private incubation_contacts
 * collection, never in the incubation profile: that profile is shown to others and
 * becomes the Hive account's profile at graduation, and these must never reach the
 * chain. The website is the one public field here, read from the profile stats.
 */
async function contactComplete(userId, stats) {
  if (!userId) return 0
  const c = await readContact(userId)
  const website = (stats?.profileFilled || []).includes('website')
  return c.email && (c.addressComplete || website) ? 1 : 0
}

async function readContact(userId) {
  const r = await fetch(`${CHECKER_INTERNAL_URL}/incubation/internal/contact/${encodeURIComponent(userId)}`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!r.ok) throw new Error(`checker contact returned ${r.status}`)
  return r.json()
}

async function readContactByHandle(handle) {
  const r = await fetch(`${CHECKER_INTERNAL_URL}/incubation/internal/contact-by-handle/${encodeURIComponent(handle)}`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!r.ok) throw new Error(`checker contact-by-handle returned ${r.status}`)
  return r.json()
}

async function saveContact(userId, body) {
  const r = await fetch(`${CHECKER_INTERNAL_URL}/incubation/internal/contact/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  })
  const data = await r.json().catch(() => ({}))
  return { status: r.status, data }
}

async function claimAssets({ userId, handle, hiveUsername }) {
  const r = await fetch(`${CHECKER_INTERNAL_URL}/incubation/internal/claim-assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // userId too: the checker links an advertiser's private contact record to the
    // new Hive account, which is how the site knows that account is an advertiser.
    body: JSON.stringify({ userId, handle, hiveUsername }),
    signal: AbortSignal.timeout(10000)
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `checker claim-assets returned ${r.status}`)
  return body
}

/**
 * @param sdk  { WarmupGoals, createWarmupHandler } from the incubation SDK
 * @param deps { inc, butr, getSession, getHiveUser } from index.cjs
 */
function createWarmupBackend(sdk, { inc, butr, getSession, getHiveUser }) {
  const goals = new sdk.WarmupGoals({ tracks: TRACKS, minCommentChars: MIN_COMMENT_CHARS, butrauth: butr })
  return sdk.createWarmupHandler({
    client: inc,
    goals,
    butrauth: butr,
    getSession,
    getHiveUser,
    onClaimAssets: claimAssets
  })
}

module.exports = { createWarmupBackend, TRACKS, trackOpen, MIN_COMMENT_CHARS, readContact, readContactByHandle, saveContact }
