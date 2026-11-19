// 🤖 Automations: what each task does (the catalog is automation-catalog.cjs).
//
// A handler gets the step, the event (the post that started the run and its
// values) and `ctx`:
//   ctx.user        the workflow's owner; every post goes out as them, signed by
//                   @threespeak under the posting grant they gave
//   ctx.marker      written into each post's json_metadata, so a post an
//                   automation made never starts another run
//   ctx.saved/save  what the step got done in an earlier attempt, so a retry
//                   carries on instead of posting twice
//   ctx.dryRun      a test run: say what would happen, post nothing
// and returns a small result for the run log ({ url } where there is one).
//
// An error with `retry: true` (the video is still encoding, Discord busy) puts
// the run back in the queue; any other error ends it.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { renderTemplate, MARKER } = require('./automation-catalog.cjs')

const SITE = (process.env.AUTOMATIONS_SITE_URL || 'https://3speak.tv').replace(/\/+$/, '')
const SNAP_APP = '3speak/snap'
const SNAP_TAG = 'community'
const SHORTS_COMMUNITY = 'hive-181335'
const CLIP_TIMEOUT_MS = 4 * 60 * 1000
// The checker wants at least 5 minutes between scheduling and posting.
const SHORT_POST_LEAD_MS = 7 * 60 * 1000

const retryable = (message, code) => Object.assign(new Error(message), { retry: true, code })
const failure = (message, code) => Object.assign(new Error(message), { code })

function permlinkFor(text, fallback) {
  const slug = String(text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 27).replace(/-+$/, '')
  return `${slug || fallback}-${crypto.randomBytes(3).toString('hex')}`
}

function commentOp({ parentAuthor, parentPermlink, author, permlink, title = '', body, meta }) {
  return ['comment', {
    parent_author: parentAuthor,
    parent_permlink: parentPermlink,
    author,
    permlink,
    title,
    body,
    json_metadata: JSON.stringify(meta),
  }]
}

// ── Post a snap ──────────────────────────────────────────────────────────────
// A reply under the newest @peak.snaps container, like the profile's snap
// composer (src/lib/snaps.js publishSnap), then indexed in the checker.
async function postSnap(step, event, ctx, deps) {
  const body = renderTemplate(step.properties.text, event.values)
  if (!body) throw failure('The snap text is empty for this post', 'empty_text')
  const tags = [SNAP_TAG, ...step.properties.tags.filter((t) => t !== SNAP_TAG)].slice(0, 10)
  if (ctx.dryRun) return { would: 'post_snap', text: body, tags }
  if (ctx.saved?.permlink) return { url: `${SITE}/@${ctx.user}/${ctx.saved.permlink}`, permlink: ctx.saved.permlink }

  const parent = await deps.snapsContainer()
  const permlink = permlinkFor(body, 'snap')
  await deps.broadcast(ctx.user, [commentOp({
    parentAuthor: parent.author, parentPermlink: parent.permlink, author: ctx.user, permlink, body,
    meta: { app: SNAP_APP, format: 'markdown', tags, type: 'snap', [MARKER]: ctx.marker },
  })])
  await ctx.save({ permlink })
  await deps.indexSnap(ctx.user, permlink).catch(() => {})
  return { url: `${SITE}/@${ctx.user}/${permlink}`, permlink }
}

// ── Comment on the post ──────────────────────────────────────────────────────
async function postComment(step, event, ctx, deps) {
  const body = renderTemplate(step.properties.text, event.values)
  if (!body) throw failure('The comment is empty for this post', 'empty_text')
  if (ctx.dryRun) return { would: 'post_comment', text: body, on: `@${event.author}/${event.permlink}` }
  if (ctx.saved?.permlink) return { url: `${SITE}/@${event.author}/${event.permlink}#@${ctx.user}/${ctx.saved.permlink}`, permlink: ctx.saved.permlink }

  const permlink = `re-${event.permlink.slice(0, 200)}-${Date.now().toString(36)}`
  await deps.broadcast(ctx.user, [commentOp({
    parentAuthor: event.author, parentPermlink: event.permlink, author: ctx.user, permlink, body,
    meta: { app: '3speak/new-version', format: 'markdown', [MARKER]: ctx.marker },
  })])
  await ctx.save({ permlink })
  return { url: `${SITE}/@${event.author}/${event.permlink}#@${ctx.user}/${permlink}`, permlink }
}

