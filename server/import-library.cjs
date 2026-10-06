// ── Import library: every video detail from every platform, kept forever ─────
// Owner's call 2026-10-05: when a creator opens a channel on /youtube-import, the
// whole channel is read ONCE (the first page right away, the rest in the
// background) and kept; after that the page only reads from here, no platform is
// asked again, and nothing is ever deleted. Updating channels is a later, separate
// step. Details found afterwards (a Rumble description, an Instagram caption, a
// pasted link) are merged into the same records.
//
// Mongo, database `threespeak` (same replica set as `import-batches`):
//   import-library   one doc per video, _id "<platform>:<id>":
//                    { platform, channelId, type, publishedAt, ev, firstSeenAt, updatedAt }
//                    `ev` is the platform's own shape, exactly what the importer's
//                    entry builders take.
//   import-channels  one doc per channel list, _id "<platform>:<channelId>:<type>":
//                    { status: loading|complete|failed, cursor, count, startedAt, completedAt }
// Not tied to preview/prod: the same channel is the same data everywhere.

const LIB = 'import-library'
const CHANNELS = 'import-channels'

function createLibrary({ uri, dbName }) {
  let db = null
  const ready = (async () => {
    if (!uri) { console.warn('[import-library] no Mongo configured: nothing is kept'); return false }
    try {
      const { MongoClient } = require('mongodb')
      const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 20000 })
      await client.connect()
      db = client.db(dbName || undefined)
      await db.collection(LIB).createIndex({ platform: 1, channelId: 1, type: 1, publishedAt: -1 }, { name: 'list' }).catch(() => {})
      const n = await db.collection(LIB).estimatedDocumentCount().catch(() => 0)
      console.log(`[import-library] ready (${n} videos kept)`)
      return true
    } catch (e) {
      console.error(`[import-library] Mongo unavailable, nothing is kept: ${e.message}`)
      return false
    }
  })()

  const isEmpty = (v) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)

  // Store videos; a field already kept is only overwritten by a non-empty value.
  async function putVideos(platform, channelId, type, evs, { idOf = (ev) => ev.id, dateOf, typeOf } = {}) {
    if (!(await ready) || !evs.length) return
    const now = new Date()
    const ids = evs.map((ev) => `${platform}:${idOf(ev)}`)
    const existing = new Map((await db.collection(LIB).find({ _id: { $in: ids } }).toArray()).map((d) => [d._id, d]))
    const ops = evs.map((ev, i) => {
      const prev = existing.get(ids[i])?.ev || {}
      const merged = { ...prev }
      for (const [k, v] of Object.entries(ev)) if (!isEmpty(v) || !(k in merged)) merged[k] = v
      const t = typeOf ? typeOf(ev) : type
      return {
        updateOne: {
          filter: { _id: ids[i] },
          update: {
            $set: {
              platform, ev: merged, updatedAt: now,
              ...(channelId ? { channelId } : {}),
              ...(t ? { type: t } : {}),
              ...(dateOf ? { publishedAt: dateOf(merged) || null } : {}),
            },
            $setOnInsert: { firstSeenAt: now },
          },
          upsert: true,
        },
      }
    })
    await db.collection(LIB).bulkWrite(ops, { ordered: false })
  }

  // Fields learned later for one video (description, caption, ...).
  async function patchVideo(platform, id, fields) {
    if (!(await ready)) return
    const $set = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(fields)) if (!isEmpty(v)) $set[`ev.${k}`] = v
    if (Object.keys($set).length > 1) await db.collection(LIB).updateOne({ _id: `${platform}:${id}` }, { $set })
  }

  async function getVideo(platform, id) {
    if (!(await ready)) return null
    return (await db.collection(LIB).findOne({ _id: `${platform}:${id}` }))?.ev || null
  }

  async function listVideos(platform, channelIds, type, page, pageSize) {
    if (!(await ready)) return { evs: [], total: 0 }
    const q = { platform, channelId: { $in: channelIds }, ...(type && type !== 'all' ? { type } : {}) }
    const col = db.collection(LIB)
    const [docs, total] = await Promise.all([
      col.find(q).sort({ publishedAt: -1, _id: 1 }).skip(page * pageSize).limit(pageSize).toArray(),
      col.countDocuments(q),
    ])
    return { evs: docs.map((d) => d.ev), total }
  }

  const channelKey = (platform, channelId, type) => `${platform}:${channelId}:${type || 'all'}`
  async function getChannel(platform, channelId, type) {
    if (!(await ready)) return null
    return db.collection(CHANNELS).findOne({ _id: channelKey(platform, channelId, type) })
  }
  async function setChannel(platform, channelId, type, fields) {
    if (!(await ready)) return
    await db.collection(CHANNELS).updateOne(
      { _id: channelKey(platform, channelId, type) },
      { $set: { platform, channelId, type: type || 'all', ...fields, updatedAt: new Date() }, $setOnInsert: { startedAt: new Date() } },
      { upsert: true },
    )
  }

  // Read a whole channel once: `fetchPage(cursor)` → { evs, next } (next = null at
  // the end). The first page is awaited (so the page has something to show); the
  // rest runs in the background, `gapMs` apart. A channel that is complete, or
  // being read right now, is never read again.
  const crawling = new Map()
  async function ensureChannel(platform, channelId, type, { fetchPage, gapMs = 1000, store }) {
    if (!(await ready)) return { kept: false }
    const key = channelKey(platform, channelId, type)
    if (crawling.has(key)) { await crawling.get(key).first; return { kept: true } }
    const doc = await getChannel(platform, channelId, type)
    if (doc && doc.status === 'complete') return { kept: true }
    let markFirst
    const first = new Promise((r) => { markFirst = r })
    const run = (async () => {
      let cursor = doc?.cursor ?? null
      let count = doc?.count || 0
      await setChannel(platform, channelId, type, { status: 'loading' })
      try {
        for (let n = 0; ; n++) {
          const { evs, next } = await fetchPage(cursor)
          await store(evs)
          count += evs.length
          cursor = next ?? null
          await setChannel(platform, channelId, type, { status: next == null ? 'complete' : 'loading', cursor, count, ...(next == null ? { completedAt: new Date() } : {}) })
          if (n === 0) markFirst()
          if (next == null) break
          await new Promise((r) => setTimeout(r, gapMs))
        }
        console.log(`[import-library] ${key}: complete, ${count} videos kept`)
      } catch (e) {
        await setChannel(platform, channelId, type, { status: 'failed', error: String(e.message).slice(0, 200) }).catch(() => {})
        console.warn(`[import-library] ${key}: stopped at ${count} videos (${e.message}); continues on the next visit`)
      } finally {
        markFirst()
        crawling.delete(key)
      }
    })()
    crawling.set(key, { first, run })
    await first
    return { kept: true }
  }
  const isLoading = (platform, channelId, type) => crawling.has(channelKey(platform, channelId, type))

  return { ready, putVideos, patchVideo, getVideo, listVideos, getChannel, ensureChannel, isLoading }
}

module.exports = { createLibrary }
