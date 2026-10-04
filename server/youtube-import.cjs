// ── ▶️ YouTube import ─────────────────────────────────────────────────────────
// Lets a creator who PROVED ownership of a YouTube channel (social_links via the
// checker's /verify routes) pick one of that channel's public videos and bring it
// to 3Speak. The server downloads it with yt-dlp, the browser pulls the file back
// and drops it into the normal embed uploader with title/description/tags/thumb
// prefilled. The browser does the TUS upload itself, so nothing here touches the
// embed service.
//
// Ownership is enforced server side twice: the video list only ever comes from
// the caller's verified channels, and a download job re-checks via the Data API
// that the video's channelId is one of them. Never trust a client-supplied id.
//
// Downloads from a datacenter IP get "Sign in to confirm you're not a bot".
// YTDLP_PROXY (residential proxy URL), YTDLP_COOKIES (Netscape cookie file) and
// YTDLP_EXTRA_ARGS are the knobs for that. When the download fails the page falls
// back to "download it from YouTube Studio yourself", with the metadata still
// prefilled, so the feature is usable either way.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { Readable, Transform } = require('stream')
const { pipeline } = require('stream/promises')

const YT_API_KEY = process.env.YOUTUBE_API_KEY || ''
const VERIFIER_URL = (process.env.SOCIAL_VERIFIER_URL || 'https://checker.3speak.tv').replace(/\/+$/, '')
const TOOLS = process.env.YT_IMPORT_TOOLS || '/mnt/HC_Volume_103240961/prodops/services/yt-import-tools'
const YTDLP_BIN = process.env.YTDLP_BIN || path.join(TOOLS, 'venv/bin/yt-dlp')
const DENO_BIN = process.env.YTDLP_DENO || path.join(TOOLS, 'bin/deno')
const WORK_DIR = process.env.YT_IMPORT_DIR || '/mnt/HC_Volume_103240961/prodops/yt-import-tmp'
const YTDLP_PROXY = process.env.YTDLP_PROXY || ''
const YTDLP_COOKIES = process.env.YTDLP_COOKIES || ''
const YTDLP_EXTRA_ARGS = (process.env.YTDLP_EXTRA_ARGS || '').split(/\s+/).filter(Boolean)

// TikTok only serves video files to a real logged-in browser session (guest
// sessions, our server and dtk all get 403). POC 2026-10-04: a throwaway TikTok
// account's cookies.txt (Netscape) + the user agent of the browser it came from,
// both prodops-only 600. yt-dlp with them downloads from this server, no proxy.
const TIKTOK_SESSION_DIR = process.env.TIKTOK_SESSION_DIR || path.join(TOOLS, 'tiktok-session')
function tiktokSession() {
  const cookies = path.join(TIKTOK_SESSION_DIR, 'cookies.txt')
  const uaFile = path.join(TIKTOK_SESSION_DIR, 'user-agent.txt')
  try {
    const ua = fs.readFileSync(uaFile, 'utf8').trim()
    if (ua && fs.statSync(cookies).size > 0) return { cookies, ua }
  } catch { /* no session configured */ }
  return null
}
// Import limits. Every byte goes through the paid residential proxy (~18 MB per
// minute at 1080p, measured 2026-10-04), so these are the cost knobs as much as
// quality ones. Owner's call 2026-10-04: 30 minutes; 480p (3Speak's base
// resolution), 1080p for 3Speak Premium.
const MAX_DURATION_S = Number(process.env.YT_IMPORT_MAX_DURATION_S) || 30 * 60
const MAX_HEIGHT = Math.max(144, Number(process.env.YT_IMPORT_MAX_HEIGHT) || 480)
const MAX_HEIGHT_PREMIUM = Math.max(MAX_HEIGHT, Number(process.env.YT_IMPORT_MAX_HEIGHT_PREMIUM) || 1080)
const CHECKER_URL = (process.env.CHECKER_URL || VERIFIER_URL).replace(/\/+$/, '')
const LIMIT_MESSAGE = `This video is longer than the ${Math.round(MAX_DURATION_S / 60)}-minute import limit`
const MAX_CONCURRENT = Number(process.env.YT_IMPORT_MAX_CONCURRENT) || 2
const MAX_JOBS_PER_DAY = Number(process.env.YT_IMPORT_MAX_PER_DAY) || 20
const FILE_TTL_MS = 3 * 3600 * 1000
// A block costs ~1s and a few MB before any video data flows, so trying several
// exit IPs is cheap. Owner's call 2026-10-04: 5.
const YTDLP_MAX_ATTEMPTS = Math.max(1, Number(process.env.YTDLP_MAX_ATTEMPTS) || 5)
const YTDLP_AUTO_UPDATE = process.env.YTDLP_AUTO_UPDATE !== 'false'
const PIP_BIN = path.join(path.dirname(YTDLP_BIN), 'pip')

// Residential proxies: googlevideo URLs are bound to the IP that asked for them, so
// one download must keep ONE exit IP from start to end, and a blocked attempt should
// retry from a DIFFERENT one. YTDLP_PROXY may carry placeholders for that, filled in
// fresh per attempt (use whichever the provider's sticky-session syntax needs):
//   {session}    random id, for providers that pin the IP by a session name in the
//                username, e.g. http://user-session-{session}:pass@host:port
//   {port:A-B}   random port in A..B, for providers that pin the IP by port
// Without a placeholder the proxy is used as-is and a blocked attempt is not retried
// (it would leave from the same IP again).
const PROXY_ROTATES = /\{session\}|\{port:\d+-\d+\}/.test(YTDLP_PROXY)
function proxyForAttempt() {
  if (!YTDLP_PROXY) return ''
  const session = crypto.randomBytes(6).toString('hex')
  return YTDLP_PROXY
    .replace(/\{session\}/g, session)
    .replace(/\{port:(\d+)-(\d+)\}/g, (_, a, b) => String(Number(a) + crypto.randomInt(Number(b) - Number(a) + 1)))
}
// Proxy URLs carry credentials; never let one reach a log line or a client.
const scrubSecrets = (text) => String(text || '').replace(/\/\/[^\s/@]+@/g, '//***@')