// ── Send to Discord ──────────────────────────────────────────────────────────
// Only to a Discord webhook (the catalog checks the address), never pinging
// @everyone or roles.
async function sendDiscord(step, event, ctx, deps) {
  const content = renderTemplate(step.properties.text, event.values).slice(0, 2000)
  if (!content) throw failure('The message is empty for this post', 'empty_text')
  if (ctx.dryRun) return { would: 'send_discord', text: content }
  if (ctx.saved?.sent) return { sent: true }

  const r = await deps.fetch(step.properties.webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, username: '3Speak', allowed_mentions: { parse: [] } }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  })
  if (r.status === 429 || r.status >= 500) throw retryable(`Discord answered ${r.status}`, 'discord_busy')
  if (!r.ok) throw failure(`Discord refused the message (${r.status}); check the webhook`, 'discord_refused')
  await ctx.save({ sent: true })
  return { sent: true }
}

// ── Post a Short ─────────────────────────────────────────────────────────────
// A clip of the new video (start, length, cropped upright or not) cut here with
// ffmpeg from its HLS, uploaded like an imported Short (import-batch.cjs: upload
// token, TUS, encode) and given a scheduled-post slot, which the checker
// publishes as a reply under @peak.snaps once the encode is done.
let clipping = Promise.resolve()

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    // Disposable work: let anything else on the box win the CPU and memory.
    if (child.pid) {
      fs.promises.writeFile(`/proc/${child.pid}/oom_score_adj`, '500').catch(() => {})
      try { os.setPriority(child.pid, 10) } catch { /* not fatal */ }
    }
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffmpeg timed out')) }, CLIP_TIMEOUT_MS)
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').pop() || ''}`))
    })
  })
}

/** The ffmpeg arguments for the clip (exported for the tests). */
function clipArgs(input, out, { start, length, vertical }) {
  // Upright: the middle 9:16 of a wider picture, 720x1280. Otherwise at most
  // 1280 wide, the shape kept.
  const vf = vertical
    ? "crop=w='if(gt(iw/ih\\,9/16)\\,ih*9/16\\,iw)':h='if(gt(iw/ih\\,9/16)\\,ih\\,iw*16/9)',scale=720:1280,setsar=1"
    : "scale=w='min(1280\\,iw)':h=-2,setsar=1"
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', String(start), '-i', input, '-t', String(length),
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    out,
  ]
}

// The video's HLS, one rendition near 720p: what ffmpeg cuts from. The same
// lookup as og-video.cjs (lookupManifest + pickVariant, KEEP IN SYNC), which is
// not required here because loading it starts its cache sweeper. Null when the
// video is not published yet (still encoding) or is gated.
const PLAYER_URL = (process.env.PLAYER_URL || 'https://play.3speak.tv').replace(/\/+$/, '')
const GATEWAYS = (process.env.OG_VIDEO_GATEWAYS || 'https://ipfs-3speak.b-cdn.net,https://ipfs.3speak.tv').split(',').map((g) => g.trim().replace(/\/+$/, '')).filter(Boolean)

function pickVariant(masterText) {
  const lines = masterText.split(/\r?\n/).map((l) => l.trim())
  const variants = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'))
    if (!uri) continue
    const res = lines[i].match(/RESOLUTION=\d+x(\d+)/)
    const named = uri.match(/(\d{3,4})p\//)
    variants.push({ uri, height: res ? Number(res[1]) : named ? Number(named[1]) : 480 })
  }
  if (!variants.length) return null
  // A Short is at most 720x1280: the rendition closest to 720 without going over 1080.
  const score = (v) => (v.height <= 1080 ? Math.abs(v.height - 720) : 10000 + v.height)
  return variants.sort((a, b) => score(a) - score(b))[0].uri
}

