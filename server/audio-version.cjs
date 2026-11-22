// A creator's own video published again as an audio episode ("Publish as
// audio" on the watch page). This only makes the MP3; the app publishes it with
// the audio uploader (it signs the post, names the video as its source), like
// /narrate does.
//
//   POST /api/audio-version/jobs            {author, permlink} → {id}
//   GET  /api/audio-version/jobs/:id        {status, error?, size?}
//   GET  /api/audio-version/jobs/:id/audio  the MP3 (the creator only)
//
// The sound comes from the video's own HLS variant (automation-tasks videoSource,
// the same lookup the post_audio automation uses): no supporters-only video, no
// placeholder. One ffmpeg job at a time on the box; a creator has one job at a
// time and a few a day. Files go after JOB_TTL_MS. Identity only from a proven
// login, and only the video's author may ask.
//
// Off with AUDIO_VERSION_ENABLED=false.
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/
const PERMLINK_RE = /^[a-z0-9-]{1,255}$/
const JOB_TTL_MS = 6 * 60 * 60 * 1000
const MAX_PER_DAY = 10
const FFMPEG_TIMEOUT_MS = 45 * 60 * 1000

/** Pure: ffmpeg arguments for the video's sound as a 128 kb/s stereo MP3. */
function audioArgs(input, output) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
    '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', output]
}

function runFfmpeg(args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '15', 'ffmpeg', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { if (err.length < 2000) err += d })
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timed out')) }, timeoutMs)
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(0, 200)}`)) })
  })
}

function mountAudioVersion(app, deps = {}) {
  const enabled = deps.enabled ?? process.env.AUDIO_VERSION_ENABLED !== 'false'
  const now = deps.now || (() => Date.now())
  const ffmpeg = deps.runFfmpeg || runFfmpeg
  const source = deps.videoSource || require('./automation-tasks.cjs').videoSource
  const tmpRoot = deps.tmpDir || os.tmpdir()
  const mw = deps.limiter ? [deps.limiter] : []
  const jobs = new Map() // id -> { id, user, author, permlink, status, error, file, createdAt }
  const daily = new Map() // user -> [ms]
  let queue = Promise.resolve()

  async function who(req, res) {
    if (!enabled) { res.status(404).json({ error: 'Not found' }); return null }
    const user = String((await deps.resolveUser(req, res)) || '').toLowerCase()
    if (!user) { res.status(401).json({ error: 'Sign in first', errorCode: 'signin' }); return null }
    return user
  }

  const sweep = async () => {
    const cut = now() - JOB_TTL_MS
    for (const [id, j] of jobs) {
      if (j.createdAt < cut) {
        jobs.delete(id)
        if (j.dir) fsp.rm(j.dir, { recursive: true, force: true }).catch(() => {})
      }
    }
    for (const [u, list] of daily) {
      const kept = list.filter((t) => t > now() - 24 * 3600 * 1000)
      if (kept.length) daily.set(u, kept); else daily.delete(u)
    }
  }
  if (deps.timers !== false) setInterval(() => { sweep().catch(() => {}) }, 30 * 60 * 1000).unref?.()

  async function run(job) {
    try {
      const src = await source(job.author, job.permlink)
      if (!src?.variantUrl) throw Object.assign(new Error('This video has no playable sound yet'), { code: 'not_ready' })
      job.status = 'working'
      job.dir = fs.mkdtempSync(path.join(tmpRoot, 'audio-version-'))
      const file = path.join(job.dir, 'audio.mp3')
      await ffmpeg(audioArgs(src.variantUrl, file))
      job.file = file
      job.size = (await fsp.stat(file)).size
      job.status = 'done'
    } catch (e) {
      job.status = 'failed'
      job.error = e.code ? e.message : 'The sound could not be taken from this video'
      job.errorCode = e.code || 'failed'
      if (!e.code) console.error('[audio-version]', e.message)
    }
  }

  app.post('/api/audio-version/jobs', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    const author = String(req.body?.author || '').toLowerCase()
    const permlink = String(req.body?.permlink || '')
    if (!ACCOUNT_RE.test(author) || !PERMLINK_RE.test(permlink)) return res.status(400).json({ error: 'Invalid video', errorCode: 'invalid' })
    if (author !== user) return res.status(403).json({ error: 'Only the creator can publish their video as audio', errorCode: 'not_owner' })
    for (const j of jobs.values()) {
      if (j.user === user && (j.status === 'queued' || j.status === 'working')) return res.status(409).json({ error: 'One is already being made', errorCode: 'busy', id: j.id })
    }
    const today = (daily.get(user) || []).filter((t) => t > now() - 24 * 3600 * 1000)
    if (today.length >= MAX_PER_DAY) return res.status(429).json({ error: 'That is enough for today, try again tomorrow', errorCode: 'daily_limit' })
    daily.set(user, [...today, now()])
    const job = { id: crypto.randomBytes(9).toString('hex'), user, author, permlink, status: 'queued', createdAt: now() }
    jobs.set(job.id, job)
    queue = queue.catch(() => {}).then(() => run(job))
    res.json({ id: job.id })
  })

  const own = (req, res, user) => {
    const job = jobs.get(String(req.params.id || ''))
    if (!job || job.user !== user) { res.status(404).json({ error: 'Not found', errorCode: 'not_found' }); return null }
    return job
  }

  app.get('/api/audio-version/jobs/:id', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    const job = own(req, res, user)
    if (!job) return
    res.set('Cache-Control', 'no-store')
    res.json({ status: job.status, ...(job.error ? { error: job.error, errorCode: job.errorCode } : {}), ...(job.size ? { size: job.size } : {}) })
  })

  app.get('/api/audio-version/jobs/:id/audio', ...mw, async (req, res) => {
    const user = await who(req, res)
    if (!user) return
    const job = own(req, res, user)
    if (!job) return
    if (job.status !== 'done' || !job.file) return res.status(409).json({ error: 'Not ready yet', errorCode: 'not_ready' })
    res.set('Cache-Control', 'private, no-store')
    res.type('audio/mpeg')
    fs.createReadStream(job.file).on('error', () => res.status(410).end()).pipe(res)
  })

  return { jobs, sweep }
}

module.exports = { mountAudioVersion, audioArgs }
