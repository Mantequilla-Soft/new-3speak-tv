// Blog to podcast (/narrate in the app): a creator's own written Hive post, or
// one they just wrote, read out by a synthetic voice and published as an audio
// post. This is the API under it; the frontend publishes the audio itself with
// the audio uploader (it signs the post), this only makes the MP3.
//
//   GET  /api/narrate/options          voices, music, today's minutes, Pro
//   GET  /api/narrate/posts            the creator's recent top-level posts
//   POST /api/narrate/script           {author, permlink} → the post as an editable script
//   POST /api/narrate/script-text      {body} → the same for markdown written on the page
//   POST /api/narrate/jobs             {script, title, voice, music, intro, preview} → {id}
//   GET  /api/narrate/jobs/:id         status, progress, place in the queue
//   GET  /api/narrate/jobs/:id/audio   the MP3 (the creator only)
//   POST /api/narrate/music            raw audio body, Pro: their own music bed
//   GET  /api/narrate/music/:kind/:id  listen to a focus bed or a library song
//
// Fair use: one render at a time on the box (narration-render renderQueue),
// minutes a day per creator (free NARRATION_FREE_MINUTES, Pro
// NARRATION_PRO_MINUTES), counted per UTC day in Mongo `narration-usage`
// (env-scoped like the automations). Previews (the first ~40 words) are not
// counted but are limited per hour. Identity only from a proven login.
//
// Gate: NARRATION_ENABLED=true, then NARRATION_USERS (comma list; unset = the
// team, set-but-empty = everyone).

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const express = require('express')
const text = require('./narration-text.cjs')
const render = require('./narration-render.cjs')

const ENV = process.env.NARRATION_ENV || process.env.AUTOMATIONS_ENV || process.env.IMPORT_BATCH_ENV || 'preview'
const ENABLED = process.env.NARRATION_ENABLED === 'true'
const TEAM = ['badadib', 'meno', 'tibfox', 'coolmole']
const USERS = process.env.NARRATION_USERS === undefined
  ? TEAM
  : process.env.NARRATION_USERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const FREE_MINUTES = Number(process.env.NARRATION_FREE_MINUTES) || 15
const PRO_MINUTES = Number(process.env.NARRATION_PRO_MINUTES) || 60
const PREVIEWS_PER_HOUR = 30
const PREVIEW_WORDS = 40
const MAX_SCRIPT_CHARS = 120000
const MAX_MUSIC_BYTES = 25 * 1024 * 1024
const JOB_TTL_MS = 24 * 60 * 60 * 1000
const MONGO_URI = process.env.NARRATION_MONGODB_URI || process.env.AUTOMATIONS_MONGODB_URI || process.env.MONGODB_URI || ''
const MONGO_DB = process.env.NARRATION_DATABASE_NAME || process.env.AUTOMATIONS_DATABASE_NAME || process.env.DATABASE_NAME || ''

const ACCOUNT = /^[a-z][a-z0-9.-]{1,14}[a-z0-9]$/
const PERMLINK = /^[a-z0-9-]{1,255}$/
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

// ── Minutes used per day ─────────────────────────────────────────────────────
function memoryUsage() {
  const rows = new Map()
  return {
    ready: Promise.resolve(true),
    async used(user, d) { return rows.get(`${user}|${d}`) || 0 },
    async add(user, d, secs) { rows.set(`${user}|${d}`, (rows.get(`${user}|${d}`) || 0) + secs) },
  }
}

function mongoUsage() {
  let col = null
  const ready = (async () => {
    const { MongoClient } = require('mongodb')
    const client = new MongoClient(MONGO_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 })
    await client.connect()
    col = client.db(MONGO_DB || undefined).collection('narration-usage')
    await col.createIndex({ env: 1, user: 1, day: 1 }, { name: 'env_user_day', unique: true }).catch(() => {})
    return true
  })().catch((e) => {
    console.error(`[narration] could not open the usage store, narration is OFF until a restart: ${e.message}`)
    return false
  })
  const c = () => {
    if (!col) throw Object.assign(new Error('Narration is not available right now'), { status: 503, code: 'unavailable' })
    return col
  }
  return {
    ready,
    async used(user, d) { return (await c().findOne({ env: ENV, user, day: d }))?.seconds || 0 },
    async add(user, d, secs) {
      await c().updateOne({ env: ENV, user, day: d }, { $inc: { seconds: secs }, $set: { updatedAt: new Date() } }, { upsert: true })
    },
  }
}

