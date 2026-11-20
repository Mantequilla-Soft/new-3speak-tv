// Blog to podcast: renders a narration script to an MP3 with Piper and ffmpeg.
//
// Each paragraph is spoken on its own (Piper reads one line of text per run),
// the pieces are joined with a pause between paragraphs and a longer one after
// a heading, the voice is brought to TARGET_LUFS with a measured two-pass
// loudnorm (a one-pass loudnorm pumps on quiet openings), and an optional music
// bed is looped under it well below the voice, faded in and out.
//
// One render runs at a time on the box (renderQueue): the narration page and
// the automation task share it. Music beds:
//   focus:<rain|piano|fireplace>  the focus mode's moods, rendered once to files
//                                 (scripts/narration/render-music-beds.mjs)
//   library:<id>                  a song of the editor's music library (CC BY,
//                                 the post must carry its credit)
//   upload:<sha1>                 a file the creator uploaded (Pro), stored per user

const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const TOOLS = process.env.NARRATION_PIPER_DIR || '/mnt/HC_Volume_103240961/prodops/tools/piper'
const PIPER_BIN = process.env.NARRATION_PIPER_BIN || path.join(TOOLS, 'piper')
const VOICES_DIR = process.env.NARRATION_VOICES_DIR || path.join(TOOLS, 'voices')
const CACHE = process.env.NARRATION_CACHE_DIR || '/mnt/HC_Volume_103240961/prodops/cache/narration'
const FOCUS_DIR = process.env.NARRATION_FOCUS_DIR || '/mnt/HC_Volume_103240961/prodops/cache/narration-music'
const LIBRARY_DIR = process.env.NARRATION_LIBRARY_DIR || '/mnt/HC_Volume_103240961/editor-music'
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

const TARGET_LUFS = Number(process.env.NARRATION_TARGET_LUFS) || -16
// How far the music sits under the voice, in LU.
const BED_UNDER_DB = Number(process.env.NARRATION_BED_UNDER_DB) || 18
const PARAGRAPH_PAUSE_S = 0.7
const HEADING_PAUSE_S = 1.1
const MUSIC_LEAD_S = 2
const MUSIC_TAIL_S = 3
const PIPER_TIMEOUT_MS = 3 * 60 * 1000

// The installed English voices, as people would name them. Voices missing on
// disk are left out; `en_US-mike-medium` needs a newer Piper than ours.
const VOICE_INFO = {
  'en_GB-alan-medium': { name: 'Alan', gender: 'male', accent: 'British' },
  'en_GB-alba-medium': { name: 'Alba', gender: 'female', accent: 'Scottish' },
  'en_GB-cori-high': { name: 'Cori', gender: 'female', accent: 'British' },
  'en_GB-jenny_dioco-medium': { name: 'Jenny', gender: 'female', accent: 'British' },
  'en_GB-northern_english_male-medium': { name: 'Northern', gender: 'male', accent: 'British' },
  'en_GB-southern_english_female-low': { name: 'Southern', gender: 'female', accent: 'British' },
  'en_US-amy-medium': { name: 'Amy', gender: 'female', accent: 'American' },
  'en_US-bryce-medium': { name: 'Bryce', gender: 'male', accent: 'American' },
  'en_US-danny-low': { name: 'Danny', gender: 'male', accent: 'American' },
  'en_US-hfc_female-medium': { name: 'Hannah', gender: 'female', accent: 'American' },
  'en_US-hfc_male-medium': { name: 'Henry', gender: 'male', accent: 'American' },
  'en_US-joe-medium': { name: 'Joe', gender: 'male', accent: 'American' },
  'en_US-john-medium': { name: 'John', gender: 'male', accent: 'American' },
  'en_US-kathleen-low': { name: 'Kathleen', gender: 'female', accent: 'American' },
  'en_US-kristin-medium': { name: 'Kristin', gender: 'female', accent: 'American' },
  'en_US-kusal-medium': { name: 'Kusal', gender: 'male', accent: 'American' },
  'en_US-lessac-high': { name: 'Lessac', gender: 'female', accent: 'American' },
  'en_US-libritts-high': { name: 'Libby', gender: 'female', accent: 'American' },
  'en_US-ljspeech-high': { name: 'Linda', gender: 'female', accent: 'American' },
  'en_US-norman-medium': { name: 'Norman', gender: 'male', accent: 'American' },
  'en_US-reza_ibrahim-medium': { name: 'Reza', gender: 'male', accent: 'American' },
  'en_US-ryan-high': { name: 'Ryan', gender: 'male', accent: 'American' },
  'en_US-sam-medium': { name: 'Sam', gender: 'male', accent: 'American' },
}
// What everyone gets, two female and two male; Pro gets every voice.
const FREE_VOICES = ['en_GB-cori-high', 'en_US-lessac-high', 'en_GB-alan-medium', 'en_US-ryan-high']
const DEFAULT_VOICE = 'en_GB-alan-medium'