// ── Discord alerts ───────────────────────────────────────────────────────────
// Failed imports and blocked users go to a Discord webhook as an embed, so a
// YouTube/TikTok breakage is noticed the day it happens. Same alert again within
// 10 minutes is dropped, and there are at most 30 per hour, so a bad day cannot
// flood the channel. Never carries proxy credentials or cookies.
const ALERT_WEBHOOK = process.env.YT_IMPORT_ALERT_WEBHOOK || ''
const ALERT_ENV = process.env.YT_IMPORT_ENV_LABEL || 'preview'
const alertRecent = new Map()
let alertTimes = []
function alertDiscord({ title, color, user, platform, videoId, url, code, message, fields = [] }) {
  if (!ALERT_WEBHOOK) return
  const now = Date.now()
  const key = `${title}|${user}|${videoId}|${code}`
  if (now - (alertRecent.get(key) || 0) < 10 * 60 * 1000) return
  alertTimes = alertTimes.filter((t) => now - t < 3600 * 1000)
  if (alertTimes.length >= 30) return
  alertRecent.set(key, now)
  alertTimes.push(now)
  for (const [k, t] of alertRecent) if (now - t > 3600 * 1000) alertRecent.delete(k)
  const f = (name, value, inline = true) => (value ? { name, value: String(value).slice(0, 1024), inline } : null)
  const embed = {
    title: String(title).slice(0, 256),
    color,
    url: url || undefined,
    timestamp: new Date().toISOString(),
    footer: { text: `3Speak importer (${ALERT_ENV})` },
    fields: [
      f('User', user ? `@${user}` : ''),
      f('Platform', platform),
      f('Error code', code),
      f('Video', url ? `[${videoId}](${url})` : videoId, false),
      f('Message', message ? `\`\`\`${scrubSecrets(message).slice(0, 1000)}\`\`\`` : '', false),
      ...fields.map((x) => f(x.name, x.value, x.inline !== false)),
    ].filter(Boolean),
  }
  fetch(ALERT_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '3Speak Importer', embeds: [embed] }),
    signal: AbortSignal.timeout(8000),
  }).then((r) => { if (!r.ok) console.warn(`[yt-import] Discord alert HTTP ${r.status}`) })
    .catch((e) => console.warn(`[yt-import] Discord alert failed: ${e.message}`))
}
// ── What has already been published from an import ──────────────────────────
// user → { "<youtube id>" | "tiktok:<id>": { permlink, at } }, written by the
// uploader after a successful publish, read by the grid for its ✓ mark. A small
// JSON file is plenty at POC scale; written via temp file + rename.
const IMPORTS_FILE = process.env.YT_IMPORT_STORE || path.join(__dirname, 'data', 'yt-imports.json')
const SOURCE_RE = /^(?:[A-Za-z0-9_-]{11}|tiktok:\d{8,25})$/
let importsStore = null
function loadImports() {
  if (importsStore) return importsStore
  try { importsStore = JSON.parse(fs.readFileSync(IMPORTS_FILE, 'utf8')) || {} } catch { importsStore = {} }
  return importsStore
}
function recordImport(user, source, permlink) {
  const store = loadImports()
  store[user] = { ...(store[user] || {}), [source]: { permlink, at: new Date().toISOString() } }
  fs.mkdirSync(path.dirname(IMPORTS_FILE), { recursive: true })
  const tmp = `${IMPORTS_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1))
  fs.renameSync(tmp, IMPORTS_FILE)
}
function importedFor(user) {
  const mine = loadImports()[user] || {}
  return Object.fromEntries(Object.entries(mine).map(([src, v]) => [src, v.permlink]))
}

const ALERT_RED = 0xe53935
const ALERT_ORANGE = 0xff9800

function videoUrlOf(job) {
  return job.sourceUrl || (job.platform === 'youtube' || !job.platform ? `https://www.youtube.com/watch?v=${job.videoId}` : '')
}

function alertJobFailed(job, code, message) {
  const viaSession = job.platform === 'tiktok' && !!tiktokSession()
  alertDiscord({
    title: viaSession ? 'TikTok import failed (the TikTok session may have expired)' : `Import failed (${job.platform || 'youtube'})`,
    color: ALERT_RED,
    user: job.user,
    platform: job.platform || 'youtube',
    videoId: job.videoId,
    url: videoUrlOf(job),
    code,
    message,
    fields: [
      { name: 'Attempts', value: String(job.attempt || 0) },
      { name: 'Route', value: viaSession ? 'TikTok session (yt-dlp)' : (YTDLP_PROXY ? 'yt-dlp via proxy' : 'yt-dlp direct') },
      { name: 'Max quality', value: `${job.maxHeight}p` },
      { name: 'Job', value: job.id, inline: false },
    ],
  })
}
const JOB_TIMEOUT_MS = 60 * 60 * 1000

// YouTube keeps per-type upload playlists next to the plain uploads one (UU…):
// UULF = long-form videos, UUSH = Shorts, UULV = past livestreams. Undocumented
// but served by the Data API, and exact, unlike guessing Shorts from duration.
const TYPE_PLAYLIST_PREFIX = { all: 'UU', videos: 'UULF', shorts: 'UUSH', live: 'UULV' }

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/

/** jobId → { id, user, videoId, status, progress, error, errorCode, file, size, createdAt, proc, log } */
const jobs = new Map()
/** user → [timestamps] for the per-day cap */
const userStarts = new Map()