// One store for the page and the automation task (narrate_post), opened on first use.
let shared = null
const sharedUsage = () => (shared ||= MONGO_URI ? mongoUsage() : memoryUsage())

/** The creator's minutes today: { limit, used, left } in seconds. */
async function allowance(usage, user, pro, now) {
  const limit = (pro ? PRO_MINUTES : FREE_MINUTES) * 60
  const used = await usage.used(user, day(now))
  return { limit, used, left: Math.max(0, limit - used) }
}

/**
 * The narration of a post as paragraphs: the spoken intro (title, author and
 * the synthetic-voice label), then the script. Shared with the automation task.
 */
function withIntro(paragraphs, { title, author, intro = true }) {
  if (!intro) return paragraphs
  const t = String(title || '').trim().replace(/[.!?…:]+$/, '')
  const line = [t && `${t}.`, author && `By ${author}.`, 'Read by a synthetic voice.'].filter(Boolean).join(' ')
  return [{ text: line, heading: true }, ...paragraphs]
}

/** The first ~PREVIEW_WORDS words of a script, whole sentences where it can. */
function previewOf(paragraphs) {
  const out = []
  let words = 0
  for (const p of paragraphs) {
    const n = p.text.split(/\s+/).length
    if (words + n <= PREVIEW_WORDS || !out.length) { out.push(p); words += n } else break
    if (words >= PREVIEW_WORDS) break
  }
  const last = out[out.length - 1]
  if (last && words > PREVIEW_WORDS * 1.6) {
    const cut = last.text.split(/(?<=[.!?])\s+/)
    let keep = ''
    for (const s of cut) { if ((keep + s).split(/\s+/).length > PREVIEW_WORDS && keep) break; keep = keep ? `${keep} ${s}` : s }
    // Text without sentence stops is cut by words.
    if (keep.split(/\s+/).length > PREVIEW_WORDS * 1.6) keep = `${keep.split(/\s+/).slice(0, PREVIEW_WORDS).join(' ')}.`
    out[out.length - 1] = { ...last, text: keep }
  }
  return out
}