const FOCUS_BEDS = { rain: 'rain.mp3', piano: 'piano.mp3', fireplace: 'fireplace.mp3' }

/** The voices on disk: { id, name, gender, accent, language, quality, free }. */
function listVoices(dir = VOICES_DIR) {
  let files = []
  try { files = fs.readdirSync(dir) } catch { return [] }
  return Object.entries(VOICE_INFO)
    .filter(([id]) => files.includes(`${id}.onnx`) && files.includes(`${id}.onnx.json`))
    .map(([id, info]) => ({
      id,
      ...info,
      language: id.split('-')[0].replace('_', '-'),
      quality: id.split('-').pop(),
      free: FREE_VOICES.includes(id),
    }))
}

const voiceAllowed = (voices, id, pro) => voices.some((v) => v.id === id && (pro || v.free))

let libraryCache = null
/** The editor's music library: { tracks: [{ id, title, artist, mood, duration, credit, file }], moods }. */
function musicLibrary(dir = LIBRARY_DIR) {
  if (libraryCache && libraryCache.dir === dir && Date.now() - libraryCache.at < 10 * 60 * 1000) return libraryCache.data
  let data = { tracks: [], moods: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'))
    data = {
      moods: Array.isArray(raw.moods) ? raw.moods.map((m) => ({ id: String(m.id), label: String(m.label || m.id) })) : [],
      tracks: (Array.isArray(raw.tracks) ? raw.tracks : [])
        .filter((t) => t && /^[a-z0-9][a-z0-9-]{0,79}$/.test(t.id) && typeof t.file === 'string' && !t.file.includes('/'))
        .map((t) => ({
          id: t.id, title: String(t.title || t.id), artist: String(t.artist || ''), mood: String(t.mood || ''),
          duration: Number(t.duration) || 0, credit: String(t.credit || ''), file: t.file,
          license: String(t.license || ''), licenseUrl: String(t.licenseUrl || ''),
          source: String(t.source || ''), sourceUrl: String(t.sourceUrl || ''),
        })),
    }
  } catch { /* no library on this box */ }
  libraryCache = { dir, at: Date.now(), data }
  return data
}

const uploadFile = (user, sha) => path.join(CACHE, 'music', `${user}-${sha}.mp3`)

/**
 * A music choice as { file, lufs, credit? } or null for none. Throws a coded
 * error for one this creator may not use or that is gone.
 * kinds: off | focus | library (Pro) | upload (Pro, their own file)
 */
