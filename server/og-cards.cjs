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
const KINDS = new Set(['community', 'user'])
const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/
const COMMUNITY_RE = /^hive-\d{1,10}$/
const HIVE_APIS = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://techcoderx.com']
// The loopback side of the /img/ cache (nginx conf.d/3speak-img.conf): it
// follows Hive's avatar redirect. images.hive.blog itself answers this box 403
// for pictures it has not cached yet, so it is only the second choice.
const AVATAR_SOURCES = (process.env.OG_CARD_AVATAR_BASES || 'http://127.0.0.1:8095/u,https://images.hive.blog/u')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
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

function validId(kind, id) {
  if (kind === 'community') return COMMUNITY_RE.test(id)
  if (kind === 'user') return ACCOUNT_RE.test(id)
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

/** Absolute URL of a card on `origin`, versioned when the file exists. */
function cardUrl(origin, kind, id) {
  const v = cardVersion(kind, id)
  return `${origin}/api/og-card/${kind}/${id}.jpg${v ? `?v=${v}` : ''}`
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

/** The account's Hive profile picture as a data URI, or null (no picture, or one we cannot decode). */
async function fetchAvatar(account) {
  for (const base of AVATAR_SOURCES) {
    try {
      const buf = await fetchBuf(`${base}/${account}/avatar/large`)
      // WebP and SVG avatars are rare; the renderer cannot decode them, so they
      // get the initial instead of an empty ring.
      const type = imageType(buf)
      if (crypto.createHash('sha256').update(buf).digest('hex') === DEFAULT_AVATAR_SHA256) return null
      return type ? `data:${type};base64,${buf.toString('base64')}` : null
    } catch (err) {
      if (err.status === 404) return null
    }
  }
  return null
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

/**
 * Everything that is the same on every card: the banner's gradients, the
 * ring's shadow, "3speak.tv". Drawn once per process (the blurred shadow alone
 * costs resvg most of a second) and laid under each card as a picture.
 */
function backdropTree() {
  return el('div', {
    width: W, height: H, display: 'flex', position: 'relative', fontFamily: 'Inter Tight', backgroundColor: NAVY,
    backgroundImage: [
      'radial-gradient(circle at 87% 12%, rgba(86,124,194,0.55) 0%, rgba(86,124,194,0) 40%)',
      'radial-gradient(circle at 62% 105%, rgba(150,52,112,0.55) 0%, rgba(150,52,112,0) 38%)',
      'linear-gradient(100deg, #131947 0%, #1b2259 35%, #29317c 70%, #2e397d 100%)',
    ].join(', '),
  }, [
    el('div', { position: 'absolute', left: TEXT_LEFT, top: 552, display: 'flex', fontSize: 30, fontWeight: 700, color: LAVENDER }, '3speak.tv'),
    el('div', { ...ringBox, display: 'flex', backgroundColor: '#262d71', boxShadow: '0 30px 70px rgba(5,8,30,0.45)' }),
    el('div', {
      position: 'absolute', left: BADGE_AT.x, top: BADGE_AT.y, width: BADGE, height: BADGE, borderRadius: BADGE / 2,
      display: 'flex', backgroundColor: LOGO_NAVY, boxShadow: '0 10px 24px rgba(5,8,30,0.4)',
    }),
  ])
}

function cardTree({ lines, size, subtitle, avatar, initial, backdrop }) {
  const ringInner = RING.d - 6
  const picture = avatar
    ? { type: 'img', props: { src: avatar, width: ringInner, height: ringInner, style: { width: ringInner, height: ringInner, borderRadius: ringInner / 2, objectFit: 'cover' } } }
    : el('div', {
      width: ringInner, height: ringInner, borderRadius: ringInner / 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
      el('div', { display: 'flex', marginTop: Math.round(size * 0.32), fontSize: 40, fontWeight: 500, color: LAVENDER, whiteSpace: 'nowrap' },
        // satori drops a space at the edge of a span: the gap is a no-break space.
        subtitle.map(([text, strong]) => el('span', strong ? { fontWeight: 700, color: '#ffffff' } : {}, text.replace(/^ | $/g, '\u00a0')))),
    ]),
    el('div', { ...ringBox, border: '3px solid rgba(255,255,255,0.22)', display: 'flex' }, [picture]),
    el('div', {
      position: 'absolute', left: BADGE_AT.x, top: BADGE_AT.y, width: BADGE, height: BADGE, borderRadius: BADGE / 2,
      backgroundColor: LOGO_NAVY, border: '4px solid #ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }, [{ type: 'img', props: { src: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`, width: 58, height: 50 } }]),
  ])
}

let backdropUri = null
async function getBackdrop() {
  if (backdropUri) return backdropUri
  const { satori, Resvg, fonts } = getEngine()
  const svg = await satori(backdropTree(), { width: W, height: H, fonts })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } }).render().asPng()
  backdropUri = `data:image/png;base64,${png.toString('base64')}`
  return backdropUri
}

