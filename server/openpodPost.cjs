// Server-side builder for the Hive post that announces a STANDALONE OpenPods
// stream. Used by POST /api/openpods/announce, which the hangouts server calls
// when a stream started from OBS (a "stream template") goes live with nobody in
// a browser to announce it.
//
// 🚨 KEEP IN SYNC with the browser's `postFullPost` (src/utils/openpodAnnounce.js,
// standalone branch), plus the helpers it uses: `oaEnvelope` + `threespeakVideo`
// (src/utils/openAttribute.js) and `enforceLockedBeneficiaries`
// (src/utils/beneficiaries.js). A stream announced from OBS must be the SAME post
// a browser announcement would have produced, so every 3Speak-aware frontend
// renders both identically. Change one, change the other.
//
// Only the standalone branch is ported: templates only ever start standalone
// streams. A conference room announcement stays browser-only.

const DEFAULT_COMMUNITY = 'hive-181335'

// --- openAttribute.js ------------------------------------------------------
const OA_VERSION = 1
const OA_ARTICLE = 'Article'

function oaEnvelope(object) {
  return { oa: { v: OA_VERSION, object } }
}

function threespeakVideo({ surface, orientation } = {}) {
  if (!surface || !orientation) return {}
  // `live` never carries a duration (see openAttribute.js).
  return { 'threespeak.video': { surface, orientation } }
}

// --- beneficiaries.js ------------------------------------------------------
// Only the platform-fund rule applies to a stream: nothing is encoded (no
// encoder.pay split) and nothing is remixed (no attribution split).
const LOCKED_FUND_ACCOUNT = 'threespeakfund'
const LOCKED_FUND_WEIGHT = 10 * 100

function enforceLockedBeneficiaries(beneMap, { isPremium }) {
  if (!isPremium) {
    beneMap.set(LOCKED_FUND_ACCOUNT, Math.max(beneMap.get(LOCKED_FUND_ACCOUNT) || 0, LOCKED_FUND_WEIGHT))
  } else {
    beneMap.delete(LOCKED_FUND_ACCOUNT)
  }
  return beneMap
}

// --- validation ------------------------------------------------------------
const HIVE_USER_RE = /^[a-z][a-z0-9.-]{2,15}$/
const PERMLINK_RE = /^[a-z0-9][a-z0-9-]{0,254}$/
const COMMUNITY_RE = /^hive-\d{1,10}$/

const str = (v) => (typeof v === 'string' ? v : '')

/**
 * Validate and normalise the announce request body. Returns
 * `{ ok: true, input }` or `{ ok: false, error }` (a short human-readable reason
 * for the server log; the caller only ever sees `reason: 'invalid'`).
 */
function normaliseAnnounceInput(body) {
  const b = body && typeof body === 'object' ? body : {}
  const host = str(b.host).trim().toLowerCase()
  const room = str(b.room).trim()
  if (!HIVE_USER_RE.test(host)) return { ok: false, error: 'host' }
  if (!PERMLINK_RE.test(room)) return { ok: false, error: 'room' }

  const title = str(b.title).trim()
  if (!title || title.length > 255) return { ok: false, error: 'title' }
  const description = str(b.description)
  if (description.length > 5000) return { ok: false, error: 'description' }

  const thumbnail = str(b.thumbnail).trim()
  if (thumbnail && (!/^https:\/\/\S+$/i.test(thumbnail) || thumbnail.length > 1000)) {
    return { ok: false, error: 'thumbnail' }
  }

  if (b.tags != null && !Array.isArray(b.tags)) return { ok: false, error: 'tags' }
  // Same sanitising as the create-stream form's tag chips, so a valid tag passes
  // through unchanged.
  const tags = (b.tags || [])
    .map((t) => str(t).trim().toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)
    .slice(0, 10)

  // postFullPost falls back to 3Speak's community for anything that is not a
  // usable tag; a malformed one is treated the same way.
  const rawCommunity = str(b.community).trim()
  const community = COMMUNITY_RE.test(rawCommunity) ? rawCommunity : DEFAULT_COMMUNITY

  if (b.beneficiaries != null && !Array.isArray(b.beneficiaries)) return { ok: false, error: 'beneficiaries' }
  const beneList = []
  for (const x of (b.beneficiaries || [])) {
    const account = str(x && x.account).trim().toLowerCase()
    const weight = Number(x && x.weight)
    if (!HIVE_USER_RE.test(account)) return { ok: false, error: 'beneficiary account' }
    if (!Number.isInteger(weight) || weight < 1 || weight > 10000) return { ok: false, error: 'beneficiary weight' }
    beneList.push({ account, weight })
  }
  if (beneList.length > 8) return { ok: false, error: 'too many beneficiaries' }

  // Orientation of the published frame. The browser reads it off the studio's
  // composite; here it comes from the hangouts server: an explicit
  // `orientation`, else the room's `portrait` flag. Unknown → no attribute,
  // exactly as the browser does with an older SDK that reports nothing.
  const o = str(b.orientation)
  const orientation = ['landscape', 'vertical', 'square'].includes(o)
    ? o
    : (b.portrait === true ? 'vertical' : b.portrait === false ? 'landscape' : null)

  return {
    ok: true,
    input: {
      host,
      room,
      title,
      description,
      thumbnail,
      tags,
      community,
      declineRewards: b.declineRewards === true,
      rewardPowerup: b.rewardPowerup === true,
      beneList,
      isPremium: b.premium === true,
      orientation,
    },
  }
}