function ytApi(endpoint, params, { quiet404 = false } = {}) {
  const qs = new URLSearchParams({ ...params, key: YT_API_KEY })
  return fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`, { signal: AbortSignal.timeout(10000) })
    .then(async (r) => {
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = body?.error?.message || `HTTP ${r.status}`
        if (!(quiet404 && r.status === 404)) console.warn(`[yt-import] Data API ${endpoint} failed: ${msg}`)
        throw Object.assign(new Error('YouTube lookup failed'), { status: 502, upstreamStatus: r.status })
      }
      return body
    })
}

// 3Speak Premium, from the checker (embed-users, kept in sync with the VSC
// subscriptions contract, expired subs demoted). Cached 60s like the checker's own
// Cache-Control. Any failure counts as not premium: the base cap is the safe side.
const premiumCache = new Map()
async function isPremium(user) {
  const hit = premiumCache.get(user)
  if (hit && Date.now() - hit.t < 60 * 1000) return hit.premium
  let premium = false
  try {
    const r = await fetch(`${CHECKER_URL}/premium/${encodeURIComponent(user)}`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) premium = (await r.json())?.premium === true
  } catch { /* not premium this time */ }
  premiumCache.set(user, { premium, t: Date.now() })
  return premium
}
const maxHeightFor = async (user) => ((await isPremium(user)) ? MAX_HEIGHT_PREMIUM : MAX_HEIGHT)

// Verified links of a Hive user per platform, from the checker's public read:
// YouTube UC… channel ids, TikTok lower-cased @handles.
async function verifiedLinks(user) {
  const r = await fetch(`${VERIFIER_URL}/verify/links/${encodeURIComponent(user)}`, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw Object.assign(new Error('Could not load your linked accounts'), { status: 502 })
  const data = await r.json()
  const out = { youtube: [], tiktok: [] }
  for (const l of data?.links || []) {
    if (l.verified === false) continue
    const id = String(l.platform_username || '')
    if (l.platform === 'youtube' && CHANNEL_ID_RE.test(id)) out.youtube.push(id)
    if (l.platform === 'tiktok' && TIKTOK_HANDLE_RE.test(id)) out.tiktok.push(id.toLowerCase())
  }
  return out
}
const verifiedChannels = async (user) => (await verifiedLinks(user)).youtube

// ── TikTok ───────────────────────────────────────────────────────────────────
// TikTok has no way to list someone's videos without an approved app, so the
// creator pastes a link. Ownership comes from TikTok's official oEmbed endpoint
// (public, no key): its author_unique_id must be one of the creator's verified
// handles. The handle in the pasted URL is NOT trusted, only oEmbed's answer.
const TIKTOK_HANDLE_RE = /^[a-z0-9_.]{2,24}$/i
const TIKTOK_VIDEO_RE = /^https:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,24})\/video\/(\d{8,25})(?:[/?#]|$)/i
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

// Pasted link → canonical https://www.tiktok.com/@handle/video/<id>. Share links
// (vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…) redirect there; follow at
// most 3 hops, reading headers only.
async function canonicalTikTokUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  for (let hop = 0; hop < 4; hop++) {
    let u
    try { u = new URL(url) } catch { return null }
    if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return null
    u.protocol = 'https:'
    const m = TIKTOK_VIDEO_RE.exec(`https://${u.hostname}${u.pathname}`)
    if (m) return { url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, id: m[2] }
    if (hop === 3) return null
    const r = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) })
    const loc = r.headers.get('location')
    if (!loc) return null
    url = new URL(loc, u).href
  }
  return null
}

async function tiktokOembed(url) {
  const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) })
  if (r.status === 400 || r.status === 404) return null
  if (!r.ok) throw Object.assign(new Error('TikTok lookup failed'), { status: 502 })
  return r.json()
}

// Hashtags stay in the description (they become Hive tags client side); the
// title is the caption without them, cut at a sentence-ish boundary.
function titleFromCaption(caption) {
  const plain = String(caption || '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim()
  if (!plain) return 'TikTok video'
  return plain.length <= 100 ? plain : `${plain.slice(0, 97).replace(/\s+\S*$/, '')}…`
}

// TikTok's official embeds (what a site's <blockquote class="tiktok-embed"> loads)
// carry everything we need in a __FRONTITY_CONNECT_STATE__ JSON blob:
//   /embed/v2/<id>   one video: author, caption, date, size, duration, cover and a
//                    direct MP4 link that downloads from any IP (no proxy needed)
//   /embed/@handle   a creator's 10 newest videos (TikTok serves no more, no paging)
// POC route (owner's decision 2026-10-04); production should use TikTok's official APIs.
const EMBED_HEADERS = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' }
function frontityState(html) {
  const m = String(html).match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

async function tiktokEmbedVideo(id) {
  const r = await fetch(`https://www.tiktok.com/embed/v2/${id}`, { headers: EMBED_HEADERS, signal: AbortSignal.timeout(12000) })
  if (!r.ok) return null
  const vd = frontityState(await r.text())?.source?.data?.[`/embed/v2/${id}`]?.videoData
  const it = vd?.itemInfos
  if (!it?.id) return null
  const meta = it.video?.videoMeta || {}
  return {
    id: String(it.id),
    author: String(vd.authorInfos?.uniqueId || '').toLowerCase(),
    authorName: vd.authorInfos?.nickName || '',
    caption: String(it.text || ''),
    createTime: Number(it.createTime) || 0,
    cover: it.covers?.[0] || '',
    videoUrl: it.video?.urls?.[0] || '',
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    duration: Number(meta.duration) || 0,
  }
}

async function tiktokCreatorVideoIds(handle) {
  const r = await fetch(`https://www.tiktok.com/embed/@${encodeURIComponent(handle)}`, { headers: EMBED_HEADERS, signal: AbortSignal.timeout(12000) })
  if (!r.ok) return []
  const list = frontityState(await r.text())?.source?.data?.[`/embed/@${handle}`]?.videoList || []
  return list
    .filter((v) => v && !v.privateItem && String(v.authorUniqueId || '').toLowerCase() === handle && /^\d{8,25}$/.test(String(v.id)))
    .map((v) => String(v.id))
}

// A looked-up TikTok becomes a token the job route accepts. Ownership is decided
// from TikTok's own embed data, never from the pasted URL.
function tiktokEntry(user, ev) {
  const token = crypto.randomBytes(12).toString('hex')
  const sourceUrl = `https://www.tiktok.com/@${ev.author}/video/${ev.id}`
  const video = {
    id: `tiktok:${ev.id}`,
    platform: 'tiktok',
    token,
    sourceUrl,
    channelTitle: ev.authorName || ev.author,
    title: titleFromCaption(ev.caption),
    description: ev.caption,
    tags: [],
    publishedAt: ev.createTime ? new Date(ev.createTime * 1000).toISOString() : null,
    thumbnail: ev.cover ? `/api/yt-import/thumb-token/${token}` : '',
    duration: ev.duration,
    tooLong: ev.duration > MAX_DURATION_S,
    privacy: 'public',
    type: ev.height > ev.width ? 'shorts' : 'videos',
  }
  resolved.set(token, { user, platform: 'tiktok', tiktokId: ev.id, videoKey: `tt-${ev.id}`, sourceUrl, thumbUrl: ev.cover, video, createdAt: Date.now() })
  return video
}

// Small concurrency pool for the per-video embed lookups.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null) }
  }))
  return out
}

