// ── 🔁 Automatic podcast import ──────────────────────────────────────────────
// A creator switches it on for one of their verified podcast feeds (the Podcast
// tab of /import) with the post settings it should use: where the title
// comes from, tags, show notes or a fixed text, an addendum, the kind of audio,
// community, rewards, beneficiaries, NSFW, blog, ads. From then on, every
// AUTO_INTERVAL_MIN this server looks at the feed (through the checker, which
// re-reads it, see GET /podcasts/verified there) and queues each NEW episode as a
// one-item batch (import-batch.cjs): download, audio service, audio post, a
// scheduled-posts slot as @threespeak, spaced like every other import.
//
// "New" = not in the feed when the switch went on (`baseline`, the episode ids
// then), published no earlier than a few hours before it (a host re-issuing its
// whole back catalogue under new ids must not flood the channel), not already on
// 3Speak or in a batch, and never handled before. At most AUTO_MAX_PER_DAY per
// show a day; the rest wait for the next day. Episodes over the import limit are
// skipped and named in the status.
//
// Settings live in Mongo `import-auto` (next to `import-batches`), one document
// per environment, creator and feed, so preview and prod never both post. No
// Mongo configured = a JSON file.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const INTERVAL_MIN = Math.max(5, Number(process.env.IMPORT_AUTO_INTERVAL_MIN) || 15)
const MAX_PER_DAY = Math.max(1, Number(process.env.IMPORT_AUTO_MAX_PER_DAY) || 5)
const ENABLED = process.env.IMPORT_AUTO_ENABLED !== 'false'
// An episode dated a little before the switch went on still counts: hosts set
// the date when the episode was made, and feeds update a while later.
const GRACE_MS = 6 * 3600 * 1000
const BASELINE_MAX = 500
const HANDLED_MAX = 500
// A queued episode whose import failed for a reason that may pass (the checker or
// the audio service busy, a broken download) is queued again, this many times in
// all. Anything else (too long, no audio in the file, cancelled) stays handled.
const MAX_ATTEMPTS = 3
const RETRYABLE = new Set(['download_failed', 'upload_failed', 'audio_service'])
const MONGO_URI = process.env.IMPORT_BATCH_MONGODB_URI || process.env.MONGODB_URI || ''
const MONGO_DB = process.env.IMPORT_BATCH_DATABASE_NAME || process.env.DATABASE_NAME || ''
const ENV = process.env.IMPORT_BATCH_ENV || 'preview'
const STORE_FILE = process.env.IMPORT_AUTO_STORE || path.join(__dirname, 'data', 'import-auto.json')

const TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/
const TEMPLATE_MAX = 200
const ADDENDUM_MAX = 2000
const TEXT_MAX = 4000
const DEFAULT_SETTINGS = { type: 'podcast', target: 'post', fromSource: true, titleTemplate: '{title}', useNotes: true, addendum: '', text: '', tags: [], hashtags: true }

const feedKey = (url) => crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16)

// ── Store ────────────────────────────────────────────────────────────────────
// The store could not be opened (Mongo down at start): every read and write says
// so with this, which the routes answer as 503 and the check logs and skips.
const unavailableError = () => Object.assign(new Error('Automatic imports are not available right now'), { status: 503, code: 'unavailable' })

/**
 * `connect` (tests) stands in for the Mongo connection: () → collection.
 * A failed start never rejects `ready` (an unhandled rejection would take the
 * whole server down): it resolves false, and the store stays unavailable until
 * a restart, like the batch store (import-batch.cjs load).
 */
