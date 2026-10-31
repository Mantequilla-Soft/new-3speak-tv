// ── Share images for communities and profiles ──────────────────────────────
// A link to a community or a channel used to unfurl with a video thumbnail (a
// community's newest upload) or a bare square avatar. These are 1200x630 cards
// in the style of the site's own share banner (public/og-image.jpg): the
// community's or creator's picture in the ring where the 3S logo sits, the name
// big on the left, a subtitle, "3speak.tv" at the bottom.
//
//   GET /api/og-card/community/<hive-123>.jpg
//   GET /api/og-card/user/<account>.jpg
//
// The same card for the other pages that are one thing (added 2026-10-25),
// each drawn on its first request and kept:
//
//   GET /api/og-card/badge/<account>.jpg          the badge's picture and title
//   GET /api/og-card/tag/<tag>.jpg                #tag, a '#' in the frame
//   GET /api/og-card/invite/<code>.jpg            the inviter: "Join me on 3Speak"
//   GET /api/og-card/stream/<room>.jpg            a live room: title, LIVE, host
//   GET /api/og-card/playlist/<id>.jpg            cover (square) and name
//   GET /api/og-card/audio/<author>/<permlink>.jpg   artwork (square) and title
//   GET /api/og-card/podcast/<feedId>.jpg             an outside podcast: cover, name, author
//   GET /api/og-card/episode/<feedId>_<hash>.jpg      one of its episodes: cover, title, show
//
// Files live in data/og-cards/<kind>/<id>.jpg (OG_CARD_DIR to move them):
//   - communities: every Hive community is drawn by the weekly sync below; one
//     that is new since then is drawn on its first request.
//   - profiles: drawn on the first request only, then kept. There are far too
//     many accounts to draw them all.
//   - once a week (OG_CARD_SYNC=off turns it off) the sync redraws every
//     community and every profile card already on disk, so a new name or
//     picture shows up within a week. A file is only rewritten when the image
//     changed, so its URL (versioned by mtime, see cardVersion) stays put and
//     platforms keep their cached copy.
//
// The name is drawn with the banner's font (Inter Tight: Latin, Greek,
// Cyrillic, Vietnamese), emoji as Twemoji pictures, and Chinese, Japanese and
// Korean with Noto Sans subsets from Google Fonts. Anything else (Arabic,
// Thai, Devanagari, ...) cannot be drawn properly here: a profile then shows
// its @handle, as the owner asked, a community its id.
//
// og-server.cjs (a separate process) only needs cardUrl/cardVersion, so the
// renderer and its fonts load on the first render, not on require.

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const W = 1200
const H = 630
const CARD_DIR = process.env.OG_CARD_DIR || path.join(__dirname, 'data', 'og-cards')
const KINDS = new Set(['community', 'user', 'badge', 'tag', 'invite', 'stream', 'playlist', 'audio', 'podcast', 'episode'])
// Kinds whose cards the weekly sync draws again (communities are listed from
// Hive instead). A stream's room is gone once it ends, so its card is only
// kept for STREAM_KEEP_MS; a tag card never changes.
const REDRAWN = ['user', 'badge', 'invite', 'playlist', 'audio']
const STREAM_KEEP_MS = 14 * 24 * 60 * 60 * 1000
// Outside podcasts are not ours to keep: their cards go 30 days after they were
// drawn (the hourly check and the route both see to it), and the next share of
// that show or episode draws a fresh one.
const EXPIRES_MS = { podcast: 30 * 24 * 60 * 60 * 1000, episode: 30 * 24 * 60 * 60 * 1000 }
const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/
const COMMUNITY_RE = /^hive-\d{1,10}$/
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const INVITE_CODE_RE = /^[a-z0-9]{10}$/
// The hangouts server names a room `<host>-<7 base36>`.
const ROOM_RE = /^[a-z0-9][a-z0-9.-]{2,40}$/
const PLAYLIST_ID_RE = /^[a-zA-Z0-9-]{8,64}$/
const AUDIO_ID_RE = /^[a-z][a-z0-9.-]{2,15}\/[a-z0-9][a-z0-9-]{0,255}$/
// Outside podcasts (the checker's podcast_feeds): a show is its feed id, an
// episode `<feedId>:<16 base64url>`, kept as `<feedId>_<hash>` (no ':' in a URL path).
const PODCAST_ID_RE = /^[0-9a-f]{24}$/
const EPISODE_FILE_RE = /^[0-9a-f]{24}_[A-Za-z0-9_-]{16}$/
// Where live rooms are looked up (the site's VITE_HANGOUTS_API_URLS servers).
const HANGOUTS_APIS = (process.env.OG_CARD_HANGOUTS_APIS || 'https://live.3speak.tv')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
// The loopback side of the /img/ cache: /h/ passes images.hive.blog through,
// /a/ square-crops an images.3speak.tv picture. '' fetches the hosts directly.
const IMG_LOOPBACK = process.env.OG_CARD_IMG_LOOPBACK ?? 'http://127.0.0.1:8095'
// Covers and thumbnails are only fetched from these hosts (og-video's list),
// so a picture URL in someone's metadata cannot point the server anywhere else.
const PICTURE_HOSTS = new Set([
  'images.3speak.tv', 'images.hive.blog', 'files.peakd.com', 'i.ecency.com',
  'ipfs-3speak.b-cdn.net', 'hotipfs-3speak-1.b-cdn.net', 'ipfs.3speak.tv', 'ipfs-audio.3speak.tv',
])
const HIVE_APIS = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://techcoderx.com']
// The site's /img/ avatar cache (nginx conf.d/3speak-img.conf): it follows
// Hive's avatar redirect and keeps the picture, so an avatar any visitor has
// seen comes back in ~0.2 s instead of the 10-20 s Hive's proxy can take.
// images.hive.blog itself answers this box 403 for pictures it has not cached
// yet, so it is only the second choice.
const AVATAR_SOURCES = (process.env.OG_CARD_AVATAR_BASES || 'https://3speak.tv/img/u,https://images.hive.blog/u')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
const AVATAR_TIMEOUT_MS = 25000
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg'
const FETCH_TIMEOUT_MS = 8000
const SYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000
const SYNC_CHECK_MS = 60 * 60 * 1000
const SYNC_FIRST_DELAY_MS = 3 * 60 * 1000
const SYNC_CONCURRENCY = 2
const RENDER_CONCURRENCY = 3
const MISSING_TTL_MS = 60 * 60 * 1000
// Hive's grey "no picture" person (what /avatar/large answers for an account
// without a profile picture): the card shows the initial instead.
const DEFAULT_AVATAR_SHA256 = '51b19cb9e7fe0fcd39c803e8a3a3d98505e7609db75bc25c4fd91234b1bb11db'

// Colours of public/og-image.jpg.
const NAVY = '#141a4a'
const LAVENDER = '#c9c6ee'
const LOGO_NAVY = '#313886'