/** token → { user, platform, videoKey, sourceUrl, thumbUrl, video, createdAt }: links a user looked up and owns */
const resolved = new Map()

// ISO-8601 duration (PT1H2M3S) → seconds
function isoDuration(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '')
  if (!m) return 0
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)
}

function bestThumb(thumbs = {}) {
  const t = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default
  return t?.url || ''
}

function shapeVideo(v) {
  const sn = v.snippet || {}
  return {
    id: v.id,
    channelId: sn.channelId,
    channelTitle: sn.channelTitle,
    title: sn.title || '',
    description: sn.description || '',
    tags: sn.tags || [],
    publishedAt: sn.publishedAt,
    thumbnail: bestThumb(sn.thumbnails),
    duration: isoDuration(v.contentDetails?.duration),
    privacy: v.status?.privacyStatus,
    live: sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none' ? sn.liveBroadcastContent : null,
    madeForKids: v.status?.madeForKids === true,
    tooLong: isoDuration(v.contentDetails?.duration) > MAX_DURATION_S,
    vertical: false,
  }
}

async function videoDetails(ids) {
  if (!ids.length) return []
  const data = await ytApi('videos', { part: 'snippet,contentDetails,status', id: ids.join(','), maxResults: '50' })
  return (data.items || []).map(shapeVideo)
}

function errorCodeFromLog(log) {
  if (/Sign in to confirm you.re not a bot|LOGIN_REQUIRED/i.test(log)) return 'bot_check'
  if (/Video unavailable|Private video|members-only|This live event/i.test(log)) return 'unavailable'
  if (/HTTP Error 429|Too Many Requests/i.test(log)) return 'rate_limited'
  if (/HTTP Error 403|Forbidden/i.test(log)) return 'forbidden'
  if (/Unable to connect to proxy|ProxyError|Tunnel connection failed|407 Proxy/i.test(log)) return 'proxy_failed'
  if (/File is larger than max-filesize/i.test(log)) return 'too_large'
  if (/does not pass filter/i.test(log)) return 'too_long'
  return 'download_failed'
}

function runningCount() {
  let n = 0
  for (const j of jobs.values()) if (j.status === 'downloading' || j.status === 'queued') n++
  return n
}

function publicJob(j) {
  return {
    id: j.id, videoId: j.videoId, status: j.status, progress: j.progress,
    error: j.error || null, errorCode: j.errorCode || null, size: j.size || 0,
    attempt: j.attempt || 0, media: j.media || null,
  }
}

// Failures worth another attempt from a fresh exit IP. A private/removed video or an
// over-size file fails the same way from anywhere, so those stop right away.
const RETRYABLE = new Set(['bot_check', 'rate_limited', 'forbidden', 'proxy_failed', 'download_failed'])

function startDownload(job) {
  job.status = 'downloading'
  job.attempt = 0
  // With a logged-in TikTok session, yt-dlp + that session is the path that works;
  // without one, try the embed's own MP4 link first and yt-dlp after that.
  if (job.platform === 'tiktok' && job.tiktokId && !tiktokSession()) {
    directTikTokDownload(job).catch((e) => {
      if (job.status === 'cancelled') return
      console.warn(`[yt-import] @${job.user} ${job.videoId} embed download failed (${e.message}), falling back to yt-dlp`)
      runAttempt(job)
    })
    return
  }
  runAttempt(job)
}