function createStore({ connect } = {}) {
  let col = null
  let file = { configs: [] }
  const ready = (async () => {
    if (connect) { col = await connect(); return true }
    let MongoClient = null
    try { ({ MongoClient } = require('mongodb')) } catch { /* file store */ }
    if (MONGO_URI && MongoClient) {
      const client = new MongoClient(MONGO_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 20000 })
      await client.connect()
      col = client.db(MONGO_DB || undefined).collection('import-auto')
      await col.createIndex({ env: 1, user: 1 }, { name: 'env_user' }).catch(() => {})
      return true
    }
    try { file = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) || { configs: [] } } catch { file = { configs: [] } }
    return true
  })().catch((e) => {
    console.error(`[import-auto] could not open the store, automatic imports are OFF until a restart: ${e.message}`)
    return false
  })
  const open = async () => { if (!(await ready)) throw unavailableError() }
  const writeFile = () => {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    const tmp = `${STORE_FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(file, null, 1))
    fs.renameSync(tmp, STORE_FILE)
  }
  return {
    ready,
    async list(filter = {}) {
      await open()
      if (col) return col.find({ env: ENV, ...filter }).toArray()
      return file.configs.filter((c) => c.env === ENV && Object.entries(filter).every(([k, v]) => c[k] === v))
    },
    async get(id) {
      await open()
      if (col) return col.findOne({ _id: id })
      return file.configs.find((c) => c._id === id) || null
    },
    async put(doc) {
      await open()
      const next = { ...doc, env: ENV, updatedAt: new Date().toISOString() }
      if (col) { await col.replaceOne({ _id: next._id }, next, { upsert: true }); return next }
      file.configs = [...file.configs.filter((c) => c._id !== next._id), next]
      writeFile()
      return next
    },
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────
/**
 * The creator's post settings, checked and trimmed: { settings } | { error }.
 * `fromSource`: title, description and tags come from each episode as it is (the
 * other fields are kept for when it is switched off again, but not used).
 * Shared with the batch form (import-batch.cjs parseOptions).
 */
function parseSettings(raw, audioTypes) {
  const o = raw || {}
  const type = audioTypes.has(o.type) ? o.type : 'podcast'
  const fromSource = o.fromSource === true
  // 'post': a standalone post in the community; 'snap': a reply in the snaps feed.
  const target = o.target === 'snap' ? 'snap' : 'post'
  const titleTemplate = String(o.titleTemplate ?? '{title}').replace(/[\r\n]+/g, ' ').trim().slice(0, TEMPLATE_MAX) || '{title}'
  const useNotes = o.useNotes !== false
  const addendum = String(o.addendum || '').trim().slice(0, ADDENDUM_MAX)
  const text = String(o.text || '').trim().slice(0, TEXT_MAX)
  if (!fromSource && !useNotes && !text) return { error: 'Write the description to use, or use the show notes' }
  const tags = []
  for (const t of Array.isArray(o.tags) ? o.tags : String(o.tags || '').split(/[\s,]+/)) {
    const clean = String(t || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '').slice(0, 24)
    if (TAG_RE.test(clean) && !tags.includes(clean)) tags.push(clean)
    if (tags.length >= 8) break
  }
  return { settings: { type, target, fromSource, titleTemplate, useNotes, addendum, text, tags, hashtags: o.hashtags !== false } }
}

function publicConfig(c) {
  return {
    feedUrl: c.feedUrl,
    feedId: c.feedId || null,
    feedTitle: c.feedTitle || '',
    enabled: !!c.enabled,
    enabledAt: c.enabledAt || null,
    // The episodes that were in the feed when it was switched on (never imported):
    // the page marks the others as coming automatically.
    baseline: c.enabled ? (c.baseline || []) : [],
    // Episodes it took up and will not post (skipped, or failed for good): the
    // page lets the creator import those by hand.
    failed: c.enabled ? (c.handled || []).filter((h) => h.skipped || h.failed).map((h) => h.id) : [],
    settings: c.settings,
    options: {
      community: c.options.community, payout: c.options.payout, nsfw: c.options.nsfw, ads: c.options.ads,
      reblog: c.options.reblog, beneficiaries: (c.options.beneficiaries || []).map((b) => ({ account: b.account, percent: b.weight / 100 })),
    },
    status: c.status || {},
  }
}

// ── Mount ────────────────────────────────────────────────────────────────────
/**
 * deps: auth, mw, verifiedPodcasts(user) → [{ url, feed?, code? }],
 *   feedEpisodes(feedId, limit) → [episode] (newest first), rssSourceOf(feed, ep) → batch source,
 *   hasPostingGrant(user), knownImports(user), batch: { ready, enqueue, parseOptions, outcomeOf },
 *   audioReady() → bool, maxDurationS, alert(...), connectStore? (tests: the Mongo stand-in)
 */
function mountImportAuto(app, deps) {
  const { auth, mw } = deps
  const store = createStore({ connect: deps.connectStore })
  const available = () => ENABLED && deps.audioReady()

  const ownShow = async (user, feedUrl) => {
    const shows = await deps.verifiedPodcasts(user)
    return shows.find((s) => s.url === feedUrl) || null
  }

  app.get('/api/yt-import/auto', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    try {
      const configs = await store.list({ user })
      res.json({ available: available(), intervalMin: INTERVAL_MIN, maxPerDay: MAX_PER_DAY, configs: configs.map(publicConfig) })
    } catch (e) {
      console.warn('[import-auto] list:', e.message)
      res.status(e.status || 500).json(e.status ? { error: e.message, errorCode: e.code } : { error: 'Something went wrong' })
    }
  })

  // Save a show's settings and switch it on or off. Switching on takes the
  // episodes in the feed right now as the ones that are never imported.
  app.put('/api/yt-import/auto', ...mw, async (req, res) => {
    const user = await auth(req, res); if (!user) return
    if (!available()) return res.status(503).json({ error: 'Automatic imports are not available on this server yet', errorCode: 'unavailable' })
    try {
      const body = req.body || {}
      const feedUrl = String(body.feedUrl || '')
      const show = feedUrl ? await ownShow(user, feedUrl) : null
      if (!show) return res.status(403).json({ error: 'Link and verify this podcast feed on your profile first', errorCode: 'no_link' })
      if (!show.feed) return res.status(409).json({ error: 'Your podcast feed cannot be read right now', errorCode: show.code || 'unreadable' })
      const parsedSettings = parseSettings(body.settings, deps.audioTypes)
      if (parsedSettings.error) return res.status(400).json({ error: parsedSettings.error, errorCode: 'bad_settings' })
      const parsedOptions = await deps.batch.parseOptions(user, body.options)
      if (parsedOptions.error) return res.status(400).json({ error: parsedOptions.error, errorCode: 'bad_options' })
      const enabled = body.enabled === true
      if (enabled && !(await deps.hasPostingGrant(user))) return res.status(403).json({ error: 'Allow 3Speak to publish for you first', errorCode: 'no_grant' })

      const id = `${ENV}|${user}|${feedKey(feedUrl)}`
      const prev = await store.get(id)
      const doc = {
        _id: id, user, feedUrl, feedId: show.feed.id, feedTitle: show.feed.title || '',
        settings: parsedSettings.settings, options: parsedOptions.options,
        enabled, enabledAt: prev?.enabledAt || null, baseline: prev?.baseline || [], handled: prev?.handled || [], retries: prev?.retries || {},
        status: prev?.status || {}, createdAt: prev?.createdAt || new Date().toISOString(),
      }
      if (enabled && !prev?.enabled) {
        // From now on: everything already in the feed stays where it is.
        const eps = await deps.feedEpisodes(show.feed.id, 200)
        doc.enabledAt = new Date().toISOString()
        doc.baseline = eps.map((e) => deps.rssSourceOf(show.feed, e).sourceId).slice(0, BASELINE_MAX)
        doc.handled = []
        doc.retries = {}
        doc.status = { ...doc.status, lastError: null, lastErrorCode: null }
        console.log(`[import-auto] @${user} switched ON for ${feedUrl} (${doc.baseline.length} episodes already there)`)
      } else if (!enabled && prev?.enabled) {
        doc.enabledAt = null
        console.log(`[import-auto] @${user} switched OFF for ${feedUrl}`)
      }
      const saved = await store.put(doc)
      res.json({ config: publicConfig(saved) })
    } catch (e) {
      console.warn('[import-auto] save:', e.message)
      res.status(e.status || 500).json(e.status ? { error: e.message, errorCode: e.code } : { error: 'Something went wrong' })
    }
  })

  // ── The check ──────────────────────────────────────────────────────────────
  async function checkOne(c, showsOf) {
    const now = Date.now()
    const status = { ...(c.status || {}), lastCheckAt: new Date(now).toISOString(), lastError: null, lastErrorCode: null }
    const setError = (code, message) => { status.lastErrorCode = code; status.lastError = message }
    try {
      const show = (await showsOf(c.user)).find((s) => s.url === c.feedUrl)
      if (!show) setError('no_link', 'This feed is no longer verified on your profile')
      else if (!show.feed) setError(show.code || 'unreadable', 'Your podcast feed cannot be read right now')
      else if (!(await deps.hasPostingGrant(c.user))) setError('no_grant', '3Speak may no longer publish for you')
      else {
        c.feedId = show.feed.id
        c.feedTitle = show.feed.title || c.feedTitle
        const eps = await deps.feedEpisodes(show.feed.id, 30)
        const known = await deps.knownImports(c.user).catch(() => ({ imported: {}, inBatch: {} }))
        // How the episodes queued before ended up: a failure that may pass goes
        // again (below, like a new one), anything else that failed stays handled.
        // `c.retries`: id → { attempts, h } of those waiting for another go.
        const retries = { ...(c.retries || {}) }
        c.handled = (c.handled || []).flatMap((h) => {
          if (h.skipped || h.failed) return [h]
          const out = deps.batch.outcomeOf ? deps.batch.outcomeOf(c.user, h.id) : null
          if (out?.status === 'cancelled') return [{ ...h, failed: 'cancelled' }]
          if (out?.status !== 'failed') return [h]
          const attempts = h.attempts || 1
          if (RETRYABLE.has(out.errorCode) && attempts < MAX_ATTEMPTS) {
            retries[h.id] = { attempts, h: { ...h, failed: out.errorCode } }
            return []
          }
          return [{ ...h, failed: out.errorCode || 'failed' }]
        })
        c.retries = retries
        const baseline = new Set(c.baseline || [])
        const handled = new Set((c.handled || []).map((h) => h.id))
        const since = Date.parse(c.enabledAt) - GRACE_MS
        const today = (c.handled || []).filter((h) => !h.skipped && now - Date.parse(h.at) < 24 * 3600 * 1000).length
        const fresh = eps
          .map((ep) => ({ ep, src: deps.rssSourceOf(show.feed, ep) }))
          .filter(({ src }) => !baseline.has(src.sourceId) && !handled.has(src.sourceId) && !known.imported[src.sourceId] && !known.inBatch[src.sourceId])
          .filter(({ ep }) => {
            const at = Date.parse(ep.published_at)
            // Undated episodes: the baseline alone decides. Future ones wait for their date.
            return !Number.isFinite(at) || (at >= since && at <= now + 5 * 60 * 1000)
          })
          .reverse() // oldest first: they go out in the order the show published them
        const take = []
        const handledNow = []
        for (const { ep, src } of fresh) {
          if (deps.maxDurationS && Number(ep.duration) > deps.maxDurationS) {
            handledNow.push({ id: src.sourceId, at: new Date(now).toISOString(), skipped: 'too_long', title: src.title })
            continue
          }
          if (today + take.length >= MAX_PER_DAY) continue // next day
          take.push(src)
          const again = retries[src.sourceId]
          delete retries[src.sourceId]
          handledNow.push({ id: src.sourceId, at: new Date(now).toISOString(), title: src.title, ...(again ? { attempts: again.attempts + 1 } : {}) })
        }
        status.waiting = fresh.length - handledNow.length
        // A failure to retry that is no longer among the newest episodes: given up.
        const seen = new Set(fresh.map(({ src }) => src.sourceId))
        for (const [id, r] of Object.entries(retries)) {
          if (!seen.has(id)) { handledNow.push(r.h); delete retries[id] }
        }
        if (take.length) {
          const batch = deps.batch.enqueue(c.user, take, { ...c.options, audio: c.settings }, { auto: true, autoFeed: c.feedUrl })
          status.lastQueuedAt = new Date(now).toISOString()
          status.lastBatchId = batch.id
          status.queued = (status.queued || 0) + take.length
          console.log(`[import-auto] @${c.user} ${take.length} new episode(s) of ${c.feedUrl} queued`)
        }
        const skipped = handledNow.filter((h) => h.skipped)
        if (skipped.length) status.lastSkipped = skipped.map((h) => ({ title: h.title, reason: h.skipped }))
        c.handled = [...handledNow, ...(c.handled || [])].slice(0, HANDLED_MAX)
      }
    } catch (e) {
      setError(e.code || 'check_failed', 'The feed could not be checked this time')
      console.warn(`[import-auto] @${c.user} ${c.feedUrl}: ${e.message}`)
    }
    c.status = status
    // Only what this check changed, on top of what is stored now: a save from
    // the page in the meantime (new settings, switched off) wins.
    const current = await store.get(c._id)
    if (!current || !current.enabled || current.enabledAt !== c.enabledAt) return
    await store.put({ ...current, feedId: c.feedId, feedTitle: c.feedTitle, handled: c.handled, retries: c.retries || {}, status })
  }

  let checking = false
  async function checkAll() {
    if (checking || !available()) return
    if (!(await deps.batch.ready) || !(await store.ready)) return
    checking = true
    try {
      const configs = (await store.list({ enabled: true }))
      // One verified-shows read per creator per round (it also refreshes the feed).
      const cache = new Map()
      const showsOf = (user) => {
        if (!cache.has(user)) cache.set(user, deps.verifiedPodcasts(user).catch((e) => { cache.delete(user); throw e }))
        return cache.get(user)
      }
      for (const c of configs) {
        await checkOne(c, showsOf)
        await new Promise((r) => setTimeout(r, 1000))
      }
    } catch (e) {
      console.warn('[import-auto] round:', e.message)
    } finally {
      checking = false
    }
  }

  if (ENABLED) {
    // Never an unhandled rejection from a tick: it would take the server down.
    const tick = () => checkAll().catch((e) => console.warn('[import-auto] tick:', e.message))
    setTimeout(tick, 2 * 60 * 1000).unref()
    setInterval(tick, INTERVAL_MIN * 60 * 1000).unref()
    console.log(`[import-auto] automatic podcast imports: every ${INTERVAL_MIN} min, at most ${MAX_PER_DAY} per show a day${deps.audioReady() ? '' : ' (waiting for AUDIO_API_KEY)'}`)
  }
  return { checkAll, store }
}

module.exports = { mountImportAuto, createStore, parseSettings, publicConfig, DEFAULT_SETTINGS, MAX_ATTEMPTS }