// The 3S mark (the brand's flat logo, viewBox 150x130).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 130"><path fill="#E32933" d="M80.4,65.3c-5.3-5.4-12.8-8.7-22.4-9.9L83.4,30V7.5H7.2v24.7h43.3L27.6,55.4v17.5h9c1.3,0,2.6,0,3.8,0.1c6.5,0.3,11.3,1.3,14.4,3.1c3.7,2.1,5.6,5.4,5.6,9.8c0,4-1.4,7.2-4.4,9.5s-7.3,3.5-13.1,3.5c-7.4,0-14.6-2.3-21.6-6.8L3.7,109.7c10.9,9.4,24.4,14,40.5,14c13.8,0,24.7-3.3,32.5-9.9S88.4,98.2,88.4,87C88.4,78,85.8,70.7,80.4,65.3z"/><path fill="#6DC5D7" d="M70.5,118.1c-8.8-3.8-15.7-8.9-20.8-15.4L64,86.1c4.3,4.8,9.7,8.5,16,11.1s13.1,4,20.1,4c6.2,0,11-1,14.4-3.1c3.4-2.1,5.1-4.9,5.1-8.5c0-2.9-1.2-5.3-3.6-7.2c-2.4-2-6.3-3.6-11.8-4.9l-17.9-4.1C75,70.7,66.8,66.8,61.5,61.6c-5.3-5.2-7.9-11.7-7.9-19.5c0-10.4,4.1-18.7,12.2-25.1C74,10.7,85.1,7.5,99,7.5c9.7,0,18.4,1.5,26.3,4.6s14.2,7.4,18.9,12.9l-14.1,17.1c-9.4-8.1-20-12.1-31.8-12.1c-6.1,0-10.6,1-13.7,3c-3.1,2-4.7,4.8-4.7,8.2c0,2.7,1.2,4.9,3.5,6.6c2.3,1.7,6.3,3.1,11.9,4.4l19,4.5c11.3,2.5,19.3,6.2,24.2,11.4s7.4,11.6,7.4,19.6c0,11.1-4.1,19.9-12.2,26.3c-8.1,6.4-19.4,9.6-33.9,9.6C89.1,123.7,79.3,121.8,70.5,118.1z"/><path fill="${LOGO_NAVY}" d="M80,97.2c-6.3-2.7-11.7-6.4-16-11.1l-5.4,6.3c-0.6,1-1.3,1.8-2.2,2.6l-6.6,7.8c5,6.5,11.9,11.6,20.7,15.3c2.3-1.2,4.4-2.6,6.3-4.3c4.7-4,7.9-8.8,9.8-14.4C84.3,98.8,82.1,98.1,80,97.2z"/><path fill="${LOGO_NAVY}" d="M53.6,42.1c0,7.8,2.6,14.3,7.9,19.5c5.2,5.1,13.3,8.9,24.2,11.5c-1.3-2.9-3-5.5-5.3-7.8c-5.3-5.4-12.8-8.7-22.4-9.9L83.4,30V9.2c-6.9,1.5-12.7,4.1-17.5,7.9C57.7,23.4,53.6,31.8,53.6,42.1z"/></svg>`

// ── Files ───────────────────────────────────────────────────────────────────

// The id a card FILE is kept under. An invite's card is kept under the
// inviter's account (one card however often they rotate their code); its URL
// names the code, see mountOgCards.
function validId(kind, id) {
  if (kind === 'community') return COMMUNITY_RE.test(id)
  if (kind === 'user' || kind === 'badge' || kind === 'invite') return ACCOUNT_RE.test(id)
  if (kind === 'tag') return TAG_RE.test(id)
  if (kind === 'stream') return ROOM_RE.test(id)
  if (kind === 'playlist') return PLAYLIST_ID_RE.test(id)
  if (kind === 'audio') return AUDIO_ID_RE.test(id)
  if (kind === 'podcast') return PODCAST_ID_RE.test(id)
  if (kind === 'episode') return EPISODE_FILE_RE.test(id)
  return false
}

function cardPath(kind, id) {
  return path.join(CARD_DIR, kind, `${id}.jpg`)
}

/** Short version string of the card on disk (its mtime), or '' when there is none. */
function cardVersion(kind, id) {
  if (!validId(kind, id)) return ''
  try {
    return Math.floor(fs.statSync(cardPath(kind, id)).mtimeMs / 1000).toString(36)
  } catch (_) {
    return ''
  }
}

/**
 * Absolute URL of a card on `origin`, versioned when the file exists.
 * `urlId` is what the URL names when that is not the file's id (an invite
 * code; its card is kept under the inviter's account).
 */
function cardUrl(origin, kind, id, urlId = id) {
  const v = cardVersion(kind, id)
  return `${origin}/api/og-card/${kind}/${urlId}.jpg${v ? `?v=${v}` : ''}`
}

/** Write only when the bytes changed, so the mtime (and the URL) stays put otherwise. */
async function saveCard(kind, id, buf) {
  const file = cardPath(kind, id)
  try {
    const old = await fsp.readFile(file)
    if (old.equals(buf)) return false
  } catch (_) { /* no card yet */ }
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, buf)
  await fsp.rename(tmp, file)
  return true
}

// ── Fetching ────────────────────────────────────────────────────────────────

async function fetchBuf(url, ms = FETCH_TIMEOUT_MS) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) {
    const err = new Error(`${res.status} ${url}`)
    err.status = res.status
    throw err
  }
  return Buffer.from(await res.arrayBuffer())
}

/** A Hive RPC result; null when the thing does not exist; throws when every node failed. */
async function hiveCall(method, params) {
  let lastErr
  for (const api of HIVE_APIS) {
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`${api} ${res.status}`)
      const data = await res.json()
      if (data.error) {
        const msg = String(data.error.message || '') + JSON.stringify(data.error.data || '')
        // Same reading as og-server's isMissingError.
        if (/does not exist|not valid|unknown account/i.test(msg)) return null
        throw new Error(`${api} ${data.error.message}`)
      }
      return data.result === undefined ? null : data.result
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('hive unreachable')
}

const IMAGE_TYPES = [
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
]
function imageType(buf) {
  for (const [magic, type] of IMAGE_TYPES) {
    if (magic.every((b, i) => buf[i] === b)) return type
  }
  return null
}

/**
 * The picture as a square JPEG, through ffmpeg: the renderer reads only PNG,
 * JPEG and GIF, and most 3Speak thumbnails are WebP. Null when ffmpeg cannot
 * read it either (an SVG, a broken file).
 */
function squareJpeg(buf, size = 512) {
  const { spawn } = require('child_process')
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'pipe:0', '-frames:v', '1',
      '-vf', `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`,
      '-q:v', '3', '-f', 'mjpeg', 'pipe:1'])
    const out = []
    const timer = setTimeout(() => ff.kill('SIGKILL'), 15000)
    ff.stdout.on('data', (d) => out.push(d))
    ff.on('error', () => { clearTimeout(timer); resolve(null) })
    ff.on('close', (code) => {
      clearTimeout(timer)
      const jpg = Buffer.concat(out)
      resolve(code === 0 && jpg.length ? jpg : null)
    })
    // ffmpeg may stop reading early (it has its frame); that is not an error.
    ff.stdin.on('error', () => {})
    ff.stdin.end(buf)
  })
}

// A PNG or JPEG up to this size goes in as it is. Anything bigger, and every
// GIF (often animated, several hundred KB), is shrunk first: resvg took ~20 s
// on a 670 KB avatar GIF.
const DIRECT_MAX_BYTES = 300 * 1024