async function directTikTokDownload(job) {
  const dir = path.join(WORK_DIR, job.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  job.progress = 0
  // Fetched fresh: the MP4 links are signed and expire.
  const ev = await tiktokEmbedVideo(job.tiktokId)
  if (!ev?.videoUrl) throw new Error('no video link in the embed')
  if (ev.duration > MAX_DURATION_S) {
    job.status = 'failed'; job.errorCode = 'too_long'; job.error = LIMIT_MESSAGE
    return
  }
  job.abort = new AbortController()
  const r = await fetch(ev.videoUrl, { headers: { ...EMBED_HEADERS, Referer: 'https://www.tiktok.com/' }, signal: job.abort.signal })
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
  const total = Number(r.headers.get('content-length')) || 0
  if (total > 6 * 1024 ** 3) throw new Error('file too large')
  const file = path.join(dir, `${job.videoId}.mp4`)
  let got = 0
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length
      if (total) job.progress = Math.min(99, (got / total) * 100)
      cb(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(r.body), meter, fs.createWriteStream(file))
  if (job.status === 'cancelled') return
  job.file = file
  job.size = fs.statSync(file).size
  job.attempt = 1
  job.media = await probeMedia(file)
  job.status = 'done'
  job.progress = 100
  const m = job.media
  console.log(`[yt-import] @${job.user} ${job.videoId} done via embed (${(job.size / 1e6).toFixed(1)} MB${m ? `, ${m.width}x${m.height}, ${Math.round(m.duration)}s` : ''})`)
}

function runAttempt(job) {
  const dir = path.join(WORK_DIR, job.id)
  // A failed attempt can leave .part fragments; start every attempt clean.
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  job.attempt++
  job.log = ''
  job.progress = 0
  job._lastPct = null
  job._part = 0

  const out = path.join(dir, `${job.videoId}.%(ext)s`)
  // YouTube: H.264/AAC first so the browser can read the duration and grab
  // frames, capped by height. TikTok is portrait, where "480p" means the short
  // side, so it sorts by yt-dlp's `res` (= the smaller dimension) instead.
  const formatArgs = job.platform === 'tiktok'
    ? ['-S', `res:${job.maxHeight},vcodec:h264,acodec:aac`, '-f', 'bv*+ba/b']
    : ['-f', [
      `bv*[height<=${job.maxHeight}][vcodec^=avc1]+ba[ext=m4a]`,
      `bv*[height<=${job.maxHeight}][ext=mp4]+ba[ext=m4a]`,
      `bv*[height<=${job.maxHeight}]+ba`,
      `b[height<=${job.maxHeight}]`,
      // Last resort: the smallest stream there is, never a bigger one than allowed.
      'wv*+wa/w',
    ].join('/')]
  const args = [
    '--no-playlist', '--newline', '--no-colors', '--no-cache-dir',
    ...formatArgs,
    // Second guard on length, in case the Data API reported no duration.
    '--match-filter', `duration <=? ${MAX_DURATION_S}`,
    '--merge-output-format', 'mp4',
    '--max-filesize', '6G',
    '-o', out,
  ]
  if (fs.existsSync(DENO_BIN)) args.push('--js-runtimes', `deno:${DENO_BIN}`)
  const session = job.platform === 'tiktok' ? tiktokSession() : null
  if (session) {
    // yt-dlp writes refreshed cookies back into its cookie file, so each job gets
    // its own copy (in the job dir, never served: only video files are). No proxy:
    // the session works from this server, and a hopping IP would only look odd.
    const jobCookies = path.join(dir, 'session-cookies.txt')
    fs.copyFileSync(session.cookies, jobCookies)
    fs.chmodSync(jobCookies, 0o600)
    args.push('--cookies', jobCookies, '--user-agent', session.ua)
  } else {
    const proxy = proxyForAttempt()
    if (proxy) args.push('--proxy', proxy)
    if (YTDLP_COOKIES && fs.existsSync(YTDLP_COOKIES)) args.push('--cookies', YTDLP_COOKIES)
  }
  args.push(...YTDLP_EXTRA_ARGS, job.sourceUrl || `https://www.youtube.com/watch?v=${job.videoId}`)

  const proc = spawn(YTDLP_BIN, args, { cwd: dir, env: { ...process.env, PATH: `${path.dirname(DENO_BIN)}:${process.env.PATH}` } })
  job.proc = proc
  const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* gone */ } }, JOB_TIMEOUT_MS)

  const onData = (buf) => {
    const s = buf.toString()
    job.log = (job.log + s).slice(-8000)
    // Video and audio download one after the other; weigh video as 0-90%.
    for (const m of s.matchAll(/\[download\]\s+([\d.]+)%/g)) {
      const p = parseFloat(m[1])
      if (!Number.isNaN(p)) {
        if (job._lastPct != null && p + 5 < job._lastPct) job._part = (job._part || 0) + 1
        job._lastPct = p
        job.progress = Math.min(99, job._part ? 90 + p / 10 : p * 0.9)
      }
    }
    if (/\[Merger\]/.test(s)) job.progress = 99
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  proc.on('error', (err) => {
    clearTimeout(timer)
    job.status = 'failed'; job.errorCode = 'download_failed'; job.error = `yt-dlp could not start: ${err.message}`
    alertJobFailed(job, 'download_failed', job.error)
    job.proc = null
  })
  proc.on('close', (code) => {
    clearTimeout(timer)
    job.proc = null
    if (job.status === 'cancelled') return
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')) : []
    const finalFile = files.find((f) => !/\.f\d+\./.test(f))
    if (code === 0 && finalFile) {
      job.file = path.join(dir, finalFile)
      job.size = fs.statSync(job.file).size
      // Real length + orientation, so the client can tell a Short from a video
      // where the platform did not say (TikTok).
      probeMedia(job.file).then((media) => {
        if (job.status === 'cancelled') return
        job.media = media
        job.status = 'done'
        job.progress = 100
        console.log(`[yt-import] @${job.user} ${job.videoId} done on attempt ${job.attempt} (${(job.size / 1e6).toFixed(1)} MB${media ? `, ${media.width}x${media.height}, ${Math.round(media.duration)}s` : ''})`)
      })
      return
    }
    const errorCode = errorCodeFromLog(job.log)
    const lastErr = scrubSecrets((job.log.match(/ERROR:[^\n]*/g) || []).pop() || `yt-dlp exited with ${code}`)
      .replace(/ See {2}https?:\/\/\S+.*$/, '').slice(0, 400)
    if (PROXY_ROTATES && RETRYABLE.has(errorCode) && job.attempt < YTDLP_MAX_ATTEMPTS) {
      console.warn(`[yt-import] @${job.user} ${job.videoId} attempt ${job.attempt} failed (${errorCode}), retrying from a new IP`)
      runAttempt(job)
      return
    }
    job.status = 'failed'
    job.errorCode = errorCode
    // yt-dlp skips a filtered video with exit 0 and no ERROR line.
    job.error = errorCode === 'too_long' ? LIMIT_MESSAGE : lastErr
    console.warn(`[yt-import] @${job.user} ${job.videoId} failed after ${job.attempt} attempt(s) (${errorCode}): ${lastErr}`)
    alertJobFailed(job, errorCode, job.error)
  })
}

