// ── ▶️ Batch import (up to 5 videos, fully server side) ───────────────────────
// A creator ticks up to BATCH_MAX of their own videos on /youtube-import and fills
// in one form (community, rewards, extra beneficiaries, NSFW, ads). Title,
// description, tags and thumbnail come from each source. The server then, one
// video at a time across ALL users (spaced out, so imports never download in a
// burst):
//   download (the importer's own job machinery: same limits, proxy, retries)
//   → thumbnail (source cover, or a frame from the file) to images.hive.blog
//   → upload to the embed service (TUS, encode starts right away)
//   → build the post exactly like the studio does
//   → hand it to the checker's scheduled-posts service, which broadcasts it as
//     @threespeak at its slot and links the video (same path as "schedule post").
// Posts go out POST_SPACING_MS apart (owner's call 2026-10-05: 30 min), the first
// a few minutes after it is ready. Publishing as @threespeak needs the creator's
// posting-authority grant, checked when the batch is created and again by the
// checker. Batches live in Mongo (`import-batches` in the threespeak database,
// next to the checker's `scheduled-posts`), one document per batch, written on
// every change and never deleted, so a broken service leaves the full trail for
// fixing (owner's call 2026-10-05). Each document carries `env` (preview / prod):
// a runner only ever touches its own. No Mongo configured = a JSON file instead.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const tus = require('tus-js-client')

const BATCH_MAX = 5
const POST_SPACING_MS = Number(process.env.IMPORT_BATCH_SPACING_MIN || 30) * 60 * 1000
const FIRST_POST_LEAD_MS = 7 * 60 * 1000 // the checker wants at least 5 min of lead
const ITEM_GAP_MS = [30 * 1000, 90 * 1000] // pause between two items, random in this range
// Just in time (owner's call 2026-10-05): a user's next video is only fetched once
// their previous post is less than this far from its slot, so with 30-minute
// spacing their downloads run ~30 minutes apart instead of back to back. Leaves
// room for download + upload + encode before the slot.
const PREP_AHEAD_MS = Number(process.env.IMPORT_BATCH_PREP_AHEAD_MIN || 20) * 60 * 1000
const SHORTS_MAX_DURATION_SEC = 120
const SHORT_DESCRIPTION_MAX = 240
const EMBED_BASE = (process.env.EMBED_API_BASE || 'https://embed2.3speak.tv').replace(/\/+$/, '')
const EMBED_API_KEY = process.env.EMBED_API_KEY || ''
const CHECKER_BASE = (process.env.CHECKER_URL || process.env.SOCIAL_VERIFIER_URL || 'https://checker.3speak.tv').replace(/\/+$/, '')
const CHECKER_API_KEY = process.env.CHECKER_API_KEY || ''
const STORE_FILE = process.env.IMPORT_BATCH_STORE || path.join(__dirname, 'data', 'import-batches.json')
const MONGO_URI = process.env.IMPORT_BATCH_MONGODB_URI || process.env.MONGODB_URI || ''
const MONGO_DB = process.env.IMPORT_BATCH_DATABASE_NAME || process.env.DATABASE_NAME || '' // '' = the URI's own database
const MONGO_COLLECTION = 'import-batches'
const ENV = process.env.IMPORT_BATCH_ENV || 'preview'
const HIVE_NODES = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://hive-api.arcange.eu']
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

// Locked beneficiaries, same rules as src/utils/beneficiaries.js (keep in step):
// non-Pro 10% threespeakfund; 1% encoder.pay for non-Pro and the grandfathered
// Pro payers below.
const LOCKED_FUND = { account: 'threespeakfund', weight: 1000 }
const LOCKED_ENCODER = { account: 'encoder.pay', weight: 100 }
const ENCODER_PREMIUM_PAYERS = new Set([
  'ankalagonchik', 'coolmole', 'eddieespinod', 'eddiespino', 'eddiespinod',
  'joseamenac', 'meno', 'starkerz', 'xvlad', 'mantequilla-soft',
])

const HIVE_NAME_RE = /^[a-z][a-z0-9-.]{2,15}$/
const COMMUNITY_RE = /^hive-\d{3,8}$/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Store ────────────────────────────────────────────────────────────────────
// Working copy in memory; Mongo (or the file) is the durable record.
const ACTIVE = new Set(['queued', 'downloading', 'uploading', 'scheduling'])
const store = { batches: [] }
let col = null