/** An image as a data URI the renderer can draw, or null. */
async function drawable(buf) {
  const type = imageType(buf)
  if (type && type !== 'image/gif' && buf.length <= DIRECT_MAX_BYTES) return `data:${type};base64,${buf.toString('base64')}`
  const jpg = await squareJpeg(buf)
  return jpg ? `data:image/jpeg;base64,${jpg.toString('base64')}` : null
}

/**
 * The account's Hive profile picture as a data URI, or null (no picture, or
 * one we cannot decode). Throws when every source timed out or could not be
 * reached: the card is then not drawn (and kept) with an initial in place of
 * a picture that exists, and the next request tries again.
 */
async function fetchAvatar(account) {
  let unreachable = false
  for (const base of AVATAR_SOURCES) {
    try {
      const buf = await fetchBuf(`${base}/${account}/avatar/large`, AVATAR_TIMEOUT_MS)
      if (crypto.createHash('sha256').update(buf).digest('hex') === DEFAULT_AVATAR_SHA256) return null
      // A WebP avatar goes through ffmpeg; an SVG one gets the initial.
      return await drawable(buf)
    } catch (err) {
      if (err.status === 404) return null
      // An HTTP answer says something about the picture; no answer says nothing.
      if (!err.status) unreachable = true
    }
  }
  if (unreachable) throw new Error(`avatar of ${account} unreachable`)
  return null
}

/**
 * A cover or thumbnail (a URL from someone's metadata) as a square JPEG data
 * URI, or null. Only PICTURE_HOSTS are fetched.
 */
async function fetchPicture(raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch (_) { return null }
  if (u.protocol !== 'https:' || !PICTURE_HOSTS.has(u.hostname)) return null
  const tries = []
  // images.hive.blog answers this box 403 for pictures it has not cached.
  if (IMG_LOOPBACK && u.hostname === 'images.hive.blog') tries.push(`${IMG_LOOPBACK}/h${u.pathname}${u.search}`)
  if (IMG_LOOPBACK && u.hostname === 'images.3speak.tv') tries.push(`${IMG_LOOPBACK}/a${u.pathname}?px=512`)
  tries.push(u.href)
  for (const url of tries) {
    try {
      const jpg = await squareJpeg(await fetchBuf(url))
      if (jpg) return `data:image/jpeg;base64,${jpg.toString('base64')}`
    } catch (_) { /* the next source */ }
  }
  return null
}

/**
 * An outside podcast's cover as a square JPEG data URI, or null. The checker
 * keeps the show's art behind its own address (routes/podcasts.js /art, a
 * signed token), so no podcast host is fetched from here.
 */
async function fetchPodcastArt(checkerUrl, art) {
  if (!art || !/^[A-Za-z0-9._-]{1,600}$/.test(String(art))) return null
  try {
    const jpg = await squareJpeg(await fetchBuf(`${checkerUrl}/podcasts/art/${art}/512.jpg`))
    return jpg ? `data:image/jpeg;base64,${jpg.toString('base64')}` : null
  } catch (_) {
    return null
  }
}

// ── Fonts and scripts ───────────────────────────────────────────────────────

const INTER_SUBSETS = ['latin', 'latin-ext', 'greek', 'greek-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese']
let engine = null

/** satori, resvg, jpeg-js and the Inter Tight files, loaded on the first render. */
function getEngine() {
  if (engine) return engine
  const opentype = require('opentype.js')
  const fontDir = path.join(path.dirname(require.resolve('@fontsource/inter-tight/package.json')), 'files')
  const fonts = []
  const parsed = []
  for (const weight of [500, 700, 800]) {
    for (const subset of INTER_SUBSETS) {
      const data = fs.readFileSync(path.join(fontDir, `inter-tight-${subset}-${weight}-normal.woff`))
      // One name per subset: satori keeps a single font per name and weight, so
      // same-named subsets would hide each other's letters. It falls back to
      // the other fonts for a glyph the first one lacks.
      fonts.push({ name: subset === 'latin' ? 'Inter Tight' : `Inter Tight ${subset}`, data, weight, style: 'normal' })
      if (weight === 800) parsed.push(opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length)))
    }
  }
  engine = {
    satori: require('satori').default,
    Resvg: require('@resvg/resvg-js').Resvg,
    jpeg: require('jpeg-js'),
    opentype,
    fonts,
    headlineFonts: parsed,
  }
  return engine
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const graphemes = (text) => Array.from(segmenter.segment(text), (s) => s.segment)

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u
const CJK_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\u30fc\uff01-\uff60\uffe0-\uffe6\u3200-\u32ff]+$/u
const MARK_RE = /\p{M}/gu
const JOINERS_RE = /[\ufe0e\ufe0f\u200d]/g

function interGlyph(cp) {
  for (const font of getEngine().headlineFonts) {
    const glyph = font.charToGlyph(String.fromCodePoint(cp))
    if (glyph && glyph.index > 0) return { glyph, font }
  }
  return null
}

/**
 * How one grapheme gets drawn: 'space', 'inter' (the banner font), 'emoji'
 * (a Twemoji picture), 'cjk' (a Noto Sans subset), or null when it cannot be.
 */
function classify(g) {
  if (/^\s+$/u.test(g)) return 'space'
  if (EMOJI_RE.test(g)) return 'emoji'
  // A pile of combining marks ("Zalgo" text) draws as a smear even when each
  // mark exists in the font.
  if ((g.match(MARK_RE) || []).length > 2) return null
  const cps = Array.from(g.replace(JOINERS_RE, ''), (c) => c.codePointAt(0))
  if (!cps.length) return 'space'
  if (cps.every((cp) => interGlyph(cp))) return 'inter'
  if (CJK_RE.test(g)) return 'cjk'
  return null
}

function emojiCode(g) {
  const s = g.includes('\u200d') ? g : g.replace(/\ufe0f/g, '')
  return Array.from(s, (c) => c.codePointAt(0).toString(16)).join('-')
}

// Small caches, both process-wide: the same few dozen emoji and CJK names
// come back every week.
const emojiCache = new Map()
async function emojiDataUri(g) {
  const code = emojiCode(g)
  if (emojiCache.has(code)) return emojiCache.get(code)
  let uri = null
  try {
    const svg = await fetchBuf(`${TWEMOJI}/${code}.svg`, 5000)
    uri = `data:image/svg+xml;base64,${svg.toString('base64')}`
  } catch (err) {
    if (err.status !== 404) throw err
  }
  if (emojiCache.size > 2000) emojiCache.clear()
  emojiCache.set(code, uri)
  return uri
}

function cjkFamily(text) {
  if (/\p{Script=Hangul}/u.test(text)) return 'Noto Sans KR'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'Noto Sans JP'
  return 'Noto Sans SC'
}