/**
 * The comment + comment_options operations for a standalone stream's
 * announcement. Mirrors postFullPost (standalone branch) line for line.
 */
function buildStreamAnnounceOps(input) {
  const { host, room: roomName, title, description, thumbnail: thumbnailUrl, community: communityTag, orientation, isPremium } = input

  const tags = [communityTag, 'openpod', '3speak', ...input.tags].filter((t, i, a) => t && a.indexOf(t) === i)

  const embedUrl = `https://play.3speak.tv/embed?v=${host}/${roomName}`
  const watchUrl = `https://3speak.tv/watch?v=${host}/${roomName}`
  const descPart = (description || '').trim()
  const body = `${embedUrl}\n\n` +
    (descPart ? `${descPart}\n\n` : '') +
    `---\n▶ [Watch on 3speak.tv](${watchUrl})`

  const permlink = roomName

  const jsonMetadata = {
    app: '3speak/embed',
    format: 'markdown',
    tags,
    ...(thumbnailUrl ? { image: [thumbnailUrl] } : {}),
    openpodRoom: roomName,
    ...oaEnvelope(OA_ARTICLE),
    links: [embedUrl],
    video: {
      platform: '3speak',
      url: embedUrl,
      reusable: false,
      live: true,
      ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
      info: {
        platform: '3speak',
        author: host,
        permlink: roomName,
        title: title || '',
        duration: 0,
        live: true,
        ...(thumbnailUrl ? { sourceMap: [{ url: thumbnailUrl, type: 'thumbnail' }] } : {}),
      },
    },
    ...threespeakVideo({ surface: 'live', orientation }),
  }

  // Hive rejects an EMPTY beneficiaries extension, so a Pro host with no splits
  // gets none at all; declining payout skips beneficiaries entirely.
  let allBeneficiaries = []
  if (!input.declineRewards) {
    const beneMap = new Map()
    for (const b of input.beneList) {
      beneMap.set(b.account, Math.max(beneMap.get(b.account) || 0, b.weight))
    }
    enforceLockedBeneficiaries(beneMap, { isPremium })
    allBeneficiaries = [...beneMap.entries()]
      .map(([account, weight]) => ({ account, weight }))
      .sort((a, b) => a.account.localeCompare(b.account))
  }
  const total = allBeneficiaries.reduce((s, b) => s + b.weight, 0)
  if (total > 10000) return { ok: false, error: 'beneficiaries over 100%' }

  const commentOptions = {
    author: host,
    permlink,
    max_accepted_payout: input.declineRewards ? '0.000 HBD' : '1000000.000 HBD',
    percent_hbd: input.rewardPowerup ? 0 : 10000,
    allow_votes: true,
    allow_curation_rewards: true,
    extensions: allBeneficiaries.length > 0 ? [[0, { beneficiaries: allBeneficiaries }]] : [],
  }

  // Same shape commentWithAioha → broadcastViaThreespeak sends.
  const operations = [
    ['comment', {
      parent_author: '',
      parent_permlink: communityTag,
      author: host,
      permlink,
      title,
      body,
      json_metadata: JSON.stringify(jsonMetadata),
    }],
    ['comment_options', commentOptions],
  ]
  return { ok: true, operations, permlink }
}

module.exports = { normaliseAnnounceInput, buildStreamAnnounceOps, LOCKED_FUND_ACCOUNT }