function probeMedia(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { timeout: 20000 })
    let out = ''
    p.stdout.on('data', (b) => { out += b })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      try {
        const d = JSON.parse(out)
        const st = d.streams?.[0] || {}
        resolve({ width: Number(st.width) || 0, height: Number(st.height) || 0, duration: Number(d.format?.duration) || 0 })
      } catch { resolve(null) }
    })
  })
}

// ── yt-dlp self-update ───────────────────────────────────────────────────────
// YouTube changes its player every few weeks and yt-dlp is broken until the next
// release, so a stale copy is the most common cause of failures. Update once a day
// (nightly channel, which follows YouTube fastest), only while nothing downloads.
// The bgutil PO-token plugin stays pinned: it must match the provider container.
let ytdlpUpdating = false
const UPDATE_STAMP = path.join(TOOLS, '.ytdlp-last-update')
let ytdlpLastUpdate = (() => { try { return fs.statSync(UPDATE_STAMP).mtimeMs } catch { return 0 } })()
function maybeUpdateYtdlp() {
  if (!YTDLP_AUTO_UPDATE || ytdlpUpdating || !fs.existsSync(PIP_BIN)) return
  if (Date.now() - ytdlpLastUpdate < 24 * 3600 * 1000 || runningCount() > 0) return
  ytdlpUpdating = true
  const p = spawn(PIP_BIN, ['install', '-q', '-U', '--pre', 'yt-dlp[default]'], { timeout: 5 * 60 * 1000 })
  let err = ''
  p.stderr.on('data', (b) => { err = (err + b).slice(-2000) })
  const done = (ok) => {
    ytdlpUpdating = false
    ytdlpLastUpdate = Date.now()
    try { fs.writeFileSync(UPDATE_STAMP, new Date().toISOString() + '\n') } catch { /* next start just updates again */ }
    const v = spawn(YTDLP_BIN, ['--version'])
    let out = ''
    v.stdout.on('data', (b) => { out += b })
    v.on('close', () => console.log(`[yt-import] yt-dlp update ${ok ? 'ok' : 'FAILED'}, now ${out.trim() || '?'}${ok ? '' : `: ${err.trim().split('\n').pop()}`}`))
    v.on('error', () => {})
  }
  p.on('close', (code) => done(code === 0))
  p.on('error', () => done(false))
}

function removeJob(job) {
  try { job.proc?.kill('SIGKILL') } catch { /* gone */ }
  try { job.abort?.abort() } catch { /* gone */ }
  try { fs.rmSync(path.join(WORK_DIR, job.id), { recursive: true, force: true }) } catch { /* ignore */ }
  jobs.delete(job.id)
}

function sweep() {
  const now = Date.now()
  for (const j of jobs.values()) if (now - j.createdAt > FILE_TTL_MS) removeJob(j)
  for (const [k, r] of resolved) if (now - r.createdAt > 3600 * 1000) resolved.delete(k)
}

/**
 * Mount the routes. `resolveUser(req, res)` must return a PROVEN Hive username
 * (butrauth session, wallet session cookie, or HiveSigner bearer) or null.
 */
