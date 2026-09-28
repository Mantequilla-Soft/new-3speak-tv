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
// pick on the welcome screen or their profile, and can change it later.
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
  // A brand is judged by its profile: name, about, logo, banner and website
  // filled in. Whether they fit the brand is the reviewer's call.
  advertiser: [
    { type: 'profile', need: 5, fields: ['name', 'about', 'profile_image', 'cover_image', 'website'] },
    { type: 'time', from: 'days', need: 1 }
  ]
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

async function claimAssets({ handle, hiveUsername }) {
  const r = await fetch(`${CHECKER_INTERNAL_URL}/incubation/internal/claim-assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, hiveUsername }),
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

module.exports = { createWarmupBackend, TRACKS, MIN_COMMENT_CHARS }