const cjkCache = new Map()
/** A Noto Sans subset with just these characters, as TrueType (what satori reads). */
async function cjkFont(chars) {
  const family = cjkFamily(chars)
  const text = Array.from(new Set(Array.from(chars))).sort().join('')
  const key = `${family}|${text}`
  if (cjkCache.has(key)) return cjkCache.get(key)
  // Without a browser User-Agent Google answers with TrueType URLs.
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@800&text=${encodeURIComponent(text)}`
  const css = (await fetchBuf(cssUrl, 5000)).toString('utf8')
  const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)
  if (!m) throw new Error('no truetype in Google Fonts answer')
  const data = await fetchBuf(m[1], 8000)
  const font = getEngine().opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length))
  const missing = Array.from(text).filter((c) => !/\s/.test(c) && font.charToGlyphIndex(c) <= 0)
  const value = missing.length ? null : { name: 'Noto Sans CJK', data, weight: 800, style: 'normal' }
  if (cjkCache.size > 500) cjkCache.clear()
  cjkCache.set(key, value)
  return value
}

/**
 * Whether `text` can be drawn, and what it needs: { ok, cjk: [font], text }.
 * Emoji that Twemoji does not have and scripts we have no font for make it
 * not drawable.
 */
async function prepareText(raw) {
  const text = String(raw || '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim()
  if (!text) return { ok: false }
  const gs = graphemes(text)
  const kinds = gs.map(classify)
  if (kinds.some((k) => k === null)) return { ok: false, text }
  // Something to read, not just emoji.
  if (!kinds.some((k) => k === 'inter' || k === 'cjk')) return { ok: false, text }
  for (let i = 0; i < gs.length; i++) {
    if (kinds[i] === 'emoji' && !(await emojiDataUri(gs[i]))) return { ok: false, text }
  }
  const cjkChars = gs.filter((g, i) => kinds[i] === 'cjk').join('')
  let cjk = []
  if (cjkChars) {
    const font = await cjkFont(cjkChars)
    if (!font) return { ok: false, text }
    cjk = [font]
  }
  return { ok: true, text, cjk }
}

// ── Layout ──────────────────────────────────────────────────────────────────

const TEXT_LEFT = 80
const TEXT_WIDTH = 590
const RING = { cx: 910, cy: 315, d: 380 }
// Largest first; big sizes may wrap onto 2 lines, small ones onto 3.
const SIZES = [104, 96, 88, 80, 72, 64, 58, 52, 46]
const TRACKING = -0.025

function graphemeWidth(g, size) {
  if (/^\s+$/u.test(g)) {
    const space = interGlyph(32)
    return space ? (space.glyph.advanceWidth / space.font.unitsPerEm) * size : size * 0.25
  }
  if (EMOJI_RE.test(g)) return size * 1.08
  const cps = Array.from(g.replace(JOINERS_RE, ''), (c) => c.codePointAt(0))
  let w = 0
  for (const cp of cps) {
    const hit = interGlyph(cp)
    if (hit) w += (hit.glyph.advanceWidth / hit.font.unitsPerEm) * size
    else if (!/\p{M}/u.test(String.fromCodePoint(cp))) w += size // CJK: full width
  }
  return w + TRACKING * size
}

const textWidth = (text, size) => graphemes(text).reduce((sum, g) => sum + graphemeWidth(g, size), 0)

/**
 * Greedy word wrap. A word longer than the line is broken between graphemes,
 * or, with `whole`, makes the wrap fail (null) so a smaller size is tried first.
 */
function wrap(text, size, width, whole = false) {
  const lines = []
  let line = ''
  const push = () => { if (line) lines.push(line); line = '' }
  for (const word of text.split(' ')) {
    const tryLine = line ? `${line} ${word}` : word
    if (textWidth(tryLine, size) <= width) { line = tryLine; continue }
    push()
    if (textWidth(word, size) <= width) { line = word; continue }
    if (whole) return null
    for (const g of graphemes(word)) {
      if (textWidth(line + g, size) > width) push()
      line += g
    }
  }
  push()
  return lines
}

/** The largest size the name fits at, as lines; the smallest size with an ellipsis when nothing fits. */
function fitHeadline(text, width = TEXT_WIDTH) {
  const maxLines = (size) => (size >= 80 ? 2 : 3)
  // Whole words first; a word is only broken when it fits at no size.
  for (const whole of [true, false]) {
    for (const size of SIZES) {
      const lines = wrap(text, size, width, whole)
      if (lines && lines.length <= maxLines(size)) return { size, lines }
    }
  }
  const size = SIZES[SIZES.length - 1]
  const lines = wrap(text, size, width).slice(0, 3)
  let last = lines[2]
  while (last && textWidth(`${last}…`, size) > width) last = graphemes(last).slice(0, -1).join('')
  lines[2] = `${(last || '').trimEnd()}…`
  return { size, lines }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const el = (type, style, children) => ({ type, props: { style, children } })

function initialOf(text) {
  const g = graphemes(String(text || '').replace(/^[@#]/, '')).find((x) => /[\p{L}\p{N}]/u.test(x))
  return g ? g.toUpperCase() : '3'
}

const BADGE = 96
const BADGE_AT = {
  x: RING.cx + (RING.d / 2) * 0.707 - BADGE / 2,
  y: RING.cy + (RING.d / 2) * 0.707 - BADGE / 2,
}
const ringBox = { position: 'absolute', left: RING.cx - RING.d / 2, top: RING.cy - RING.d / 2, width: RING.d, height: RING.d, borderRadius: RING.d / 2 }
// An album cover or a track's artwork is square: a rounded square in the
// ring's place, the 3S badge on its corner.
const SQUARE_RADIUS = 36
const squareBox = { ...ringBox, borderRadius: SQUARE_RADIUS }
const SQUARE_BADGE_AT = { x: RING.cx + RING.d / 2 - BADGE * 0.72, y: RING.cy + RING.d / 2 - BADGE * 0.72 }
const LIVE_RED = '#E32933'

/**
 * Everything that is the same on every card: the banner's gradients, the
 * frame's shadow, "3speak.tv". Drawn once per process and frame shape (the
 * blurred shadow alone costs resvg most of a second) and laid under each card
 * as a picture.
 */
function backdropTree(shape = 'ring') {
  const frame = shape === 'square' ? squareBox : ringBox
  const badge = shape === 'square' ? SQUARE_BADGE_AT : BADGE_AT
  return el('div', {
    width: W, height: H, display: 'flex', position: 'relative', fontFamily: 'Inter Tight', backgroundColor: NAVY,
    backgroundImage: [
      'radial-gradient(circle at 87% 12%, rgba(86,124,194,0.55) 0%, rgba(86,124,194,0) 40%)',
      'radial-gradient(circle at 62% 105%, rgba(150,52,112,0.55) 0%, rgba(150,52,112,0) 38%)',
      'linear-gradient(100deg, #131947 0%, #1b2259 35%, #29317c 70%, #2e397d 100%)',
    ].join(', '),
  }, [
    el('div', { position: 'absolute', left: TEXT_LEFT, top: 552, display: 'flex', fontSize: 30, fontWeight: 700, color: LAVENDER }, '3speak.tv'),
    el('div', { ...frame, display: 'flex', backgroundColor: '#262d71', boxShadow: '0 30px 70px rgba(5,8,30,0.45)' }),
    el('div', {
      position: 'absolute', left: badge.x, top: badge.y, width: BADGE, height: BADGE, borderRadius: BADGE / 2,
      display: 'flex', backgroundColor: LOGO_NAVY, boxShadow: '0 10px 24px rgba(5,8,30,0.4)',
    }),
  ])
}

/**
 * One piece of the subtitle: [text], [text, true] for bold white, or
 * [text, 'live'] for a red dot and the word in bold (a stream that is on air).
 */
function subtitlePart([text, style]) {
  // satori drops a space at the edge of a span: the gap is a no-break space.
  const t = text.replace(/^ | $/g, ' ')
  if (style === 'live') {
    return el('span', { display: 'flex', alignItems: 'center', fontWeight: 800, color: '#ffffff', marginRight: 18 }, [
      el('span', { width: 22, height: 22, borderRadius: 11, backgroundColor: LIVE_RED, marginRight: 12, display: 'flex' }),
      el('span', {}, t),
    ])
  }
  return el('span', style ? { fontWeight: 700, color: '#ffffff' } : {}, t)
}

function cardTree({ lines, size, subtitle, avatar, initial, backdrop, shape = 'ring' }) {
  const ringInner = RING.d - 6
  const radius = shape === 'square' ? SQUARE_RADIUS - 3 : ringInner / 2
  const frame = shape === 'square' ? squareBox : ringBox
  const badge = shape === 'square' ? SQUARE_BADGE_AT : BADGE_AT
  const picture = avatar
    ? { type: 'img', props: { src: avatar, width: ringInner, height: ringInner, style: { width: ringInner, height: ringInner, borderRadius: radius, objectFit: 'cover' } } }
    : el('div', {
      width: ringInner, height: ringInner, borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'linear-gradient(135deg, #3a46a8 0%, #262d71 100%)', color: '#ffffff', fontSize: 170, fontWeight: 800,
    }, initial)

  return el('div', { width: W, height: H, display: 'flex', position: 'relative', fontFamily: 'Inter Tight', backgroundColor: NAVY }, [
    { type: 'img', props: { src: backdrop, width: W, height: H, style: { position: 'absolute', left: 0, top: 0 } } },
    el('div', {
      // Centred on the ring (y 315), as the banner's text sits level with its logo.
      position: 'absolute', left: TEXT_LEFT, top: 70, width: TEXT_WIDTH + 20, height: 490,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }, [
      ...lines.map((line) => el('div', {
        display: 'flex', fontSize: size, fontWeight: 800, color: '#ffffff', lineHeight: 1.04,
        letterSpacing: `${TRACKING}em`, whiteSpace: 'nowrap',
      }, line)),
      el('div', { display: 'flex', alignItems: 'center', marginTop: Math.round(size * 0.32), fontSize: 40, fontWeight: 500, color: LAVENDER, whiteSpace: 'nowrap' },
        subtitle.map(subtitlePart)),
    ]),
    el('div', { ...frame, border: '3px solid rgba(255,255,255,0.22)', display: 'flex' }, [picture]),
    el('div', {
      position: 'absolute', left: badge.x, top: badge.y, width: BADGE, height: BADGE, borderRadius: BADGE / 2,
      backgroundColor: LOGO_NAVY, border: '4px solid #ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }, [{ type: 'img', props: { src: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`, width: 58, height: 50 } }]),
  ])
}