/**
 * The card as a JPEG.
 * headline: what goes big; subtitle: [[text, strong?], ...]; avatar: data URI or null;
 * cjk: fonts from prepareText.
 */
async function renderCard({ headline, subtitle, avatar, cjk = [] }) {
  const { satori, Resvg, jpeg, fonts } = getEngine()
  const { size, lines } = fitHeadline(headline)
  const backdrop = await getBackdrop()
  const svg = await satori(cardTree({ lines, size, subtitle, avatar, initial: initialOf(headline), backdrop }), {
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

/**
 * Draw one card. Returns the JPEG, or null when the account or community does
 * not exist (or the creator is banned: their channel shows nothing). Throws when
 * a lookup failed, so a slow node never deletes a card.
 */
async function buildCard(kind, id, { checkerUrl, community } = {}) {
  if (kind === 'community') {
    const c = community || await hiveCall('bridge.get_community', { name: id, observer: '' })
    if (!c || !c.name) return null
    const text = await communityText(id, c.title || id)
    // A whole-community NSFW flag: its picture stays off the card.
    const avatar = c.is_nsfw ? null : await fetchAvatar(id)
    return renderCard({ ...text, avatar })
  }
  const [profile, banned] = await Promise.all([
    hiveCall('bridge.get_profile', { account: id, observer: '' }),
    isBanned(checkerUrl, id),
  ])
  if (!profile || !profile.name || banned) return null
  const p = (profile.metadata && profile.metadata.profile) || {}
  const text = await profileText(id, p.name)
  return renderCard({ ...text, avatar: await fetchAvatar(id) })
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

  // Every profile card someone asked for so far; one whose account is gone or
  // banned is deleted, the URL then 404s like the profile does.
  let users = []
  try {
    users = (await fsp.readdir(path.join(CARD_DIR, 'user')))
      .filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).filter((a) => ACCOUNT_RE.test(a))
  } catch (_) { /* none yet */ }
  await Promise.all(users.map((account) => run(async () => {
    try {
      const buf = await buildCard('user', account, { checkerUrl })
      if (!buf) {
        await fsp.unlink(cardPath('user', account)).catch(() => {})
        tally.removed++
        return
      }
      if (await saveCard('user', account, buf)) tally.changed++
      tally.users++
    } catch (err) {
      tally.failed++
    }
  })))

  const state = { lastRun: started, finished: Date.now(), ...tally }
  await writeState(state)
  console.log(`[og-cards] weekly sync: ${tally.communities} communities, ${tally.users} profiles, ${tally.changed} redrawn, ${tally.removed} removed, ${tally.failed} failed in ${Math.round((Date.now() - started) / 1000)}s`)
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

function scheduleSync(call, opts) {
  let running = false
  const tick = async () => {
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

function mountOgCards(app, { checkerUrl = 'https://checker.3speak.tv' } = {}) {
  const call = createWorkerClient()
  const inFlight = new Map()
  const missing = new Map()

  app.get('/api/og-card/:kind/:file', async (req, res) => {
    const { kind, file } = req.params
    const m = String(file).match(/^(.+)\.jpg$/)
    const id = m ? m[1].toLowerCase() : ''
    if (!KINDS.has(kind) || !validId(kind, id)) return res.status(404).end()
    const key = `${kind}/${id}`
    // helmet says same-origin for the whole API; a share image is shown by
    // other sites' pages.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    const send = (buf) => {
      res.set('Content-Type', 'image/jpeg')
      // A versioned URL never changes; the bare one is redrawn within the week.
      res.set('Cache-Control', req.query.v ? 'public, max-age=604800' : 'public, max-age=86400')
      res.send(buf)
    }

    try {
      return send(await fsp.readFile(cardPath(kind, id)))
    } catch (_) { /* not drawn yet */ }

    const gone = missing.get(key)
    if (gone && gone > Date.now()) return res.status(404).end()

    try {
      if (!inFlight.has(key)) {
        inFlight.set(key, call('build', { kind, id, checkerUrl }).finally(() => inFlight.delete(key)))
      }
      const buf = await inFlight.get(key)
      if (!buf) {
        if (missing.size > 5000) missing.clear()
        missing.set(key, Date.now() + MISSING_TTL_MS)
        return res.status(404).end()
      }
      return send(Buffer.from(buf))
    } catch (err) {
      // A lookup or the drawing failed: the general banner, uncached, so the
      // next fetch tries again.
      console.error(`[og-cards] ${key}:`, err.message)
      res.set('Cache-Control', 'no-store')
      return res.redirect(302, '/og-image.jpg')
    }
  })

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
  prepareText,
  fitHeadline,
  syncAll,
  saveCard,
  CARD_DIR,
}