function resolveMusic(music, { user, pro, focusDir = FOCUS_DIR, libraryDir = LIBRARY_DIR } = {}) {
  const kind = music?.kind || 'off'
  if (kind === 'off') return null
  const id = String(music.id || '')
  const no = (msg, code) => { throw Object.assign(new Error(msg), { code, status: 400 }) }
  if (kind === 'focus') {
    const file = FOCUS_BEDS[id] && path.join(focusDir, FOCUS_BEDS[id])
    if (!file || !fs.existsSync(file)) no('That music is not available', 'music_missing')
    let lufs = -20
    try {
      const beds = JSON.parse(fs.readFileSync(path.join(focusDir, 'beds.json'), 'utf8'))
      const b = (Array.isArray(beds) ? beds : beds.beds || []).find((x) => x.id === id)
      if (Number.isFinite(Number(b?.lufs))) lufs = Number(b.lufs)
    } catch { /* the default */ }
    return { file, lufs }
  }
  if (!pro) no('This music is part of 3Speak Pro', 'pro_only')
  if (kind === 'library') {
    const t = musicLibrary(libraryDir).tracks.find((x) => x.id === id)
    const file = t && path.join(libraryDir, t.file)
    if (!file || !fs.existsSync(file)) no('That song is not in the library', 'music_missing')
    // The post credits the song like a Short with a library song (utils/soundCredits.js).
    const credit = { id: `lib-${t.id}`, title: t.title, artist: t.artist, source: t.source, sourceUrl: t.sourceUrl, license: t.license, licenseUrl: t.licenseUrl }
    return { file, lufs: -16, credit }
  }
  if (kind === 'upload') {
    if (!/^[0-9a-f]{40}$/.test(id)) no('That music file is not available', 'music_missing')
    const file = uploadFile(user, id)
    if (!fs.existsSync(file)) no('That music file is not available any more, upload it again', 'music_missing')
    return { file, lufs: -16 }
  }
  return no('Unknown music', 'bad_music')
}

// ── Processes ────────────────────────────────────────────────────────────────
function run(cmd, args, { input, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    let out = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(cmd)} timed out`)) }, timeout)
    p.stdout.on('data', (d) => { if (out.length < 1e6) out += d })
    p.stderr.on('data', (d) => { err = (err + d).slice(-20000) })
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ out, err })
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`))
    })
    if (input != null) p.stdin.end(input)
    else p.stdin.end()
  })
}
const ffmpeg = (args, opts) => run(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], opts)

async function probeSeconds(file) {
  const { out } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 30000 })
  return Number(out.trim()) || 0
}

/** loudnorm's first-pass numbers for a file. */
async function measureLoudness(file) {
  const { err } = await ffmpeg(['-i', file, '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'])
  const json = err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1)
  const m = JSON.parse(json)
  return { i: m.input_i, tp: m.input_tp, lra: m.input_lra, thresh: m.input_thresh, offset: m.target_offset }
}

// One render at a time on this box, in order.
let tail = Promise.resolve()
let waiting = 0
function renderQueue(fn) {
  waiting += 1
  const next = tail.then(() => { waiting -= 1; return fn() }, () => { waiting -= 1; return fn() })
  tail = next.catch(() => {})
  return next
}
const queueLength = () => waiting

async function inTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'narrate-'))
  try { return await fn(dir) } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

/**
 * Speaks `paragraphs` ([{ text, heading? }]) with `voice` into `outFile` (MP3).
 * `music`: a resolveMusic() result or null. `onProgress(0..1)`.
 * Resolves { seconds }.
 */