const backdrops = new Map()
async function getBackdrop(shape = 'ring') {
  if (backdrops.has(shape)) return backdrops.get(shape)
  const { satori, Resvg, fonts } = getEngine()
  const svg = await satori(backdropTree(shape), { width: W, height: H, fonts })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } }).render().asPng()
  const uri = `data:image/png;base64,${png.toString('base64')}`
  backdrops.set(shape, uri)
  return uri
}

/**
 * The card as a JPEG.
 * headline: what goes big; subtitle: [[text, style?], ...] (see subtitlePart);
 * avatar: data URI or null; cjk: fonts from prepareText; shape: 'ring' for a
 * person or a community, 'square' for a cover; initial: what an empty frame
 * shows (the headline's first letter by default).
 */
async function renderCard({ headline, subtitle, avatar, cjk = [], shape = 'ring', initial }) {
  const { satori, Resvg, jpeg, fonts } = getEngine()
  const { size, lines } = fitHeadline(headline)
  const backdrop = await getBackdrop(shape)
  const svg = await satori(cardTree({ lines, size, subtitle, avatar, initial: initial || initialOf(headline), backdrop, shape }), {
    width: W,
    height: H,
    // The same array every time: satori keeps parsed fonts per array, and
    // parsing all of them again costs most of a second.
    fonts: cjk.length ? [...fonts, ...cjk] : fonts,
    loadAdditionalAsset: async (code, segment) => (code === 'emoji' ? (await emojiDataUri(segment)) || '' : []),
  })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } }).render()
  return jpeg.encode({ data: png.pixels, width: png.width, height: png.height }, 86).data
}

// ── Cards ───────────────────────────────────────────────────────────────────

/** What a profile card says. Exported for the tests. */
async function profileText(account, displayName) {
  const name = String(displayName || '').trim()
  // No display name, the handle itself, or one we cannot draw: the @handle.
  // A name that only capitalises the handle ('MenO' for meno) is a name.
  if (name && name !== account && name !== `@${account}`) {
    const prepared = await prepareText(name)
    if (prepared.ok) {
      return { headline: prepared.text, subtitle: [[`@${account}`, true], [' on 3Speak']], cjk: prepared.cjk }
    }
  }
  return { headline: `@${account}`, subtitle: [['Channel', true], [' on 3Speak']], cjk: [] }
}

/** What a community card says. Exported for the tests. */
async function communityText(id, title) {
  const prepared = await prepareText(title)
  if (prepared.ok) return { headline: prepared.text, subtitle: [['Community', true], [' on 3Speak']], cjk: prepared.cjk }
  // A script we have no font for: leave out what cannot be drawn when what
  // stays is still the name (decoration around Latin letters), else the id.
  if (prepared.text) {
    const kept = graphemes(prepared.text).filter((g) => classify(g) !== null).join('').replace(/\s+/g, ' ').trim()
    const dropped = graphemes(prepared.text).filter((g) => classify(g) === null)
    if (!dropped.some((g) => /\p{L}/u.test(g))) {
      const again = await prepareText(kept)
      if (again.ok) return { headline: again.text, subtitle: [['Community', true], [' on 3Speak']], cjk: again.cjk }
    }
  }
  return { headline: id, subtitle: [['Community', true], [' on 3Speak']], cjk: [] }
}

/** `raw` when it can be drawn, else `fallback`: { headline, cjk }. */
async function drawnOr(raw, fallback) {
  const prepared = await prepareText(raw)
  return prepared.ok ? { headline: prepared.text, cjk: prepared.cjk } : { headline: fallback, cjk: [] }
}

/** What a badge card says (the badge's title, else its account). Exported for the tests. */
async function badgeText(account, title) {
  return { ...await drawnOr(title, account), subtitle: [['Badge', true], [' on 3Speak']] }
}

/** What a tag card says: the #tag, and a '#' in the empty frame. */
function tagText(tag) {
  return { headline: `#${tag}`, subtitle: [['Topic', true], [' on 3Speak']], cjk: [], initial: '#' }
}

/** What an invite card says, under the inviter's picture. Exported for the tests. */
function inviteText(account) {
  return { headline: 'Join me on 3Speak', subtitle: [[`@${account}`, true], [' invited you']], cjk: [] }
}

