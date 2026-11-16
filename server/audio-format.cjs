// ── Podcast audio as the audio service takes it ──────────────────────────────
// The audio service takes MP3, M4A, OGG, WebM and WAV (src/utils/audioUpload.js
// SERVICE_FORMATS). A feed's enclosure type says little: hosts serve AAC, Opus,
// FLAC, a video MP4 or a type nobody knows. So the downloaded file itself is
// read with ffprobe, and anything the service does not take is made an MP3 with
// ffmpeg first. Nothing goes out under a format it is not in.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const MIME_OF = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', wav: 'audio/wav' }

/**
 * The service format of a probed file, or null when it has to be converted.
 * `probe`: { formats: ffprobe's format_name split at commas, audio: the first
 * audio stream's codec, video: whether it has a real video stream (cover art
 * does not count) }.
 */
function serviceFormatOf(probe) {
  if (!probe || !probe.audio || probe.video) return null
  const f = new Set(probe.formats || [])
  const c = probe.audio
  if (f.has('mp3') && c === 'mp3') return 'mp3'
  if (f.has('mp4') && f.has('m4a') && c === 'aac') return 'm4a'
  if (f.has('ogg') && (c === 'vorbis' || c === 'opus')) return 'ogg'
  if (f.has('webm') && (c === 'vorbis' || c === 'opus')) return 'webm'
  if (f.has('wav') && /^pcm_/.test(c)) return 'wav'
  return null
}

/** What is in the file: { formats, audio, video, duration }, or null when ffprobe cannot read it. */
function probeAudio(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name:stream_disposition=attached_pic',
      '-of', 'json', file,
    ], { timeout: 30000 })
    let out = ''
    p.stdout.on('data', (b) => { out += b })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      try {
        const d = JSON.parse(out)
        const streams = d.streams || []
        const audio = streams.find((s) => s.codec_type === 'audio')
        resolve({
          formats: String(d.format?.format_name || '').split(',').filter(Boolean),
          audio: audio ? String(audio.codec_name || '') : '',
          video: streams.some((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1),
          duration: Number(d.format?.duration) || 0,
        })
      } catch { resolve(null) }
    })
  })
}

/** The file's audio as an MP3 (128 kbps, no picture), at `out`. Resolves true when it worked. */
function transcodeToMp3(file, out) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '128k', out], { timeout: 30 * 60 * 1000 })
    p.on('error', () => resolve(false))
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0))
  })
}

/**
 * A downloaded episode ready for the audio service → { file, format, mime, converted }.
 * The original is removed when it was converted. Throws with `code: 'format'`
 * when the file holds no audio ffmpeg can read: that will not change on a retry.
 */
async function prepareAudio(file) {
  const probe = await probeAudio(file)
  const format = serviceFormatOf(probe)
  if (format) return { file, format, mime: MIME_OF[format], converted: false }
  if (!probe || !probe.audio) {
    throw Object.assign(new Error('The episode file holds no audio that can be read'), { code: 'format' })
  }
  const out = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.converted.mp3`)
  if (!(await transcodeToMp3(file, out))) {
    try { fs.rmSync(out, { force: true }) } catch { /* nothing there */ }
    throw Object.assign(new Error(`The ${probe.audio.toUpperCase()} audio could not be converted to MP3`), { code: 'format' })
  }
  try { fs.rmSync(file, { force: true }) } catch { /* the job folder goes anyway */ }
  return { file: out, format: 'mp3', mime: MIME_OF.mp3, converted: true }
}

module.exports = { serviceFormatOf, probeAudio, transcodeToMp3, prepareAudio, MIME_OF }
