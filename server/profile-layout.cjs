// 🧩 Profile layouts: the order and settings of the sections on a channel's
// Overview tab (videos, shorts, audio, playlists, community posts, ...).
//
// One Mongo doc per creator in `profile_layouts`, `_id` = lowercased username.
// No doc = the built-in default order, which the site knows on its own.
//
// Reads are public and served from an in-memory cache (every profile visit asks,
// and layouts change rarely). The owner's save replaces the cached copy at once,
// so the next visitor sees the new layout without waiting out the TTL.
//
// Writes are owner-locked from a VERIFIED identity only (butrauth session, the
// wallet session cookie, or a HiveSigner token). The page says which account it
// is signed in as; that claim only picks among identities already proven.
//
// The layout is rebuilt field by field before it is stored: whitelisted section
// types, clamped numbers, short plain-text titles. Nothing else gets through.

const COLLECTION = 'profile_layouts'
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 5000
const MAX_SECTIONS = 30
const MAX_PLAYLIST_SECTIONS = 10
const USER_RE = /^[a-z][a-z0-9.-]{2,15}$/

// Must stay in step with SECTION_DEFS in src/lib/profileLayout.js.
// count: [min, max]; `multi` types may appear more than once.
const TYPES = {
  trailer: { size: ['sm', 'md', 'lg', 'full'], flags: ['showInfo', 'showSnap'] },
  live: {},
  videos: { count: [1, 20], view: true, title: true },
  shorts: { count: [1, 20], view: true, title: true },
  audio: { count: [1, 40], view: true, title: true },
  audioPlaylists: { count: [1, 24], view: true, title: true },
  community: { count: [1, 20], view: true, title: true },
  playlistRails: { count: [1, 20], view: true, playlists: [1, 10] },
  playlist: { count: [1, 20], view: true, title: true, playlistId: true, multi: true },
  playlists: { count: [1, 50], view: true, title: true },
  links: { side: true },
}

const clampInt = (v, [min, max]) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

// Plain text only: React escapes it anyway, but nothing that looks like markup
// or a control character needs to be stored in the first place.
const cleanTitle = (v) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f<>]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60)

function sanitizeSections(input) {
  if (!Array.isArray(input)) return null
  const out = []
  const seenTypes = new Set()
  const seenIds = new Set()
  let playlistSections = 0
  for (const raw of input.slice(0, MAX_SECTIONS * 2)) {
    if (!raw || typeof raw !== 'object') continue
    const type = String(raw.type || '')
    const def = Object.prototype.hasOwnProperty.call(TYPES, type) ? TYPES[type] : null
    if (!def) continue
    if (!def.multi && seenTypes.has(type)) continue
    if (type === 'playlist' && ++playlistSections > MAX_PLAYLIST_SECTIONS) continue

    let id = String(raw.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24)
    if (!id || seenIds.has(id)) id = `${type.toLowerCase()}-${out.length}`
    const s = { id, type, hidden: raw.hidden === true }

    if (def.count && raw.count != null) {
      const c = clampInt(raw.count, def.count)
      if (c != null) s.count = c
    }
    if (def.view && (raw.view === 'row' || raw.view === 'grid')) s.view = raw.view
    if (def.title) {
      const t = cleanTitle(raw.title)
      if (t) s.title = t
    }
    if (def.playlists && raw.playlists != null) {
      const p = clampInt(raw.playlists, def.playlists)
      if (p != null) s.playlists = p
    }
    if (def.playlistId) {
      const pid = String(raw.playlistId || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)
      if (!pid) continue // a playlist section without a playlist shows nothing
      s.playlistId = pid
    }
    // left/right = a sticky column beside the Overview; none = in the grid.
    if (def.side && ['left', 'right', 'none'].includes(raw.side)) s.side = raw.side
    if (def.size && def.size.includes(raw.size)) s.size = raw.size
    for (const f of def.flags || []) if (typeof raw[f] === 'boolean') s[f] = raw[f]
    // Stacked under the previous section, in its column.
    if (raw.stack === true) s.stack = true
    // Width in grid columns (3-12).
    if (raw.span != null) {
      const sp = clampInt(raw.span, [3, 12])
      if (sp != null && sp !== 12) s.span = sp
    }

    seenTypes.add(type)
    seenIds.add(s.id)
    out.push(s)
    if (out.length >= MAX_SECTIONS) break
  }
  return out
}