/** What a live room's card says: its title, who is on air. Exported for the tests. */
async function streamText(room) {
  const host = room.host
  const title = (room.post && room.post.title) || room.title
  const text = await drawnOr(title, `@${host} is live`)
  // A one-man stream (the studio, OBS) is "on air"; a conference room is a hangout.
  const subtitle = room.mode === 'standalone'
    ? [['LIVE', 'live'], [`@${host}`, true], [' on 3Speak']]
    : [[`@${host}`, true], ['’s room on 3Speak']]
  return { ...text, subtitle }
}

/** What a playlist or album card says. Exported for the tests. */
async function playlistText(card) {
  const what = card.album ? 'Album' : card.medium === 'podcast' ? 'Podcast' : 'Playlist'
  return { ...await drawnOr(card.name, `${what} by @${card.owner}`), subtitle: [[what, true], [' by '], [`@${card.owner}`, true]] }
}

/** What an audio post's card says. Exported for the tests. */
async function audioText(author, title, isSong) {
  return { ...await drawnOr(title, `@${author}`), subtitle: [[isSong ? 'Song' : 'Audio', true], [' by '], [`@${author}`, true]] }
}

const SUBTITLE_SIZE = 40

/**
 * A subtitle that fits beside the cover: the last bold piece (a show's name,
 * an author) loses letters, then gets an ellipsis, until the line fits.
 */
function fitSubtitle(parts) {
  const width = (ps) => ps.reduce((sum, [text]) => sum + textWidth(text, SUBTITLE_SIZE), 0)
  const out = parts.map((p) => [...p])
  const i = out.map((p) => p[1] === true).lastIndexOf(true)
  if (i < 0) return out
  let text = out[i][0]
  while (graphemes(text).length > 1 && width(out) > TEXT_WIDTH) {
    text = graphemes(text).slice(0, -1).join('').trimEnd()
    out[i][0] = `${text}…`
  }
  return out
}

/** A name for the subtitle as { text, cjk }: drawable, or null to leave it out. */
async function subtitleName(raw) {
  const prepared = await prepareText(String(raw || '').replace(/\s+/g, ' ').trim())
  return prepared.ok && prepared.text ? { text: prepared.text, cjk: prepared.cjk } : null
}

/** What an outside podcast's card says. Exported for the tests. */
async function podcastText(feed) {
  const author = await subtitleName(feed.author)
  const head = await drawnOr(feed.title, 'Podcast')
  return {
    headline: head.headline,
    cjk: [...head.cjk, ...(author ? author.cjk : [])],
    subtitle: fitSubtitle(author ? [['Podcast', true], [' by '], [author.text, true]] : [['Podcast', true], [' on 3Speak']]),
  }
}

/** What an episode's card says: its title, then the show (and the episode's number). Exported for the tests. */
async function episodeText(ep, feed) {
  const show = await subtitleName(feed && feed.title)
  const n = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const num = n(ep.episode) != null ? `${n(ep.season) != null ? `S${n(ep.season)} ` : ''}E${n(ep.episode)}` : ''
  const head = await drawnOr(ep.title, show ? show.text : 'Podcast episode')
  const line = (name) => (name ? [[num || 'Episode', true], [' of '], [name, true]] : [[num || 'Episode', true], [' on 3Speak']])
  let subtitle = fitSubtitle(line(show && show.text))
  // A long show name ("Podnews Daily - podcast industry news") that had to be
  // cut: its short form, the part before " - " or ":", when that fits whole.
  const short = show && show.text.split(/\s+[-\u2013\u2014|]\s+|:\s+/)[0].trim()
  if (show && subtitle[2][0] !== show.text && short && short !== show.text && graphemes(short).length >= 3) {
    const shorter = fitSubtitle(line(short))
    if (shorter[2][0] === short) subtitle = shorter
  }
  return { headline: head.headline, cjk: [...head.cjk, ...(show ? show.cjk : [])], subtitle }
}

async function checkerJson(checkerUrl, p) {
  const res = await fetch(`${checkerUrl}${p}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`checker ${res.status} ${p}`)
  return res.json()
}

/** The live room, or null when no hangouts server has it (it ended). */
async function fetchRoom(name) {
  let failed = null
  for (const api of HANGOUTS_APIS) {
    try {
      const res = await fetch(`${api}/rooms/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (res.ok) return await res.json()
      if (res.status !== 404) failed = new Error(`${api} ${res.status}`)
    } catch (err) {
      failed = err
    }
  }
  if (failed) throw failed
  return null
}

/** The audio doc behind a Hive post, found the way og-pages.cjs finds it. */
async function findAudioDoc(checkerUrl, author, permlink, post) {
  const owned = await checkerJson(checkerUrl, `/audio?owner=${encodeURIComponent(author)}&limit=100`)
  const list = (owned && owned.audio) || []
  const bare = (v) => String(v || '').split('/').pop()
  const doc = list.find((a) => bare(a.post_permlink) === permlink)
  if (doc) return doc
  const m = post && String(post.body || '').match(/audio\.3speak\.tv\/play\?a=([A-Za-z0-9_-]+)/)
  return (m && list.find((a) => a.permlink === m[1])) || null
}