async function load() {
  let MongoClient = null
  try { ({ MongoClient } = require('mongodb')) } catch { /* no driver: file store */ }
  if (MONGO_URI && MongoClient) {
    const client = new MongoClient(MONGO_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 20000 })
    await client.connect()
    col = client.db(MONGO_DB || undefined).collection(MONGO_COLLECTION)
    await col.createIndex({ env: 1, user: 1, createdAt: -1 }, { name: 'env_user_created' }).catch(() => {})
    // Recent batches plus anything unfinished, however old.
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const docs = await col.find({ env: ENV, $or: [{ createdAt: { $gt: cutoff } }, { 'items.status': { $in: [...ACTIVE, 'scheduled'] } }] })
      .sort({ createdAt: 1 }).toArray()
    store.batches = docs.map(({ _id, env, updatedAt, ...b }) => ({ ...b, id: _id }))
    console.log(`[import-batch] ${store.batches.length} batches loaded from Mongo (${MONGO_COLLECTION}, env ${ENV})`)
    return
  }
  try { store.batches = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')).batches || [] } catch { store.batches = [] }
  console.log(`[import-batch] ${store.batches.length} batches loaded from ${STORE_FILE} (no Mongo configured)`)
}

// Writes per batch are chained so an older snapshot can never land after a newer one.
const writes = new Map()
function save(b) {
  if (!col) {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    const tmp = `${STORE_FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1))
    fs.renameSync(tmp, STORE_FILE)
    return
  }
  const { id, ...rest } = JSON.parse(JSON.stringify(b)) // snapshot now, write later
  const doc = { ...rest, env: ENV, updatedAt: new Date().toISOString() }
  const next = (writes.get(id) || Promise.resolve())
    .then(() => col.replaceOne({ _id: id }, doc, { upsert: true }))
    .catch((e) => console.warn(`[import-batch] Mongo write for ${id} failed (the next change rewrites it): ${e.message}`))
  writes.set(id, next)
  next.finally(() => { if (writes.get(id) === next) writes.delete(id) })
}
const batchesOf = (user) => store.batches.filter((b) => b.user === user)
// The latest publish slot among this user's imports still waiting to go out (0 = none).
const lastSlotOf = (user) => Math.max(0, ...batchesOf(user).flatMap((x) => x.items)
  .filter((x) => x.status === 'scheduled' && x.scheduledOn).map((x) => Date.parse(x.scheduledOn)))
// ── Post building (mirrors EmbedUploadContext's publish step) ────────────────
function slugOf(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 27).replace(/-+$/, '')
}
function permlinkFor(text) {
  // A random suffix, not the studio's Date.now() % 1000: five posts built a minute
  // apart must never collide.
  return `${slugOf(text) || 'import'}-${crypto.randomBytes(3).toString('hex')}`
}
function cleanTag(t) {
  return String(t || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '').slice(0, 24)
}
function tagsFor(source, baseTags, nsfw) {
  const fromCaption = [...String(source.description || '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1])
  const wanted = [...(source.tags || []), ...fromCaption, ...(nsfw ? ['nsfw'] : [])].map(cleanTag).filter((t) => t.length >= 2)
  const out = [...baseTags]
  for (const t of wanted) {
    if (out.length >= 10) break
    if (!out.includes(t)) out.push(t)
  }
  // `nsfw` must survive the 10-tag cap.
  if (nsfw && !out.includes('nsfw')) out[out.length - 1] = 'nsfw'
  return out
}
function orientationOf(w, h) {
  if (!w || !h) return null
  if (w === h) return 'square'
  return w > h ? 'landscape' : 'vertical'
}
function beneficiariesFor(user, premium, extras) {
  const m = new Map()
  for (const b of extras) m.set(b.account, Math.max(m.get(b.account) || 0, b.weight))
  if (!premium) m.set(LOCKED_FUND.account, Math.max(m.get(LOCKED_FUND.account) || 0, LOCKED_FUND.weight))
  else m.delete(LOCKED_FUND.account)
  if (!premium || ENCODER_PREMIUM_PAYERS.has(user)) m.set(LOCKED_ENCODER.account, Math.max(m.get(LOCKED_ENCODER.account) || 0, LOCKED_ENCODER.weight))
  else m.delete(LOCKED_ENCODER.account)
  // Hive wants them in byte order of the account name.
  return [...m.entries()].map(([account, weight]) => ({ account, weight }))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0))
}

function buildPost({ user, source, media, embedUrl, thumbnailUrl, options, isShort, permlink, premium }) {
  const description = isShort
    ? String(source.description || '').slice(0, SHORT_DESCRIPTION_MAX)
    : String(source.description || '')
  const title = isShort ? '' : String(source.title || '').slice(0, 250)
  const watchPath = isShort ? `/shorts?v=${user}/${permlink}` : `/watch?v=${user}/${permlink}`
  const body = `${embedUrl}\n\n${description}\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv${watchPath})`
  const baseTags = isShort ? ['hive-181335'] : [options.community]
  const tags = tagsFor(source, baseTags, options.nsfw)
  let embedOwner = user
  let embedPermlink = ''
  try {
    const [o, p] = (new URL(embedUrl).searchParams.get('v') || '').split('/')
    if (o) embedOwner = o
    if (p) embedPermlink = p
  } catch { /* checked by the caller */ }
  const duration = Math.round(Number(media?.duration) || Number(source.duration) || 0)
  const orientation = orientationOf(media?.width, media?.height)
  const jsonMetadata = {
    app: '3speak/embed',
    format: 'markdown',
    tags,
    ...(thumbnailUrl ? { image: [thumbnailUrl] } : {}),
    links: [embedUrl],
    video: {
      platform: '3speak',
      url: embedUrl,
      reusable: true,
      ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
      info: {
        platform: '3speak',
        author: embedOwner,
        permlink: embedPermlink,
        title,
        duration,
        ...(thumbnailUrl ? { sourceMap: [{ url: thumbnailUrl, type: 'thumbnail' }] } : {}),
      },
    },
    oa: { v: 1, object: isShort ? 'MicroPost' : 'Article' },
    ...(orientation ? {
      'threespeak.video': { surface: isShort ? 'shorts' : 'watch', orientation, ...(duration > 0 ? { duration } : {}) },
    } : {}),
    ...(options.ads ? {} : { '3speak': { ads: false } }),
    imported_from: {
      platform: source.platform,
      id: String(source.sourceId).replace(/^[a-z]+:/, ''),
      url: source.sourceUrl,
    },
  }
  return {
    title,
    description,
    body,
    tags,
    jsonMetadata,
    embedPermlink,
    beneficiaries: options.payout === 'decline' ? [] : beneficiariesFor(user, premium, options.beneficiaries),
  }
}

// ── External steps ───────────────────────────────────────────────────────────
async function fetchBytes(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return { buf: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') || 'image/jpeg').split(';')[0] }
}

function frameFromFile(file, outFile, at = 1) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-q:v', '3', outFile], { timeout: 30000 })
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(outFile) ? outFile : null))
    p.on('error', () => resolve(null))
  })
}

// Thumbnail bytes: the source's own cover for regular videos and for Instagram /
// TikTok (portrait already); a frame from the file for YouTube Shorts (their
// thumbnails are 16:9) or when the cover cannot be fetched.
async function thumbnailBytes(source, file, isShort, workDir) {
  const tryUrls = []
  if (source.platform === 'youtube') {
    if (!isShort) for (const n of ['maxresdefault', 'sddefault', 'hqdefault']) tryUrls.push(`https://i.ytimg.com/vi/${source.sourceId}/${n}.jpg`)
  } else if (source.thumbUrl) {
    tryUrls.push(source.thumbUrl)
  }
  for (const u of tryUrls) {
    try {
      const got = await fetchBytes(u)
      if (got.buf.length > 2000) return got
    } catch { /* next */ }
  }
  const out = await frameFromFile(file, path.join(workDir, 'thumb.jpg'))
  return out ? { buf: fs.readFileSync(out), type: 'image/jpeg' } : null
}