async function videoSource(author, permlink, fetchFn = fetch) {
  const r = await fetchFn(`${PLAYER_URL}/api/watch?v=${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) return null
  const doc = await r.json()
  if (!doc || !doc.success || doc.isPlaceholder || !doc.videoUrl) return null
  if (doc.status && doc.status !== 'published') return null
  if (doc.gated === true || doc.gated === 'true') return null
  let manifest = doc.videoUrl
  try { manifest = new URL(doc.videoUrl).searchParams.get('u') || doc.videoUrl } catch { return null }
  const m = manifest.match(/\/ipfs\/([A-Za-z0-9]{40,})\/(.+)$/)
  if (!m) return null
  for (const gateway of GATEWAYS) {
    const masterUrl = `${gateway}/ipfs/${m[1]}/${m[2]}`
    try {
      const res = await fetchFn(masterUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const text = await res.text()
      if (!text.startsWith('#EXTM3U')) continue
      const variant = text.includes('#EXT-X-STREAM-INF') ? pickVariant(text) : ''
      if (variant === null) continue
      return { variantUrl: variant ? new URL(variant, masterUrl).href : masterUrl }
    } catch { /* next gateway */ }
  }
  return null
}

async function postShort(step, event, ctx, deps) {
  const { start, length, vertical, tags } = step.properties
  const caption = renderTemplate(step.properties.caption, event.values).slice(0, 240)
  const total = Number(event.values.duration) || 0
  if (total && start >= total) throw failure(`The clip starts at ${start}s but the video is ${total}s long`, 'start_after_end')
  const seconds = total ? Math.min(length, total - start) : length
  if (ctx.dryRun) return { would: 'post_short', caption, start, length: seconds, vertical, tags }
  if (ctx.saved?.permlink) return { url: `${SITE}/shorts?v=${ctx.user}/${ctx.saved.permlink}`, permlink: ctx.saved.permlink, scheduledOn: ctx.saved.scheduledOn }

  let upload = ctx.saved?.upload || null
  if (!upload) {
    const source = await (deps.videoSource || videoSource)(event.author, event.permlink)
    if (!source?.variantUrl) throw retryable('The video is not ready to cut yet', 'video_not_ready')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-short-'))
    try {
      const clip = path.join(dir, 'short.mp4')
      // One clip at a time on the whole server.
      const turn = clipping.then(() => runFfmpeg(clipArgs(source.variantUrl, clip, { start, length: seconds, vertical })))
      clipping = turn.catch(() => {})
      await turn
      let thumbnailUrl = null
      try {
        const jpg = path.join(dir, 'cover.jpg')
        await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', '1', '-i', clip, '-frames:v', '1', '-q:v', '3', jpg])
        thumbnailUrl = await deps.uploadImage(fs.readFileSync(jpg), 'image/jpeg')
      } catch (e) { console.warn(`[automations] @${ctx.user} short cover skipped: ${e.message}`) }
      const token = await deps.mintUploadToken(ctx.user, true)
      const embedUrl = await deps.tusUpload({ file: clip, token: token.token, user: ctx.user, isShort: true, duration: seconds, onProgress: () => {} }) || token.embed_url
      if (!embedUrl || !/[?&]v=[^/]+\/[^&]+/.test(embedUrl)) throw failure('The upload gave no video link', 'upload_failed')
      await deps.commissionEncode(token)
      upload = { embedUrl, thumbnailUrl, duration: seconds, width: vertical ? 720 : 0, height: vertical ? 1280 : 0 }
      await ctx.save({ upload })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  const premium = await deps.isPro(ctx.user).catch(() => false)
  const permlink = permlinkFor(caption, 'short')
  const post = deps.buildPost({
    user: ctx.user,
    source: { title: '', description: caption, tags, platform: '3speak', sourceId: '', sourceUrl: '' },
    media: { duration: upload.duration, width: upload.width, height: upload.height },
    embedUrl: upload.embedUrl,
    thumbnailUrl: upload.thumbnailUrl,
    options: { community: SHORTS_COMMUNITY, nsfw: false, payout: 'default', beneficiaries: [], reusable: true },
    isShort: true,
    permlink,
    premium,
  })
  delete post.jsonMetadata.imported_from
  post.jsonMetadata[MARKER] = ctx.marker
  const parent = await deps.snapsContainer()
  const scheduledOn = new Date(Date.now() + SHORT_POST_LEAD_MS).toISOString()
  await deps.scheduleOnChecker({
    owner: ctx.user,
    permlink,
    scheduledOn,
    title: post.title,
    description: post.description,
    body: post.body,
    tags: post.tags,
    jsonMetadata: post.jsonMetadata,
    beneficiaries: post.beneficiaries,
    payoutOptions: 'default',
    thumbnail: upload.thumbnailUrl,
    parentAuthor: parent.author,
    parentPermlink: parent.permlink,
    embedPermlink: post.embedPermlink,
    reblog: false,
  }, deps.signScheduledPost)
  await ctx.save({ upload, permlink, scheduledOn })
  return { url: `${SITE}/shorts?v=${ctx.user}/${permlink}`, permlink, scheduledOn }
}

const HANDLERS = {
  post_snap: postSnap,
  post_comment: postComment,
  send_discord: sendDiscord,
  post_short: postShort,
}

module.exports = { HANDLERS, clipArgs, pickVariant, videoSource, retryable, failure }