async function isBanned(checkerUrl, account) {
  try {
    const res = await fetch(`${checkerUrl}/check/${encodeURIComponent(account)}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    const data = await res.json()
    return data && data.banned === true
  } catch (_) {
    return false
  }
}

/** The account's display name, or null when it does not exist or is banned. */
async function liveProfile(checkerUrl, account) {
  const [profile, banned] = await Promise.all([
    hiveCall('bridge.get_profile', { account, observer: '' }),
    isBanned(checkerUrl, account),
  ])
  if (!profile || !profile.name || banned) return null
  return ((profile.metadata && profile.metadata.profile) || {}).name || ''
}

/**
 * Draw one card. Returns the JPEG, or null when the thing does not exist (or
 * is not shown on 3Speak: a banned creator, a private playlist, a room that
 * ended). Throws when a lookup failed, so a slow node never deletes a card.
 */
async function buildCard(kind, id, { checkerUrl, community } = {}) {
  switch (kind) {
    case 'community': {
      const c = community || await hiveCall('bridge.get_community', { name: id, observer: '' })
      if (!c || !c.name) return null
      const text = await communityText(id, c.title || id)
      // A whole-community NSFW flag: its picture stays off the card.
      const avatar = c.is_nsfw ? null : await fetchAvatar(id)
      return renderCard({ ...text, avatar })
    }
    case 'user': {
      const name = await liveProfile(checkerUrl, id)
      if (name === null) return null
      return renderCard({ ...await profileText(id, name), avatar: await fetchAvatar(id) })
    }
    case 'invite': {
      // The code was checked by the route; the card is the inviter's.
      if (await liveProfile(checkerUrl, id) === null) return null
      return renderCard({ ...inviteText(id), avatar: await fetchAvatar(id) })
    }
    case 'badge': {
      // Any Hive account can be read as a badge (the badge page does the same).
      const badge = await checkerJson(checkerUrl, `/badges/${encodeURIComponent(id)}`)
      if (!badge || !badge.account) return null
      return renderCard({ ...await badgeText(id, badge.title), avatar: await fetchAvatar(id) })
    }
    case 'tag': {
      // Only a tag with videos: anything else would be a card for a 404 page.
      const list = await checkerJson(checkerUrl, `/videos/tag/${encodeURIComponent(id)}?page=1&limit=1&type=videos`)
      if (!list || !(Number(list.total) > 0 || (Array.isArray(list.videos) && list.videos.length))) return null
      return renderCard({ ...tagText(id), avatar: null })
    }
    case 'stream': {
      const room = await fetchRoom(id)
      if (!room || !room.host || !ACCOUNT_RE.test(room.host) || room.visibility === 'hive-internal') return null
      return renderCard({ ...await streamText(room), avatar: await fetchAvatar(room.host) })
    }
    case 'playlist': {
      // 404 for private playlists, Watch Later and banned owners.
      const card = await checkerJson(checkerUrl, `/rss/playlist/${encodeURIComponent(id)}/card.json`)
      if (!card || !card.owner || !card.name) return null
      const cover = await fetchPicture(card.cover)
      return renderCard({
        ...await playlistText(card),
        avatar: cover || await fetchAvatar(card.owner),
        shape: cover ? 'square' : 'ring',
      })
    }
    case 'audio': {
      const [author, permlink] = id.split('/')
      const post = await hiveCall('bridge.get_post', { author, permlink, observer: '' })
      if (!post || !post.author) return null
      const doc = await findAudioDoc(checkerUrl, author, permlink, post)
      if (doc && doc.status && doc.status !== 'published') return null
      // An album track is a Hive reply titled "RE: <album post>": the audio's own title first.
      const title = (doc && doc.title) || post.title
      const cover = await fetchPicture(doc && (doc.thumbnail_url || doc.playlist_thumbnail))
      return renderCard({
        ...await audioText(author, title, !!doc && doc.category === 'song'),
        avatar: cover || await fetchAvatar(author),
        shape: cover ? 'square' : 'ring',
      })
    }
    case 'podcast': {
      // 404 for a private feed or one nobody follows any more.
      const data = await checkerJson(checkerUrl, `/podcasts/feed/${id}?limit=1`)
      const feed = data && data.feed
      if (!feed || !feed.title || feed.private) return null
      const cover = await fetchPodcastArt(checkerUrl, feed.art)
      return renderCard({ ...await podcastText(feed), avatar: cover, shape: 'square', initial: initialOf(feed.title) })
    }
    case 'episode': {
      const data = await checkerJson(checkerUrl, `/podcasts/episode/${id.replace('_', ':')}`)
      const ep = data && data.episode
      if (!ep || !ep.title || ep.private) return null
      const cover = await fetchPodcastArt(checkerUrl, ep.art || (data.feed && data.feed.art))
      return renderCard({ ...await episodeText(ep, data.feed), avatar: cover, shape: 'square', initial: initialOf((data.feed && data.feed.title) || ep.title) })
    }
    default:
      return null
  }
}

// ── Concurrency ─────────────────────────────────────────────────────────────

function limiter(n) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= n || !queue.length) return
    active++
    const { fn, resolve, reject } = queue.shift()
    fn().then(resolve, reject).finally(() => { active--; next() })
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next() })
}

// ── Weekly sync ─────────────────────────────────────────────────────────────

const STATE_FILE = path.join(CARD_DIR, 'sync-state.json')

async function readState() {
  try { return JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')) } catch (_) { return {} }
}

async function writeState(state) {
  await fsp.mkdir(CARD_DIR, { recursive: true })
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

async function listCommunities() {
  const all = []
  let last = ''
  for (;;) {
    const page = await hiveCall('bridge.list_communities', { last, limit: 100, observer: '' })
    if (!Array.isArray(page) || !page.length) break
    all.push(...page)
    if (page.length < 100) break
    const next = page[page.length - 1].name
    if (next === last) break
    last = next
  }
  return all.filter((c) => c && COMMUNITY_RE.test(c.name))
}

/** The ids of the cards of one kind on disk (audio ids are `author/permlink`). */
async function cardIds(kind) {
  const base = path.join(CARD_DIR, kind)
  const jpgs = (dir) => fsp.readdir(dir).then((names) => names.filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)), () => [])
  if (kind !== 'audio') return jpgs(base)
  const authors = await fsp.readdir(base).catch(() => [])
  const ids = []
  for (const author of authors) ids.push(...(await jpgs(path.join(base, author))).map((p) => `${author}/${p}`))
  return ids
}

async function syncAll({ checkerUrl }) {
  const started = Date.now()
  const run = limiter(SYNC_CONCURRENCY)
  const tally = { communities: 0, users: 0, changed: 0, removed: 0, failed: 0 }

  const communities = await listCommunities()
  await Promise.all(communities.map((c) => run(async () => {
    try {
      const buf = await buildCard('community', c.name, { checkerUrl, community: c })
      if (buf && await saveCard('community', c.name, buf)) tally.changed++
      tally.communities++
    } catch (err) {
      tally.failed++
    }
  })))

  // Every other card someone asked for so far (profiles, badges, invites,
  // playlists, audio); one whose thing is gone, banned or private is deleted,
  // the URL then 404s like the page does.
  for (const kind of REDRAWN) {
    const ids = (await cardIds(kind)).filter((id) => validId(kind, id))
    await Promise.all(ids.map((id) => run(async () => {
      try {
        const buf = await buildCard(kind, id, { checkerUrl })
        if (!buf) {
          await fsp.unlink(cardPath(kind, id)).catch(() => {})
          tally.removed++
          return
        }
        if (await saveCard(kind, id, buf)) tally.changed++
        if (kind === 'user') tally.users++
        else tally.others = (tally.others || 0) + 1
      } catch (err) {
        tally.failed++
      }
    })))
  }

  // A stream's room is gone after it ends, so there is nothing to redraw;
  // its card goes once nobody is likely to unfurl the link again.
  for (const id of await cardIds('stream')) {
    const file = cardPath('stream', id)
    try {
      if (Date.now() - (await fsp.stat(file)).mtimeMs > STREAM_KEEP_MS) {
        await fsp.unlink(file)
        tally.removed++
      }
    } catch (_) { /* already gone */ }
  }

  const state = { lastRun: started, finished: Date.now(), ...tally }
  await writeState(state)
  console.log(`[og-cards] weekly sync: ${tally.communities} communities, ${tally.users} profiles, ${tally.others || 0} other cards, ${tally.changed} redrawn, ${tally.removed} removed, ${tally.failed} failed in ${Math.round((Date.now() - started) / 1000)}s`)
  return state
}

// ── Worker ──────────────────────────────────────────────────────────────────
// Drawing a card takes ~0.2 s of CPU, and this process signs every
// transaction on the site, so the drawing (and the weekly sync with its
// thousands of cards) runs on a worker thread. The worker starts on the first
// job and stops after five idle minutes, which gives back its ~250 MB.

const WORKER_IDLE_MS = 5 * 60 * 1000

function createWorkerClient() {
  const { Worker } = require('worker_threads')
  let worker = null
  let idleTimer = null
  let seq = 0
  const pending = new Map()

  const failAll = (err) => {
    for (const { reject } of pending.values()) reject(err)
    pending.clear()
  }

  function start() {
    const w = new Worker(__filename, { workerData: { ogCardWorker: true } })
    worker = w
    w.on('message', ({ seq: n, error, result }) => {
      const job = pending.get(n)
      if (!job) return
      pending.delete(n)
      if (error) job.reject(new Error(error))
      else job.resolve(result)
      if (!pending.size) {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => { if (!pending.size && worker) { worker.terminate(); worker = null } }, WORKER_IDLE_MS)
        idleTimer.unref()
      }
    })
    // An idle stop has already let go of `worker`; a crash fails what was waiting.
    w.on('error', (err) => { console.error('[og-cards] worker:', err.message) })
    w.on('exit', () => {
      if (worker !== w) return
      worker = null
      failAll(new Error('og-cards worker stopped'))
    })
    w.unref()
  }

  return function call(op, args) {
    if (!worker) start()
    clearTimeout(idleTimer)
    const n = ++seq
    return new Promise((resolve, reject) => {
      pending.set(n, { resolve, reject })
      worker.postMessage({ seq: n, op, args })
    })
  }
}

/** Inside the worker: draw (and save) one card, or run the weekly sync. */
function serveWorker() {
  const { parentPort } = require('worker_threads')
  const draw = limiter(RENDER_CONCURRENCY)
  parentPort.on('message', async ({ seq, op, args }) => {
    try {
      let result
      if (op === 'build') {
        result = await draw(async () => {
          const buf = await buildCard(args.kind, args.id, args)
          if (buf) await saveCard(args.kind, args.id, buf)
          return buf ? new Uint8Array(buf) : null
        })
      } else if (op === 'sync') {
        result = await syncAll(args)
      } else {
        throw new Error(`unknown op ${op}`)
      }
      parentPort.postMessage({ seq, result })
    } catch (err) {
      parentPort.postMessage({ seq, error: err.message || String(err) })
    }
  })
}

/** A card of an expiring kind that is older than its time, or not. */
async function expired(kind, id) {
  if (!EXPIRES_MS[kind]) return false
  try {
    return Date.now() - (await fsp.stat(cardPath(kind, id))).mtimeMs > EXPIRES_MS[kind]
  } catch (_) {
    return false
  }
}

/** Delete the expired cards of every expiring kind. Returns how many went. */
async function pruneExpired() {
  let removed = 0
  for (const kind of Object.keys(EXPIRES_MS)) {
    for (const id of await cardIds(kind)) {
      if (!(await expired(kind, id))) continue
      try { await fsp.unlink(cardPath(kind, id)); removed++ } catch (_) { /* already gone */ }
    }
  }
  return removed
}

function scheduleSync(call, opts) {
  let running = false
  const tick = async () => {
    // Every hour, whatever the weekly sync does: cheap, only file dates.
    await pruneExpired().catch((err) => console.error('[og-cards] prune failed:', err.message))
    if (running) return
    const state = await readState()
    if (state.lastRun && Date.now() - state.lastRun < SYNC_EVERY_MS) return
    running = true
    try {
      await call('sync', opts)
    } catch (err) {
      // Try again at the next hourly check rather than in a week.
      console.error('[og-cards] weekly sync failed:', err.message)
    } finally {
      running = false
    }
  }
  setTimeout(tick, SYNC_FIRST_DELAY_MS).unref()
  setInterval(tick, SYNC_CHECK_MS).unref()
}

// ── Route ───────────────────────────────────────────────────────────────────

/**
 * resolveInvite(code) -> the inviter's account, or null for a code that is not
 * a live 3Speak invite; throws when it could not be checked. The invite lookup
 * needs the butrauth client, which lives in the API, not in the worker.
 */
function mountOgCards(app, { checkerUrl = 'https://checker.3speak.tv', resolveInvite } = {}) {
  const call = createWorkerClient()
  const inFlight = new Map()
  const missing = new Map()

  const serve = async (req, res, kind, urlId) => {
    // A playlist id and an episode's hash keep their case; every other id is a Hive name.
    const asked = kind === 'playlist' || kind === 'episode' ? urlId : urlId.toLowerCase()
    if (!KINDS.has(kind)) return res.status(404).end()
    if (kind === 'invite' ? !INVITE_CODE_RE.test(asked) : !validId(kind, asked)) return res.status(404).end()
    const key = `${kind}/${asked}`
    // helmet says same-origin for the whole API; a share image is shown by
    // other sites' pages.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    const send = (buf) => {
      res.set('Content-Type', 'image/jpeg')
      // A versioned URL never changes; the bare one is redrawn within the week.
      res.set('Cache-Control', req.query.v ? 'public, max-age=604800' : 'public, max-age=86400')
      res.send(buf)
    }

    const gone = missing.get(key)
    if (gone && gone > Date.now()) return res.status(404).end()
    const notFound = () => {
      if (missing.size > 5000) missing.clear()
      missing.set(key, Date.now() + MISSING_TTL_MS)
      return res.status(404).end()
    }

    // An invite's card is its inviter's, and only while the code is live.
    let id = asked
    if (kind === 'invite') {
      try {
        id = resolveInvite ? await resolveInvite(asked) : null
      } catch (err) {
        console.error(`[og-cards] ${key}:`, err.message)
        res.set('Cache-Control', 'no-store')
        return res.redirect(302, '/og-image.jpg')
      }
      if (!id || !ACCOUNT_RE.test(id)) return notFound()
    }

    // Past its time (an outside podcast's, after 30 days): drawn again below.
    if (await expired(kind, id)) await fsp.unlink(cardPath(kind, id)).catch(() => {})
    try {
      return send(await fsp.readFile(cardPath(kind, id)))
    } catch (_) { /* not drawn yet */ }

    try {
      if (!inFlight.has(key)) {
        inFlight.set(key, call('build', { kind, id, checkerUrl }).finally(() => inFlight.delete(key)))
      }
      const buf = await inFlight.get(key)
      if (!buf) return notFound()
      return send(Buffer.from(buf))
    } catch (err) {
      // A lookup or the drawing failed: the general banner, uncached, so the
      // next fetch tries again.
      console.error(`[og-cards] ${key}:`, err.message)
      res.set('Cache-Control', 'no-store')
      return res.redirect(302, '/og-image.jpg')
    }
  }

  const jpgName = (file) => { const m = String(file).match(/^(.+)\.jpg$/); return m ? m[1] : '' }
  app.get('/api/og-card/:kind/:file', (req, res) => serve(req, res, req.params.kind, jpgName(req.params.file)))
  // An audio post is named by its author and permlink.
  app.get('/api/og-card/audio/:author/:file', (req, res) => serve(req, res, 'audio', `${req.params.author}/${jpgName(req.params.file)}`))

  if (process.env.OG_CARD_SYNC !== 'off') scheduleSync(call, { checkerUrl })
}

{
  const { isMainThread, workerData } = require('worker_threads')
  if (!isMainThread && workerData && workerData.ogCardWorker) serveWorker()
}

module.exports = {
  mountOgCards,
  cardUrl,
  cardVersion,
  // For the tests.
  buildCard,
  renderCard,
  profileText,
  communityText,
  badgeText,
  tagText,
  inviteText,
  streamText,
  playlistText,
  audioText,
  podcastText,
  episodeText,
  pruneExpired,
  fitSubtitle,
  prepareText,
  fitHeadline,
  syncAll,
  saveCard,
  CARD_DIR,
}