// The phone layout: one column, so only order, visibility and the per-section
// settings count. Entries must name sections of the desktop layout (content
// such as a playlist's id comes from there); the links page has no place on
// phones. null = phones follow the desktop order.
const MOBILE_DROP = ['span', 'stack', 'side', 'size', 'showSnap']
function sanitizeMobile(input, sections) {
  if (!Array.isArray(input)) return null
  const byId = new Map(sections.map((s) => [s.id, s]))
  const clean = sanitizeSections(input.filter((m) => m && byId.has(m.id) && byId.get(m.id).type === m.type)) || []
  return clean
    .filter((m) => m.type !== 'links' && byId.has(m.id))
    .map((m) => {
      const out = { ...m }
      for (const k of MOBILE_DROP) delete out[k]
      return out
    })
}

function mountProfileLayout(app, { uri, dbName, resolveOwner, limiter }) {
  if (!uri) console.warn('[profile-layout] MONGODB_URI is not set: layouts will answer 503')

  let dbPromise = null
  function getCollection() {
    if (!uri) return Promise.reject(new Error('MONGODB_URI is not set'))
    if (!dbPromise) {
      const { MongoClient } = require('mongodb')
      const client = new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 8000 })
      dbPromise = client.connect().then(() => client.db(dbName || undefined))
      dbPromise.catch(() => { dbPromise = null })
    }
    return dbPromise.then((db) => db.collection(COLLECTION))
  }

  // user -> { layout|null, at }. `null` is cached too: most creators never
  // customise, and they are the bulk of the reads.
  const cache = new Map()
  const remember = (user, layout) => {
    cache.delete(user)
    cache.set(user, { layout, at: Date.now() })
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  }

  const toPublic = (doc) => (doc
    ? { sections: doc.sections || [], mobile: doc.mobile || null, updatedAt: doc.updatedAt || null }
    : null)

  app.get('/api/profile-layout/:user', limiter, async (req, res) => {
    const user = String(req.params.user || '').toLowerCase().replace(/^@/, '')
    if (!USER_RE.test(user)) return res.status(400).json({ error: 'Invalid username' })
    res.set('Cache-Control', 'no-cache')
    const hit = cache.get(user)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.json({ layout: hit.layout })
    try {
      const col = await getCollection()
      const doc = await col.findOne({ _id: user })
      const layout = toPublic(doc)
      remember(user, layout)
      res.json({ layout })
    } catch (err) {
      // A stale copy beats the default order while Mongo is away.
      if (hit) return res.json({ layout: hit.layout })
      console.error('[profile-layout] read failed:', err.message)
      res.status(503).json({ error: 'Unavailable' })
    }
  })

  app.put('/api/profile-layout', limiter, async (req, res) => {
    const owner = await resolveOwner(req, res, req.body?.user)
    if (!owner) return res.status(401).json({ error: 'sign-in-needed' })
    const sections = sanitizeSections(req.body?.sections)
    if (!sections) return res.status(400).json({ error: 'sections must be an array' })
    const mobile = sanitizeMobile(req.body?.mobile, sections)
    try {
      const col = await getCollection()
      const updatedAt = new Date()
      await col.updateOne(
        { _id: owner },
        mobile
          ? { $set: { sections, mobile, updatedAt } }
          : { $set: { sections, updatedAt }, $unset: { mobile: '' } },
        { upsert: true },
      )
      const layout = { sections, mobile, updatedAt }
      remember(owner, layout)
      res.json({ layout })
    } catch (err) {
      console.error('[profile-layout] save failed:', err.message)
      res.status(503).json({ error: 'Unavailable' })
    }
  })

  // Back to the built-in default.
  app.delete('/api/profile-layout', limiter, async (req, res) => {
    const owner = await resolveOwner(req, res, req.body?.user || req.query?.user)
    if (!owner) return res.status(401).json({ error: 'sign-in-needed' })
    try {
      const col = await getCollection()
      await col.deleteOne({ _id: owner })
      remember(owner, null)
      res.json({ layout: null })
    } catch (err) {
      console.error('[profile-layout] reset failed:', err.message)
      res.status(503).json({ error: 'Unavailable' })
    }
  })
}

module.exports = { mountProfileLayout, sanitizeSections, sanitizeMobile }