async function renderNarration({ paragraphs, voice, music = null, outFile, onProgress, voicesDir = VOICES_DIR, piper = PIPER_BIN }) {
  const model = path.join(voicesDir, `${voice}.onnx`)
  if (!VOICE_INFO[voice] || !fs.existsSync(model)) throw Object.assign(new Error('That voice is not available'), { code: 'bad_voice' })
  const config = JSON.parse(await fsp.readFile(`${model}.json`, 'utf8'))
  const rate = Number(config?.audio?.sample_rate) || 22050
  const parts = paragraphs.filter((p) => p && String(p.text || '').trim())
  if (!parts.length) throw Object.assign(new Error('There is nothing to read'), { code: 'empty_script' })
  return inTempDir(async (dir) => {
    const pause = async (name, secs) => {
      const f = path.join(dir, name)
      await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=${rate}:cl=mono`, '-t', String(secs), '-c:a', 'pcm_s16le', f])
      return f
    }
    const gap = await pause('gap.wav', PARAGRAPH_PAUSE_S)
    const headGap = await pause('headgap.wav', HEADING_PAUSE_S)
    const list = []
    for (let i = 0; i < parts.length; i++) {
      const wav = path.join(dir, `p${String(i).padStart(4, '0')}.wav`)
      const line = String(parts[i].text).replace(/\s+/g, ' ').trim()
      await run(piper, ['--model', model, '--output_file', wav, '--sentence_silence', '0.35'], { input: `${line}\n`, timeout: PIPER_TIMEOUT_MS })
      list.push(wav)
      if (i < parts.length - 1) list.push(parts[i].heading ? headGap : gap)
      onProgress?.(((i + 1) / parts.length) * 0.85)
    }
    const listFile = path.join(dir, 'list.txt')
    await fsp.writeFile(listFile, list.map((f) => `file '${f}'`).join('\n'))
    const joined = path.join(dir, 'voice.wav')
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'pcm_s16le', joined])

    const m = await measureLoudness(joined)
    const level = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true`
    onProgress?.(0.9)
    const voiceSecs = await probeSeconds(joined)
    if (!music) {
      await ffmpeg(['-i', joined, '-af', `${level},aresample=44100`, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', outFile])
    } else {
      const total = MUSIC_LEAD_S + voiceSecs + MUSIC_TAIL_S
      const bedGain = (TARGET_LUFS - BED_UNDER_DB) - music.lufs
      const lead = Math.round(MUSIC_LEAD_S * 1000)
      const graph = [
        `[0:a]${level},aresample=44100,aformat=channel_layouts=stereo,adelay=${lead}|${lead},apad=whole_dur=${total.toFixed(3)}[v]`,
        `[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=${bedGain.toFixed(2)}dB,atrim=0:${total.toFixed(3)},afade=t=in:d=2,afade=t=out:st=${Math.max(0, total - 4).toFixed(3)}:d=4[m]`,
        '[v][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]',
      ].join(';')
      await ffmpeg(['-i', joined, '-stream_loop', '-1', '-i', music.file, '-filter_complex', graph, '-map', '[out]', '-t', total.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '128k', outFile])
    }
    onProgress?.(1)
    return { seconds: Math.round(await probeSeconds(outFile)) }
  })
}

/**
 * A creator's music upload as a library-ready MP3 (stereo, -16 LUFS, at most
 * `maxSeconds`), stored per user. Resolves { id, seconds }.
 */
async function storeMusicUpload({ user, bytes, maxSeconds = 15 * 60 }) {
  return inTempDir(async (dir) => {
    const src = path.join(dir, 'upload.bin')
    await fsp.writeFile(src, bytes)
    const { out } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', src], { timeout: 30000 })
      .catch(() => ({ out: '{}' }))
    let info = {}
    try { info = JSON.parse(out) } catch { /* not media */ }
    if (!info.streams?.length) throw Object.assign(new Error('That file has no sound we can use'), { code: 'not_audio', status: 400 })
    const secs = Number(info.format?.duration) || 0
    if (secs > maxSeconds) throw Object.assign(new Error('The music may be at most 15 minutes long'), { code: 'too_long', status: 400 })
    const mp3 = path.join(dir, 'music.mp3')
    await ffmpeg(['-i', src, '-map', '0:a:0', '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', mp3])
    const sha = crypto.createHash('sha1').update(await fsp.readFile(mp3)).digest('hex')
    const dest = uploadFile(user, sha)
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    await fsp.copyFile(mp3, dest)
    return { id: sha, seconds: Math.round(await probeSeconds(dest)) }
  })
}

module.exports = {
  CACHE, FOCUS_DIR, LIBRARY_DIR, FOCUS_BEDS, FREE_VOICES, DEFAULT_VOICE, VOICE_INFO, TARGET_LUFS,
  listVoices, voiceAllowed, musicLibrary, resolveMusic, renderNarration, renderQueue, queueLength,
  storeMusicUpload, probeSeconds, uploadFile,
}
