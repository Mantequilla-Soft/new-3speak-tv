// 🎞️ POST /api/thumbnail-frame?codec=h264|hevc&index=N
//
// Decodes one frame for the upload wizard's thumbnail editor, for browsers that
// can't read video frames themselves (Firefox for Android: canvas black, WebGL
// a flat colour, no VideoDecoder). The browser sends only the stretch the frame
// needs: a raw H.264 / HEVC stream (parameter sets + start codes) from the
// keyframe before the moment up to it (src/utils/serverFrame.js). ffmpeg
// decodes it and frame N in display order comes back as a JPEG; rotation is
// the browser's job. Nothing is stored.
//
// Same app key as /api/upload-image. Bounded: body size, a per-IP rate limit,
// two ffmpeg runs at a time (a few more wait, the rest get 503), a timeout.
const { spawn } = require('child_process')
const express = require('express')
const rateLimit = require('express-rate-limit')

const MAX_BODY = '40mb'
const MAX_RUNNING = 2
const MAX_WAITING = 4
const TIMEOUT_MS = 20000
// The longest side of what comes back; the editor's output is 1280 wide.
const MAX_SIDE = 1920

let running = 0
const waiting = []

function acquire() {
  if (running < MAX_RUNNING) { running += 1; return Promise.resolve() }
  if (waiting.length >= MAX_WAITING) return null
  return new Promise((resolve) => waiting.push(resolve))
}

function release() {
  const next = waiting.shift()
  if (next) next()
  else running -= 1
}

function decodeFrame(codec, index, input) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', codec, '-i', 'pipe:0',
      // n counts decoded frames in display order; keep the one asked for,
      // scaled down (never up) to MAX_SIDE on its longer side.
      '-vf', `select=eq(n\\,${index}),scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease`,
      '-fps_mode', 'passthrough', '-frames:v', '1',
      '-q:v', '2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    ]
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')) }, TIMEOUT_MS)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => { if (err.length < 2000) err += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const jpg = Buffer.concat(out)
      if (jpg.length) resolve(jpg)
      else reject(new Error(`ffmpeg exit ${code}${err ? `: ${err.trim().split('\n').pop()}` : ''}`))
    })
    // ffmpeg may stop reading once it has its frame: that's not an error.
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

function mountThumbnailFrame(app, { apiKey }) {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })

  app.post('/api/thumbnail-frame', limiter, express.raw({ type: () => true, limit: MAX_BODY }), async (req, res) => {
    if (!apiKey || (req.headers['x-api-key'] || '') !== apiKey) return res.status(401).json({ error: 'Unauthorized' })
    const codec = req.query.codec === 'hevc' ? 'hevc' : req.query.codec === 'h264' ? 'h264' : null
    const index = Number(req.query.index)
    if (!codec) return res.status(400).json({ error: 'codec must be h264 or hevc' })
    if (!Number.isInteger(index) || index < 0 || index > 5000) return res.status(400).json({ error: 'bad index' })
    if (!Buffer.isBuffer(req.body) || req.body.length < 16) return res.status(400).json({ error: 'empty body' })

    const slot = acquire()
    if (!slot) return res.status(503).json({ error: 'Busy, try again in a moment' })
    await slot
    try {
      const jpg = await decodeFrame(codec, index, req.body)
      res.set('Cache-Control', 'no-store')
      return res.type('image/jpeg').send(jpg)
    } catch (e) {
      console.warn(`[thumbnail-frame] ${codec} #${index} ${req.body.length}B: ${e.message}`)
      return res.status(422).json({ error: 'Could not decode that frame' })
    } finally {
      release()
    }
  })
}

module.exports = { mountThumbnailFrame, decodeFrame }