function mountYoutubeImport(app, { resolveUser, limiter }) {
  // Leftovers from a previous process are unreachable (jobs live in memory).
  try {
    fs.mkdirSync(WORK_DIR, { recursive: true })
    for (const d of fs.readdirSync(WORK_DIR)) fs.rmSync(path.join(WORK_DIR, d), { recursive: true, force: true })
  } catch (e) { console.warn('[yt-import] work dir:', e.message) }
  setInterval(sweep, 10 * 60 * 1000).unref()
  setTimeout(maybeUpdateYtdlp, 60 * 1000).unref()
  setInterval(maybeUpdateYtdlp, 30 * 60 * 1000).unref()

  const mw = limiter ? [limiter] : []

  async function auth(req, res) {
    const user = await resolveUser(req, res)
    if (!user) { res.status(401).json({ error: 'Sign in to import your videos' }); return null }
    return user.toLowerCase()
  }

  const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' })

  // Which verified channels this user has, plus whether the server can download.
  app.get('/api/yt-import/status', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    try {
      const [links, premium] = await Promise.all([verifiedLinks(user), isPremium(user)])
      res.json({
        user, channels: links.youtube, links, premium,
        apiConfigured: !!YT_API_KEY,
        downloader: fs.existsSync(YTDLP_BIN),
        proxyConfigured: !!YTDLP_PROXY || !!YTDLP_COOKIES,
        limits: {
          maxHeight: premium ? MAX_HEIGHT_PREMIUM : MAX_HEIGHT,
          maxDurationS: MAX_DURATION_S,
          baseHeight: MAX_HEIGHT,
          premiumHeight: MAX_HEIGHT_PREMIUM,
        },
        // source id → 3Speak permlink, for the ✓ "On 3Speak" mark
        imported: importedFor(user),
      })
    } catch (e) { fail(res, e) }
  })

  // The uploader reports a published import: this source is now this post.
  app.post('/api/yt-import/published', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    const source = String(req.body?.source || '')
    const permlink = String(req.body?.permlink || '')
    if (!SOURCE_RE.test(source) || !/^[a-z0-9-]{1,255}$/.test(permlink)) return res.status(400).json({ error: 'invalid source or permlink' })
    try {
      recordImport(user, source, permlink)
      console.log(`[yt-import] @${user} published ${source} as ${permlink}`)
      res.json({ ok: true })
    } catch (e) {
      console.warn(`[yt-import] could not record ${source} for @${user}: ${e.message}`)
      res.status(500).json({ error: 'Could not record the import' })
    }
  })

  // Public uploads of the user's verified channel(s), newest first, 25 per page.
  app.get('/api/yt-import/videos', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    if (!YT_API_KEY) return res.status(503).json({ error: 'YouTube API key is not configured on this server' })
    try {
      const channels = await verifiedChannels(user)
      const channelId = String(req.query.channel || channels[0] || '')
      if (!channels.includes(channelId)) return res.status(403).json({ error: 'Link and verify your YouTube channel on your profile first' })
      const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken.slice(0, 200) : ''
      const type = Object.hasOwn(TYPE_PLAYLIST_PREFIX, req.query.type) ? req.query.type : 'all'
      const playlistId = TYPE_PLAYLIST_PREFIX[type] + channelId.slice(2)
      let list
      try {
        list = await ytApi('playlistItems', {
          part: 'contentDetails', playlistId, maxResults: '25', ...(pageToken ? { pageToken } : {}),
        }, { quiet404: type !== 'all' })
      } catch (e) {
        // A channel with no Shorts (or no livestreams) has no such playlist at all.
        if (e.upstreamStatus === 404 && type !== 'all') {
          return res.json({ channelId, channels, type, videos: [], nextPageToken: null, total: 0 })
        }
        throw e
      }
      const ids = (list.items || []).map((i) => i.contentDetails?.videoId).filter((id) => VIDEO_ID_RE.test(id || ''))
      const videos = (await videoDetails(ids))
        .filter((v) => v.privacy === 'public' && v.live !== 'live' && v.live !== 'upcoming')
        .map((v) => ({ ...v, type: type === 'all' ? null : type }))
      // videos.list does not keep the playlist order
      videos.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      res.json({ channelId, channels, type, videos, nextPageToken: list.nextPageToken || null, total: list.pageInfo?.totalResults ?? null })
    } catch (e) { fail(res, e) }
  })

  // Thumbnail proxy so the browser can turn it into a data URL (canvas/CORS-safe).
  app.get('/api/yt-import/thumb/:videoId', ...mw, async (req, res) => {
    const id = String(req.params.videoId || '')
    if (!VIDEO_ID_RE.test(id)) return res.status(400).end()
    for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
      try {
        const r = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`, { signal: AbortSignal.timeout(8000) })
        if (!r.ok) continue
        const buf = Buffer.from(await r.arrayBuffer())
        res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg')
        res.set('Cache-Control', 'public, max-age=3600')
        return res.send(buf)
      } catch { /* try next size */ }
    }
    res.status(404).end()
  })

  // A pasted TikTok link → the video, if it belongs to one of the user's verified
  // handles. Returns a token the job route accepts instead of a YouTube id.
  app.post('/api/yt-import/resolve', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    const raw = String(req.body?.url || '').slice(0, 500)
    if (/instagram\.com/i.test(raw)) return res.status(400).json({ error: 'Instagram is not supported yet', errorCode: 'unsupported' })
    try {
      const links = await verifiedLinks(user)
      if (!links.tiktok.length) return res.status(403).json({ error: 'Link and verify your TikTok account on your profile first', errorCode: 'no_link' })
      const canon = await canonicalTikTokUrl(raw).catch(() => null)
      if (!canon) return res.status(400).json({ error: 'That is not a TikTok video link', errorCode: 'bad_url' })
      let ev = await tiktokEmbedVideo(canon.id).catch(() => null)
      if (!ev) {
        // Embed unavailable: oEmbed still answers who made it; the job then
        // measures the file and downloads through yt-dlp.
        const oe = await tiktokOembed(canon.url)
        if (!oe || String(oe.embed_product_id || canon.id) !== canon.id) {
          return res.status(404).json({ error: 'Video not found or not public', errorCode: 'not_found' })
        }
        ev = {
          id: canon.id, author: String(oe.author_unique_id || '').toLowerCase(), authorName: oe.author_name || '',
          caption: String(oe.title || ''), createTime: 0, cover: oe.thumbnail_url || '', videoUrl: '',
          width: Number(oe.thumbnail_width) || 0, height: Number(oe.thumbnail_height) || 0, duration: 0,
        }
      }
      if (!links.tiktok.includes(ev.author)) {
        console.warn(`[yt-import] @${user} tried to import TikTok ${canon.id} by @${ev.author}`)
        alertDiscord({
          title: 'Blocked: import of someone else\'s TikTok', color: ALERT_ORANGE, user, platform: 'tiktok',
          videoId: canon.id, url: canon.url, code: 'not_owner',
          fields: [{ name: 'Video by', value: `@${ev.author}` }, { name: 'Verified TikTok', value: links.tiktok.map((h) => `@${h}`).join(', ') }],
        })
        return res.status(403).json({ error: 'You can only import videos from your own verified TikTok account', errorCode: 'not_owner' })
      }
      res.json({ video: tiktokEntry(user, ev) })
    } catch (e) { fail(res, e) }
  })

  // The newest TikToks of the user's verified handle(s), from the official creator
  // embed (TikTok serves 10 per creator, no paging); older ones go through /resolve.
  app.get('/api/yt-import/tiktok/videos', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    try {
      const links = await verifiedLinks(user)
      if (!links.tiktok.length) return res.status(403).json({ error: 'Link and verify your TikTok account on your profile first', errorCode: 'no_link' })
      const ids = (await Promise.all(links.tiktok.map((h) => tiktokCreatorVideoIds(h).catch(() => [])))).flat()
      const evs = await mapLimit(ids, 5, (id) => tiktokEmbedVideo(id))
      const videos = evs
        .filter((ev) => ev && links.tiktok.includes(ev.author))
        .map((ev) => tiktokEntry(user, ev))
        .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
      res.json({ handles: links.tiktok, videos })
    } catch (e) { fail(res, e) }
  })

  // Thumbnail of a looked-up TikTok (signed CDN URL kept server side).
  app.get('/api/yt-import/thumb-token/:token', ...mw, async (req, res) => {
    const entry = resolved.get(String(req.params.token || ''))
    if (!entry?.thumbUrl || !/^https:\/\/[^/]*(tiktokcdn|tiktokcdn-eu|tiktokcdn-us|ibyteimg|byteimg)\.com\//i.test(entry.thumbUrl)) return res.status(404).end()
    try {
      const r = await fetch(entry.thumbUrl, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) return res.status(404).end()
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg')
      res.set('Cache-Control', 'private, max-age=3600')
      res.send(Buffer.from(await r.arrayBuffer()))
    } catch { res.status(404).end() }
  })

  // Start a server-side download of one of the user's own public videos.
  app.post('/api/yt-import/jobs', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    const token = String(req.body?.token || '')
    const entry = token ? resolved.get(token) : null
    if (token && (!entry || entry.user !== user)) return res.status(404).json({ error: 'Look the video up again', errorCode: 'expired' })
    const videoId = entry ? entry.videoKey : String(req.body?.videoId || '')
    if (!entry && !VIDEO_ID_RE.test(videoId)) return res.status(400).json({ error: 'invalid video id' })
    if (!fs.existsSync(YTDLP_BIN)) return res.status(503).json({ error: 'Downloader is not installed on this server', errorCode: 'no_downloader' })
    if (ytdlpUpdating) return res.status(503).json({ error: 'The importer is updating itself, try again in a minute', errorCode: 'busy' })
    try {
      let video
      if (entry) {
        // Ownership was checked when the link was looked up (oEmbed author).
        video = entry.video
      } else {
        const [channels, [ytVideo]] = await Promise.all([verifiedChannels(user), videoDetails([videoId])])
        video = ytVideo
        if (!video) return res.status(404).json({ error: 'Video not found' })
        if (!channels.includes(video.channelId)) {
          console.warn(`[yt-import] @${user} tried to import ${videoId} from channel ${video.channelId}`)
          alertDiscord({
            title: 'Blocked: import of someone else\'s YouTube video', color: ALERT_ORANGE, user, platform: 'youtube',
            videoId, url: `https://www.youtube.com/watch?v=${videoId}`, code: 'not_owner',
            fields: [{ name: 'Video channel', value: video.channelId }, { name: 'Verified channels', value: channels.join(', ') || 'none' }],
          })
          return res.status(403).json({ error: 'You can only import videos from your own verified channel' })
        }
        if (video.privacy !== 'public') return res.status(400).json({ error: 'Only public videos can be imported' })
        if (video.duration > MAX_DURATION_S) {
          return res.status(400).json({ error: LIMIT_MESSAGE, errorCode: 'too_long' })
        }
      }

      // One running job per user; reuse it when it is the same video.
      for (const j of jobs.values()) {
        if (j.user !== user) continue
        if (j.videoId === videoId && j.status !== 'failed' && j.status !== 'cancelled') return res.json(publicJob(j))
        if (j.status === 'downloading' || j.status === 'queued') {
          return res.status(409).json({ error: 'You already have an import running. Wait for it to finish first.' })
        }
      }
      const now = Date.now()
      const starts = (userStarts.get(user) || []).filter((t) => now - t < 24 * 3600 * 1000)
      if (starts.length >= MAX_JOBS_PER_DAY) {
        alertDiscord({
          title: 'Blocked: daily import limit reached', color: ALERT_ORANGE, user, platform: entry ? entry.platform : 'youtube',
          videoId, code: 'daily_limit', fields: [{ name: 'Limit', value: `${MAX_JOBS_PER_DAY} imports / 24h` }],
        })
        return res.status(429).json({ error: 'Daily import limit reached, try again tomorrow' })
      }
      if (runningCount() >= MAX_CONCURRENT) return res.status(503).json({ error: 'The importer is busy, try again in a few minutes', errorCode: 'busy' })
      starts.push(now); userStarts.set(user, starts)

      const maxHeight = await maxHeightFor(user)
      const job = {
        id: crypto.randomBytes(12).toString('hex'), user, videoId, maxHeight,
        platform: entry ? entry.platform : 'youtube', sourceUrl: entry ? entry.sourceUrl : null,
        tiktokId: entry?.tiktokId || null,
        status: 'queued', progress: 0, createdAt: now, log: '',
      }
      jobs.set(job.id, job)
      console.log(`[yt-import] @${user} started ${videoId} (${video.duration}s, up to ${maxHeight}p)`)
      startDownload(job)
      res.json(publicJob(job))
    } catch (e) { fail(res, e) }
  })

  const ownJob = async (req, res) => {
    const user = await auth(req, res); if (!user) return null
    const job = jobs.get(String(req.params.id || ''))
    if (!job || job.user !== user) { res.status(404).json({ error: 'Import not found' }); return null }
    return job
  }

  app.get('/api/yt-import/jobs/:id', async (req, res) => {
    const job = await ownJob(req, res); if (!job) return
    res.json(publicJob(job))
  })

  app.get('/api/yt-import/jobs/:id/file', async (req, res) => {
    const job = await ownJob(req, res); if (!job) return
    if (job.status !== 'done' || !job.file) return res.status(409).json({ error: 'Not ready' })
    res.set('Cache-Control', 'no-store')
    res.sendFile(job.file, { headers: { 'Content-Type': 'video/mp4' } })
  })

  app.delete('/api/yt-import/jobs/:id', async (req, res) => {
    const job = await ownJob(req, res); if (!job) return
    job.status = 'cancelled'
    removeJob(job)
    res.json({ ok: true })
  })
}

module.exports = { mountYoutubeImport }