function mountNarration(app, deps) {
  const enabled = deps.enabled ?? ENABLED
  const users = deps.users ?? USERS
  const usage = deps.usage || sharedUsage()
  const now = deps.now || (() => Date.now())
  const cacheDir = deps.cacheDir || render.CACHE
  const renderFn = deps.render || render.renderNarration
  const listVoices = deps.listVoices || (() => render.listVoices())
  const library = deps.library || (() => render.musicLibrary())
  const resolveMusic = deps.resolveMusic || render.resolveMusic
  const mw = deps.limiter ? [deps.limiter] : []
  const jobs = new Map()
  const previews = new Map() // user → [ms]

  const allowed = (user) => !users.length || users.includes(user)

  async function who(req, res) {
    if (!enabled) { res.status(404).json({ error: 'Not found' }); return null }
    const user = String((await deps.resolveUser(req, res)) || '').toLowerCase()
    if (!user) { res.status(401).json({ error: 'Sign in first', errorCode: 'signin' }); return null }
    if (!allowed(user)) { res.status(403).json({ error: 'Narration is not open for your account yet', errorCode: 'not_open' }); return null }
    return user
  }
  const fail = (res, e) => {
    const status = e.status || (e.code ? 400 : 500)
    if (status >= 500) console.error('[narration]', e.message)
    res.status(status).json({ error: status >= 500 ? 'Something went wrong, try again' : e.message, errorCode: e.code || 'error' })
  }

  // Old renders go after a day.
  const sweep = async () => {
    const cut = now() - JOB_TTL_MS
    for (const [id, j] of jobs) {
      if (j.createdAt < cut) {
        jobs.delete(id)
        if (j.file) fsp.rm(j.file, { force: true }).catch(() => {})
      }
    }
  }
  if (deps.timers !== false) setInterval(() => { sweep().catch(() => {}) }, 60 * 60 * 1000).unref?.()

  app.get('/api/narrate/options', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    try {
      const pro = await deps.isPro(user).catch(() => false)
      const lib = pro ? library() : { tracks: [], moods: [] }
      res.json({
        pro,
        voices: listVoices(),
        focus: Object.keys(render.FOCUS_BEDS),
        library: { moods: lib.moods, tracks: lib.tracks.map(({ id, title, artist, mood, duration }) => ({ id, title, artist, mood, duration })) },
        allowance: await allowance(usage, user, pro, now()),
        defaultVoice: render.DEFAULT_VOICE,
        wordsPerMinute: text.WORDS_PER_MINUTE,
      })
    } catch (e) { fail(res, e) }
  })

  app.get('/api/narrate/posts', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    try {
      const start = String(req.query.after || '')
      const params = { sort: 'posts', account: user, limit: 20 }
      if (PERMLINK.test(start)) Object.assign(params, { start_author: user, start_permlink: start })
      const rows = (await deps.hiveCall('bridge.get_account_posts', params)) || []
      const posts = rows
        .filter((p) => p.author === user && !p.parent_author && (!start || p.permlink !== start))
        .map((p) => {
          const meta = p.json_metadata && typeof p.json_metadata === 'object' ? p.json_metadata : {}
          const { words } = text.narrationScript(p.body)
          const kind = meta['threespeak.audio'] || meta.audio ? 'audio' : meta.video ? 'video' : 'text'
          return {
            permlink: p.permlink, title: p.title, created: p.created, words, kind,
            image: Array.isArray(meta.image) && typeof meta.image[0] === 'string' ? meta.image[0] : '',
            narrated: !!meta['3speak']?.tts,
          }
        })
      res.json({ posts, more: rows.length >= 20 })
    } catch (e) { fail(res, e) }
  })

  app.post('/api/narrate/script', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    try {
      const author = String(req.body?.author || '').toLowerCase()
      const permlink = String(req.body?.permlink || '')
      if (!ACCOUNT.test(author) || !PERMLINK.test(permlink)) return res.status(400).json({ error: 'Pick a post', errorCode: 'bad_post' })
      // Own posts only: a voice reading someone else's words is not ours to publish.
      if (author !== user) return res.status(403).json({ error: 'You can only narrate your own posts', errorCode: 'not_yours' })
      const post = await deps.hiveCall('bridge.get_post', { author, permlink })
      if (!post?.body) return res.status(404).json({ error: 'That post was not found', errorCode: 'not_found' })
      const meta = post.json_metadata && typeof post.json_metadata === 'object' ? post.json_metadata : {}
      const { paragraphs, words } = text.narrationScript(post.body)
      res.json({
        author, permlink, title: post.title, words,
        script: text.scriptText(paragraphs),
        seconds: text.estimateSeconds(words),
        language: typeof meta.language === 'string' ? meta.language : '',
        image: Array.isArray(meta.image) && typeof meta.image[0] === 'string' ? meta.image[0] : '',
        tags: Array.isArray(meta.tags) ? meta.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
        community: /^hive-\d+$/.test(post.category || '') ? post.category : '',
      })
    } catch (e) { fail(res, e) }
  })

  // A post written on the narration page (just published, maybe not on the API
  // nodes yet): the same script from its markdown.
  app.post('/api/narrate/script-text', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    const body = String(req.body?.body || '')
    if (body.length > MAX_SCRIPT_CHARS) return res.status(400).json({ error: 'That text is too long for one recording', errorCode: 'too_long' })
    const { paragraphs, words } = text.narrationScript(body)
    res.json({ script: text.scriptText(paragraphs), words, seconds: text.estimateSeconds(words) })
  })

  app.post('/api/narrate/jobs', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    try {
      const b = req.body || {}
      const script = String(b.script || '')
      if (script.length > MAX_SCRIPT_CHARS) return res.status(400).json({ error: 'That text is too long for one recording', errorCode: 'too_long' })
      const paragraphs = text.parseScript(script)
      if (!paragraphs.length) return res.status(400).json({ error: 'There is nothing to read', errorCode: 'empty_script' })
      const pro = await deps.isPro(user).catch(() => false)
      const voice = String(b.voice || render.DEFAULT_VOICE)
      const voices = listVoices()
      if (!voices.some((v) => v.id === voice)) return res.status(400).json({ error: 'That voice is not available', errorCode: 'bad_voice' })
      if (!render.voiceAllowed(voices, voice, pro)) return res.status(403).json({ error: 'This voice is part of 3Speak Pro', errorCode: 'pro_only' })
      const music = resolveMusic(b.music, { user, pro })
      const preview = b.preview === true
      const spoken = withIntro(preview ? previewOf(paragraphs) : paragraphs, { title: String(b.title || ''), author: user, intro: preview ? false : b.intro !== false })

      let charge = 0
      if (preview) {
        const recent = (previews.get(user) || []).filter((t) => t > now() - 60 * 60 * 1000)
        if (recent.length >= PREVIEWS_PER_HOUR) return res.status(429).json({ error: 'That is a lot of previews, try again in a while', errorCode: 'preview_limit' })
        previews.set(user, [...recent, now()])
      } else {
        const words = spoken.reduce((n, p) => n + p.text.split(/\s+/).length, 0)
        charge = text.estimateSeconds(words)
        const a = await allowance(usage, user, pro, now())
        if (charge > a.left) {
          return res.status(429).json({
            error: 'This is longer than the narration time you have left today',
            errorCode: 'daily_limit', allowance: a, needed: charge,
          })
        }
        // Booked now so two tabs can't both spend the same minutes; settled to the real length after.
        await usage.add(user, day(now()), charge)
      }

      const id = crypto.randomBytes(12).toString('hex')
      await fsp.mkdir(cacheDir, { recursive: true })
      const job = { id, user, preview, status: 'queued', progress: 0, createdAt: now(), file: path.join(cacheDir, `${id}.mp3`), seconds: 0, error: null, voice, credit: music?.credit || null }
      jobs.set(id, job)
      render.renderQueue(async () => {
        job.status = 'rendering'
        try {
          const out = await renderFn({ paragraphs: spoken, voice, music, outFile: job.file, onProgress: (p) => { job.progress = Math.round(p * 100) / 100 } })
          job.seconds = out.seconds
          job.status = 'done'
          job.progress = 1
          if (charge) await usage.add(user, day(job.createdAt), out.seconds - charge).catch(() => {})
        } catch (e) {
          console.error(`[narration] render ${id} for @${user} failed: ${e.message}`)
          job.status = 'failed'
          job.error = e.code === 'bad_voice' || e.code === 'empty_script' ? e.message : 'The recording failed, try again'
          if (charge) await usage.add(user, day(job.createdAt), -charge).catch(() => {})
        }
      }).catch(() => {})
      res.json({ id, status: job.status, queue: render.queueLength() })
    } catch (e) { fail(res, e) }
  })

  app.get('/api/narrate/jobs/:id', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    const j = jobs.get(String(req.params.id))
    if (!j || j.user !== user) return res.status(404).json({ error: 'Not found', errorCode: 'not_found' })
    res.json({ id: j.id, status: j.status, progress: j.progress, seconds: j.seconds, error: j.error, preview: j.preview, voice: j.voice, credit: j.credit, queue: j.status === 'queued' ? render.queueLength() : 0 })
  })

  app.get('/api/narrate/jobs/:id/audio', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    const j = jobs.get(String(req.params.id))
    if (!j || j.user !== user || j.status !== 'done' || !fs.existsSync(j.file)) return res.status(404).json({ error: 'Not found', errorCode: 'not_found' })
    res.set('Cache-Control', 'private, max-age=3600')
    res.type('audio/mpeg').sendFile(j.file)
  })

  app.post('/api/narrate/music', ...mw, express.raw({ type: () => true, limit: MAX_MUSIC_BYTES }), async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    try {
      if (!(await deps.isPro(user).catch(() => false))) return res.status(403).json({ error: 'Your own music is part of 3Speak Pro', errorCode: 'pro_only' })
      if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'Pick a music file', errorCode: 'no_file' })
      const out = await render.renderQueue(() => (deps.storeMusic || render.storeMusicUpload)({ user, bytes: req.body }))
      res.json(out)
    } catch (e) { fail(res, e) }
  })

  app.get('/api/narrate/music/:kind/:id', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    try {
      const pro = await deps.isPro(user).catch(() => false)
      const m = resolveMusic({ kind: String(req.params.kind), id: String(req.params.id).replace(/\.mp3$/, '') }, { user, pro })
      if (!m) return res.status(404).end()
      res.set('Cache-Control', 'private, max-age=86400')
      res.type('audio/mpeg').sendFile(m.file)
    } catch (e) { fail(res, e) }
  })

  return { jobs, usage, sweep }
}

module.exports = { mountNarration, memoryUsage, sharedUsage, withIntro, previewOf, allowance, day, FREE_MINUTES, PRO_MINUTES }