async function mintUploadToken(user, isShort) {
  const r = await fetch(`${EMBED_BASE}/uploads/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': EMBED_API_KEY },
    body: JSON.stringify({ owner: user, frontend_app: '3speak-tv', short: isShort, gated: false, defer_encode: false }),
    signal: AbortSignal.timeout(20000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.token) throw new Error(`upload token: HTTP ${r.status} ${d.error || ''}`.trim())
  return d
}

function tusUpload({ file, token, user, isShort, duration, onProgress }) {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(file).size
    let embedUrl = ''
    const upload = new tus.Upload(fs.createReadStream(file), {
      endpoint: `${EMBED_BASE}/uploads`,
      uploadSize: size,
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000, 60000],
      headers: { Authorization: `Bearer ${token}` },
      metadata: {
        filename: path.basename(file),
        filetype: 'video/mp4',
        frontend_app: '3speak-tv',
        owner: user,
        short: isShort ? 'true' : 'false',
        duration: String(Math.round(duration || 0)),
      },
      onAfterResponse(_req, res) {
        const u = res.getHeader('X-Embed-URL')
        if (u) embedUrl = u
      },
      onProgress(sent, total) { if (total) onProgress(sent / total) },
      onError: reject,
      onSuccess: () => resolve(embedUrl),
    })
    upload.start()
  })
}

// When the embed service deferred the encode anyway, commission it now.
async function commissionEncode(tokenInfo) {
  if (!(tokenInfo.defer_encode === true && tokenInfo.finalize_token && tokenInfo.permlink)) return
  for (const wait of [0, 1000, 2000, 3000, 5000, 8000, 12000]) {
    if (wait) await sleep(wait)
    const r = await fetch(`${EMBED_BASE}/video/${encodeURIComponent(tokenInfo.permlink)}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenInfo.finalize_token}` },
      body: JSON.stringify({ gated: false }),
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) return
    const d = await r.json().catch(() => ({}))
    if (r.status !== 409 || !['not_awaiting_encode', 'not_pinned'].includes(d.code)) throw new Error(`encode: HTTP ${r.status} ${d.error || ''}`.trim())
  }
  throw new Error('encode: the upload never became ready')
}

// The newest @peak.snaps container: the parent every 3Speak Short replies to.
async function snapsContainer() {
  for (const node of HIVE_NODES) {
    try {
      const r = await fetch(node, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.get_account_posts', params: { sort: 'posts', account: 'peak.snaps', limit: 1 } }),
        signal: AbortSignal.timeout(8000),
      })
      const post = (await r.json())?.result?.[0]
      if (post?.author && post?.permlink) return { author: post.author, permlink: post.permlink }
    } catch { /* next node */ }
  }
  throw new Error('could not find the Shorts container (@peak.snaps)')
}

async function scheduleOnChecker(doc) {
  const r = await fetch(`${CHECKER_BASE}/scheduled-posts/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHECKER_API_KEY}` },
    body: JSON.stringify(doc),
    signal: AbortSignal.timeout(20000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`schedule: HTTP ${r.status} ${d.error || ''}`.trim())
  return d
}

async function cancelOnChecker(owner, permlink) {
  const r = await fetch(`${CHECKER_BASE}/scheduled-posts/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHECKER_API_KEY}` },
    body: JSON.stringify({ owner, permlink }),
    signal: AbortSignal.timeout(15000),
  })
  return r.ok
}

// What the checker currently says about the user's scheduled posts, by permlink.
async function checkerStatuses(user) {
  try {
    const r = await fetch(`${CHECKER_BASE}/scheduled-posts/${encodeURIComponent(user)}?limit=100`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return {}
    const d = await r.json()
    return Object.fromEntries((d.scheduled_posts || []).map((p) => [p.permlink, { status: p.status, lastError: p.lastError || null, postedAt: p.postedAt || null }]))
  } catch { return {} }
}

// ── Mount ────────────────────────────────────────────────────────────────────
/**
 * deps (from youtube-import.cjs / index.cjs):
 *   auth(req,res) → user | null, mw (limiter array),
 *   resolveSource(user, item) → source spec (ownership checked) | throws {status,message},
 *   startDownload(user, spec) → job, getJob(id) → job, removeJob(job),
 *   canStartDownload() → bool, startsToday(user) → number, maxPerDay,
 *   isPremium(user), recordImport(user, sourceId, permlink),
 *   uploadImage(buf, type) → url, hasPostingGrant(user) → bool,
 *   alert({title, color, user, platform, videoId, url, code, message, fields})
 */
function mountImportBatch(app, deps) {
  const { auth, mw } = deps
  const ready = load().then(() => {
    // A restart loses the in-memory download jobs: anything mid-way starts over.
    for (const b of store.batches) {
      let touched = false
      for (const it of b.items) {
        if (['downloading', 'uploading', 'scheduling'].includes(it.status)) {
          it.status = 'queued'; it.progress = 0; it.jobId = null; touched = true
        }
      }
      if (touched) save(b)
    }
    return true
  }).catch((e) => {
    console.error(`[import-batch] could not load batches, batch import is OFF until a restart: ${e.message}`)
    return false
  })

  const publicBatch = (b, live = {}) => ({
    id: b.id,
    createdAt: b.createdAt,
    options: { community: b.options.community, payout: b.options.payout, nsfw: b.options.nsfw, ads: b.options.ads },
    items: b.items.map((it) => {
      const c = it.permlink ? live[it.permlink] : null
      const status = it.status === 'scheduled' && c?.status === 'posted' ? 'posted'
        : it.status === 'scheduled' && c?.status === 'failed' ? 'publish_failed'
          : it.status
      return {
        sourceId: it.source.sourceId,
        platform: it.source.platform,
        title: it.source.title,
        thumbnail: it.thumbnailUrl || it.source.thumbnail || '',
        status,
        progress: Math.round(it.progress || 0),
        error: it.error || c?.lastError || null,
        isShort: it.isShort ?? null,
        permlink: it.permlink || null,
        scheduledOn: it.scheduledOn || null,
      }
    }),
  })

  // ── Runner: one item at a time, all users, spaced out ──────────────────────
  let running = false
  async function runner() {
    if (running) return
    running = true
    try {
      for (;;) {
        const waiting = store.batches.flatMap((b) => b.items.map((it) => ({ b, it }))).filter(({ it }) => it.status === 'queued')
        if (!waiting.length) return
        const next = waiting.find(({ b }) => lastSlotOf(b.user) - Date.now() <= PREP_AHEAD_MS)
        if (!next) { await sleep(60 * 1000); continue } // everyone's next post is still far off
        while (!deps.canStartDownload()) await sleep(15000)
        await processItem(next.b, next.it)
        await sleep(ITEM_GAP_MS[0] + crypto.randomInt(ITEM_GAP_MS[1] - ITEM_GAP_MS[0]))
      }
    } finally {
      running = false
    }
  }
  const kick = () => { runner().catch((e) => console.error('[import-batch] runner:', e.message)) }

  const fail = (b, it, code, message) => {
    it.status = 'failed'; it.errorCode = code; it.error = String(message || '').slice(0, 300)
    save(b)
    console.warn(`[import-batch] @${b.user} ${it.source.sourceId} failed (${code}): ${it.error}`)
    deps.alert({
      title: `Batch import failed (${it.source.platform})`, color: 0xe53935, user: b.user, platform: it.source.platform,
      videoId: it.source.sourceId, url: it.source.sourceUrl, code, message: it.error, fields: [{ name: 'Batch', value: b.id }],
    })
  }

  async function processItem(b, it) {
    const { user } = b
    // 1. Download through the importer's own jobs.
    it.status = 'downloading'; it.progress = 0; it.error = null; it.startedAt = new Date().toISOString(); save(b)
    let job
    try {
      job = await deps.startDownload(user, it.source)
    } catch (e) { return fail(b, it, 'download_failed', e.message) }
    it.jobId = job.id
    while (['queued', 'downloading'].includes(job.status)) {
      await sleep(3000)
      it.progress = (job.progress || 0) * 0.5
    }
    if (job.status === 'cancelled' || it.status === 'cancelled') { deps.removeJob(job); return }
    if (job.status !== 'done' || !job.file) {
      const err = job.error || 'download failed'
      deps.removeJob(job)
      return fail(b, it, job.errorCode || 'download_failed', err)
    }
    const media = job.media || {}
    const isShort = media.height > media.width && (media.duration || it.source.duration || 0) > 0
      && (media.duration || it.source.duration) <= SHORTS_MAX_DURATION_SEC
    it.isShort = isShort
    const workDir = path.dirname(job.file)

    try {
      // 2. Thumbnail (non-fatal, like in the studio).
      it.status = 'uploading'; it.progress = 50; save(b)
      let thumbnailUrl = null
      try {
        const t = await thumbnailBytes(it.source, job.file, isShort, workDir)
        if (t) thumbnailUrl = await deps.uploadImage(t.buf, t.type)
      } catch (e) { console.warn(`[import-batch] @${user} ${it.source.sourceId} thumbnail skipped: ${e.message}`) }
      it.thumbnailUrl = thumbnailUrl

      // 3. Upload to the embed service; the encode starts right away.
      const tokenInfo = await mintUploadToken(user, isShort)
      const embedUrl = await tusUpload({
        file: job.file, token: tokenInfo.token, user, isShort, duration: media.duration,
        onProgress: (f) => { it.progress = 50 + f * 45 },
      }) || tokenInfo.embed_url
      if (!embedUrl || !/[?&]v=[^/]+\/[^&]+/.test(embedUrl)) throw new Error('the embed service returned no video link')
      await commissionEncode(tokenInfo)
      deps.removeJob(job)
      if (it.status === 'cancelled') return

      // 4. Build the post and give it a slot.
      it.status = 'scheduling'; it.progress = 96; it.embedUrl = embedUrl; save(b)
      if (!(await deps.hasPostingGrant(user))) throw Object.assign(new Error('@threespeak no longer has posting authority on your account'), { code: 'no_grant' })
      const premium = await deps.isPremium(user).catch(() => false)
      if (deps.enrichSource) it.source = await deps.enrichSource(it.source).catch(() => it.source)
      const permlink = permlinkFor(isShort ? it.source.description : it.source.title)
      const post = buildPost({ user, source: it.source, media, embedUrl, thumbnailUrl, options: b.options, isShort, permlink, premium })
      const parent = isShort ? await snapsContainer() : { author: '', permlink: b.options.community }
      // Spaced against ALL of this user's scheduled imports, not just this batch.
      const lastSlot = lastSlotOf(user)
      const slot = Math.max(Date.now() + FIRST_POST_LEAD_MS, lastSlot ? lastSlot + POST_SPACING_MS : 0)
      await scheduleOnChecker({
        owner: user,
        permlink,
        scheduledOn: new Date(slot).toISOString(),
        title: post.title,
        description: post.description,
        body: post.body,
        tags: post.tags,
        jsonMetadata: post.jsonMetadata,
        beneficiaries: post.beneficiaries,
        payoutOptions: b.options.payout,
        thumbnail: thumbnailUrl,
        parentAuthor: parent.author,
        parentPermlink: parent.permlink,
        embedPermlink: post.embedPermlink,
      })
      it.status = 'scheduled'; it.progress = 100; it.permlink = permlink; it.scheduledOn = new Date(slot).toISOString()
      save(b)
      try { deps.recordImport(user, it.source.sourceId, permlink) } catch { /* the ✓ mark only */ }
      console.log(`[import-batch] @${user} ${it.source.sourceId} → ${permlink} (${isShort ? 'short' : 'video'}) at ${it.scheduledOn}`)
    } catch (e) {
      deps.removeJob(job)
      return fail(b, it, e.code || 'upload_failed', e.message)
    }
  }

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.get('/api/yt-import/batch', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    if (!(await ready)) return res.status(503).json({ error: 'Batch import is unavailable right now' })
    try {
      const mine = batchesOf(user).slice(-5).reverse()
      const live = mine.some((b) => b.items.some((it) => it.status === 'scheduled')) ? await checkerStatuses(user) : {}
      res.json({ max: BATCH_MAX, spacingMin: Math.round(POST_SPACING_MS / 60000), granted: await deps.hasPostingGrant(user), batches: mine.map((b) => publicBatch(b, live)) })
    } catch (e) { res.status(500).json({ error: 'Something went wrong' }); console.warn('[import-batch] list:', e.message) }
  })

  app.post('/api/yt-import/batch', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    if (!(await ready)) return res.status(503).json({ error: 'Batch import is unavailable right now' })
    try {
      if (!EMBED_API_KEY || !CHECKER_API_KEY) return res.status(503).json({ error: 'Batch import is not set up on this server' })
      const items = Array.isArray(req.body?.items) ? req.body.items : []
      if (!items.length || items.length > BATCH_MAX) return res.status(400).json({ error: `Pick 1 to ${BATCH_MAX} videos` })
      if (batchesOf(user).some((b) => b.items.some((it) => ACTIVE.has(it.status)))) {
        return res.status(409).json({ error: 'Your previous batch is still being imported. Wait for it to finish first.', errorCode: 'busy' })
      }
      if (deps.startsToday(user) + items.length > deps.maxPerDay) {
        return res.status(429).json({ error: 'This batch would go over your daily import limit', errorCode: 'daily_limit' })
      }
      if (!(await deps.hasPostingGrant(user))) {
        return res.status(403).json({ error: 'Allow 3Speak to publish for you first', errorCode: 'no_grant' })
      }

      // One-time form.
      const o = req.body?.options || {}
      const community = String(o.community || 'hive-181335')
      if (!COMMUNITY_RE.test(community)) return res.status(400).json({ error: 'Invalid community' })
      const payout = ['default', 'powerup', 'decline'].includes(o.payout) ? o.payout : 'default'
      const extras = []
      for (const b of Array.isArray(o.beneficiaries) ? o.beneficiaries.slice(0, 6) : []) {
        const account = String(b?.account || '').toLowerCase().replace(/^@/, '')
        const weight = Math.round(Number(b?.percent) * 100)
        if (!HIVE_NAME_RE.test(account) || account === user || !(weight >= 1 && weight <= 10000)) {
          return res.status(400).json({ error: `Invalid beneficiary: ${account || '(empty)'}` })
        }
        extras.push({ account, weight })
      }
      const premium = await deps.isPremium(user).catch(() => false)
      const total = beneficiariesFor(user, premium, extras).reduce((s, b) => s + b.weight, 0)
      if (total > 10000) return res.status(400).json({ error: 'Beneficiaries add up to more than 100%' })
      const options = { community, payout, beneficiaries: extras, nsfw: o.nsfw === true, ads: o.ads !== false }

      // Every video is resolved and ownership-checked now, not later.
      const sources = []
      for (const item of items) {
        try {
          const src = await deps.resolveSource(user, item)
          if (sources.some((s) => s.sourceId === src.sourceId)) continue
          sources.push(src)
        } catch (e) {
          return res.status(e.status || 400).json({ error: e.message || 'A video could not be checked', errorCode: e.code || 'bad_item' })
        }
      }

      const batch = {
        id: crypto.randomBytes(8).toString('hex'),
        user,
        createdAt: new Date().toISOString(),
        options,
        items: sources.map((source) => ({ source, status: 'queued', progress: 0 })),
      }
      store.batches.push(batch)
      // Only the working copy is trimmed; Mongo keeps every batch.
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000
      const keep = store.batches.filter((b) => b.items.some((it) => ACTIVE.has(it.status) || it.status === 'scheduled') || Date.parse(b.createdAt) > cutoff)
      store.batches.splice(0, store.batches.length, ...keep)
      save(batch)
      console.log(`[import-batch] @${user} batch ${batch.id}: ${sources.length} videos (${payout}, ${community})`)
      kick()
      res.json(publicBatch(batch))
    } catch (e) {
      console.warn('[import-batch] create:', e.message)
      res.status(500).json({ error: 'Something went wrong' })
    }
  })

  // Stop what has not been published yet: queued/running items, and scheduled
  // posts that the checker has not broadcast.
  app.post('/api/yt-import/batch/:id/cancel', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    if (!(await ready)) return res.status(503).json({ error: 'Batch import is unavailable right now' })
    const b = batchesOf(user).find((x) => x.id === req.params.id)
    if (!b) return res.status(404).json({ error: 'Batch not found' })
    for (const it of b.items) {
      if (ACTIVE.has(it.status)) {
        if (it.jobId) { const j = deps.getJob(it.jobId); if (j) { j.status = 'cancelled'; deps.removeJob(j) } }
        it.status = 'cancelled'
      } else if (it.status === 'scheduled' && it.permlink) {
        if (await cancelOnChecker(user, it.permlink).catch(() => false)) it.status = 'cancelled'
      }
    }
    save(b)
    res.json(publicBatch(b, await checkerStatuses(user)))
  })

  ready.then((ok) => { if (ok) kick() })
}

module.exports = { mountImportBatch, buildPost, beneficiariesFor, tagsFor, permlinkFor }
