// ── Sitemaps: every watchable video, short and channel ──────────────────────
// sitemap.xml used to be a static index of two lists the OG sidecar built from
// the checker feeds. A feed stops after a few thousand videos, so search engines
// were told about ~3,600 of the ~120,000 that play. These lists come from Mongo
// instead, with the filters the feeds use (3speakchecks routes/feeds.js `/new`
// and utils/), and each video carries Google's video tags (thumbnail, player,
// duration), which is what gets a page into video results.
//
// Files, oldest first so a full file stays the same from day to day:
//   /sitemap.xml               the index (sitemap-static.xml stays a file in public/)
//   /sitemap-videos-N.xml      `videos`, the original upload path
//   /sitemap-uploads-N.xml     `embed-video` long-form
//   /sitemap-shorts-N.xml      `embed-video` shorts
//   /sitemap-channels.xml      everyone with at least one of the above
//
// nginx (outside git) maps those paths onto /api/sitemap/<name>.xml:
//   location = /sitemap.xml { proxy_set_header Host $host; proxy_pass http://127.0.0.1:4022/api/sitemap/index.xml; }
//   location ~ "^/sitemap-((videos|uploads|shorts)-[0-9]{1,4}|channels)\.xml$" {
//       proxy_set_header Host $host; proxy_pass http://127.0.0.1:4022/api/sitemap/$1.xml; }

const zlib = require('zlib')

const PAGE_SIZE = 10000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
// The feeds' own age bound (3speakchecks utils/feedAge.js): much of what is
// older no longer plays, and a dead page in the sitemap costs more than it adds.
const MAX_AGE_YEARS = 6
const PLAYER_ORIGIN = 'https://play.3speak.tv'
// Our own gateway: both Bunny IPFS zones answer 403 "Domain suspended" (2026-09-08).
const IPFS_GATEWAY = 'https://ipfs.3speak.tv'
const HOSTS = new Set(['3speak.tv', 'preview.3speak.tv'])

function ageCutoff() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - MAX_AGE_YEARS)
  return d
}

// Same conditions as the feeds. hiddenFromFeed is the creator saying "don't
// push this one", so it stays out of search engines' lists too.
function legacyMatch(hidden) {
  return {
    status: 'published',
    created: { $gte: ageCutoff() },
    video_v2: { $nin: [null, ''] },
    unavailable: { $ne: true },
    hiddenFromFeed: { $ne: true },
    banned: { $ne: true },
    isNsfwContent: { $ne: true },
    tags_v2: { $nin: ['nsfw'] },
    publishFailed: { $ne: true },
    owner: { $nin: hidden },
  }
}

function embedMatch(hidden, short) {
  return {
    status: 'published',
    short,
    createdAt: { $gte: ageCutoff() },
    manifest_cid: { $nin: [null, ''] },
    listed_on_3speak: true,
    hive_permlink: { $ne: null },
    hive_author: { $nin: [null, ...hidden] },
    unavailable: { $ne: true },
    hiddenFromFeed: { $ne: true },
    banned: { $ne: true },
    isNsfwContent: { $ne: true },
    hive_tags: { $nin: ['nsfw', 'NSFW'] },
  }
}

const LEGACY_FIELDS = { owner: 1, permlink: 1, title: 1, description: 1, thumbnail: 1, duration: 1, created: 1 }
const EMBED_FIELDS = {
  owner: 1, permlink: 1, hive_author: 1, hive_permlink: 1, hive_title: 1, hive_body: 1,
  thumbnail_url: 1, duration: 1, createdAt: 1, gated: 1,
}

// One entry per series: where it lives, how a doc becomes a page + a player.
const SERIES = {
  videos: {
    collection: 'videos',
    match: (hidden) => legacyMatch(hidden),
    sort: { created: 1 },
    fields: LEGACY_FIELDS,
    entry: (d) => ({
      path: `watch?v=${d.owner}/${d.permlink}`,
      player: `${d.owner}/${d.permlink}`,
      author: d.owner,
      title: d.title,
      body: d.description,
      thumbnail: d.thumbnail,
      duration: d.duration,
      date: d.created,
    }),
  },
  uploads: {
    collection: 'embed-video',
    match: (hidden) => embedMatch(hidden, false),
    sort: { createdAt: 1 },
    fields: EMBED_FIELDS,
    // Long-form plays at the Hive post's address, like the feeds link it.
    entry: (d) => ({
      path: `watch?v=${d.hive_author}/${d.hive_permlink}`,
      player: `${d.hive_author}/${d.hive_permlink}`,
      author: d.hive_author,
      title: d.hive_title,
      body: d.hive_body,
      thumbnail: d.thumbnail_url,
      duration: d.duration,
      date: d.createdAt,
      gated: d.gated === true || d.gated === 'true',
    }),
  },
  shorts: {
    collection: 'embed-video',
    match: (hidden) => embedMatch(hidden, true),
    sort: { createdAt: 1 },
    fields: EMBED_FIELDS,
    // Shorts are shared by their asset id, which is what /shorts resolves.
    entry: (d) => ({
      path: `shorts?v=${d.owner}/${d.permlink}`,
      player: `${d.owner}/${d.permlink}`,
      author: d.hive_author,
      title: d.hive_title,
      body: d.hive_body,
      thumbnail: d.thumbnail_url,
      duration: d.duration,
      date: d.createdAt,
      gated: d.gated === true || d.gated === 'true',
    }),
  },
}

// XML 1.0 has no place for control characters or lone surrogates; one in a
// title would make the whole file unreadable.
function xml(str) {
  return String(str == null ? '' : str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 3).trim()}...` : t
}

// Post markdown as one line of readable text.
function plainText(md, max) {
  return clip(String(md || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_>`~|]+/g, ' '), max)
}

// Shorts carry no title of their own (hive_title is null on nearly all of
// them); the first line of text in the post is the caption the creator wrote.
function firstLine(md) {
  for (const line of String(md || '').split('\n')) {
    const text = plainText(line, 100)
    if (text.length >= 3) return text
  }
  return ''
}

function thumbnailUrl(t) {
  const s = String(t || '').trim()
  if (/^ipfs:\/\/[A-Za-z0-9]{40,}$/.test(s)) return `${IPFS_GATEWAY}/ipfs/${s.slice(7)}`
  if (/^https:\/\/(hot)?ipfs-3speak(-1)?\.b-cdn\.net\/ipfs\//.test(s)) return s.replace(/^https:\/\/[^/]+/, IPFS_GATEWAY)
  if (/^https?:\/\/[^\s"'<>]+$/.test(s) && !s.includes('media.3speak.tv')) return s
  return null
}

function isoDay(d) {
  const t = d ? new Date(d) : null
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null
}

function isoTime(d) {
  const t = d ? new Date(d) : null
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().replace(/\.\d{3}Z$/, 'Z') : null
}

function urlEntry(base, e) {
  const loc = `${base}/${e.path}`
  const day = isoDay(e.date)
  const title = clip(e.title, 100) || firstLine(e.body)
  const thumb = thumbnailUrl(e.thumbnail)
  // Google requires a thumbnail, a title and a description for a video entry;
  // without them the page is still listed, just not as a video.
  let video = ''
  if (thumb && title) {
    const seconds = Math.round(Number(e.duration) || 0)
    const published = isoTime(e.date)
    video = '<video:video>'
      + `<video:thumbnail_loc>${xml(thumb)}</video:thumbnail_loc>`
      + `<video:title>${xml(title)}</video:title>`
      + `<video:description>${xml(plainText(e.body, 300) || title)}</video:description>`
      + `<video:player_loc>${xml(`${PLAYER_ORIGIN}/watch?v=${e.player}&mode=iframe`)}</video:player_loc>`
      + (seconds >= 1 && seconds <= 28800 ? `<video:duration>${seconds}</video:duration>` : '')
      + (published ? `<video:publication_date>${published}</video:publication_date>` : '')
      + (e.gated ? '<video:requires_subscription>yes</video:requires_subscription>' : '')
      + (e.author ? `<video:uploader info="${xml(`${base}/user/${e.author}`)}">@${xml(e.author)}</video:uploader>` : '')
      + '</video:video>'
  }
  return `  <url><loc>${xml(loc)}</loc>${day ? `<lastmod>${day}</lastmod>` : ''}${video}</url>`
}

function urlset(lines, withVideo) {
  const ns = withVideo ? ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"' : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${lines.join('\n')}\n</urlset>\n`
}

function mountSitemaps(app, { uri, dbName }) {
  let dbPromise = null
  function getDb() {
    if (!dbPromise) {
      const { MongoClient } = require('mongodb')
      const client = new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 20000 })
      dbPromise = client.connect().then(() => client.db(dbName || undefined))
      dbPromise.catch(() => { dbPromise = null })
    }
    return dbPromise
  }

  // Hidden creators (contentcreators.hidden), as the feeds drop them.
  async function hiddenCreators(db) {
    const rows = await db.collection('contentcreators')
      .find({ hidden: true }, { projection: { username: 1, _id: 0 } }).toArray()
    return rows.map((r) => String(r.username || '').toLowerCase()).filter(Boolean)
  }

  // One gzipped file per key: serve stale on a failed rebuild, and never build
  // the same file twice at once (crawlers fetch sitemaps in bursts).
  const cache = new Map()
  function cached(key, build) {
    const hit = cache.get(key)
    if (hit && hit.gz && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.gz)
    if (hit && hit.pending) return hit.gz ? Promise.resolve(hit.gz) : hit.pending
    const pending = build()
      .then((text) => {
        const gz = zlib.gzipSync(text)
        cache.set(key, { gz, at: Date.now() })
        return gz
      })
      .catch((err) => {
        if (hit && hit.gz) {
          cache.set(key, { gz: hit.gz, at: hit.at })
          return hit.gz
        }
        cache.delete(key)
        throw err
      })
    cache.set(key, { ...hit, pending })
    return pending
  }

  // How many files each series has, and when its newest video went up.
  let countsMemo = null
  async function seriesCounts() {
    if (countsMemo && Date.now() - countsMemo.at < CACHE_TTL_MS) return countsMemo.value
    const db = await getDb()
    const hidden = await hiddenCreators(db)
    const value = {}
    for (const [name, s] of Object.entries(SERIES)) {
      const col = db.collection(s.collection)
      const match = s.match(hidden)
      const dateField = Object.keys(s.sort)[0]
      const [count, newest] = await Promise.all([
        col.countDocuments(match),
        col.find(match, { projection: { [dateField]: 1 } }).sort({ [dateField]: -1 }).limit(1).next(),
      ])
      value[name] = { pages: Math.ceil(count / PAGE_SIZE), newest: newest && newest[dateField] }
    }
    countsMemo = { value, at: Date.now() }
    return value
  }

  async function buildIndex(base) {
    const counts = await seriesCounts()
    const today = isoDay(new Date())
    const maps = [
      { loc: `${base}/sitemap-static.xml` },
      { loc: `${base}/sitemap-channels.xml`, lastmod: today },
    ]
    for (const [name, { pages, newest }] of Object.entries(counts)) {
      for (let n = 1; n <= pages; n++) {
        // Only the last file of a series takes new videos.
        maps.push({ loc: `${base}/sitemap-${name}-${n}.xml`, lastmod: n === pages ? isoDay(newest) : null })
      }
    }
    const body = maps
      .map((m) => `  <sitemap><loc>${xml(m.loc)}</loc>${m.lastmod ? `<lastmod>${m.lastmod}</lastmod>` : ''}</sitemap>`)
      .join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`
  }

  async function buildPage(base, name, n) {
    const s = SERIES[name]
    const db = await getDb()
    const docs = await db.collection(s.collection)
      .find(s.match(await hiddenCreators(db)), { projection: s.fields })
      .sort(s.sort)
      .skip((n - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray()
    if (!docs.length) throw Object.assign(new Error('empty page'), { status: 404 })
    return urlset(docs.map((d) => urlEntry(base, s.entry(d))), true)
  }

  async function buildChannels(base) {
    const db = await getDb()
    const hidden = await hiddenCreators(db)
    const latest = new Map()
    const add = (rows) => {
      for (const r of rows) {
        const name = String(r._id || '').toLowerCase()
        if (!/^[a-z0-9.-]{3,16}$/.test(name)) continue
        const prev = latest.get(name)
        if (!prev || r.last > prev) latest.set(name, r.last)
      }
    }
    add(await db.collection('videos').aggregate([
      { $match: legacyMatch(hidden) },
      { $group: { _id: '$owner', last: { $max: '$created' } } },
    ]).toArray())
    add(await db.collection('embed-video').aggregate([
      { $match: { ...embedMatch(hidden, false), short: { $in: [true, false] } } },
      { $group: { _id: '$hive_author', last: { $max: '$createdAt' } } },
    ]).toArray())
    const lines = [...latest.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(0, 50000)
      .map(([name, last]) => {
        const day = isoDay(last)
        return `  <url><loc>${xml(`${base}/user/${name}`)}</loc>${day ? `<lastmod>${day}</lastmod>` : ''}</url>`
      })
    return urlset(lines, false)
  }

  app.get(/^\/api\/sitemap\/(index|channels|(videos|uploads|shorts)-(\d{1,4}))\.xml$/, async (req, res) => {
    // Absolute URLs for the host that asked (prod or preview), never a forged one.
    const host = HOSTS.has(req.hostname) ? req.hostname : '3speak.tv'
    const base = `https://${host}`
    const { 0: file, 1: series, 2: num } = req.params
    try {
      let gz
      if (file === 'index') {
        gz = await cached(`${host}:index`, () => buildIndex(base))
      } else if (file === 'channels') {
        gz = await cached(`${host}:channels`, () => buildChannels(base))
      } else {
        const n = Number(num)
        const { pages } = (await seriesCounts())[series]
        if (n < 1 || n > pages) return res.status(404).type('text/plain').send('No such sitemap')
        gz = await cached(`${host}:${file}`, () => buildPage(base, series, n))
      }
      res.set('Content-Type', 'application/xml; charset=utf-8')
      res.set('Cache-Control', 'public, max-age=3600')
      res.set('Vary', 'Accept-Encoding')
      if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
        res.set('Content-Encoding', 'gzip')
        return res.send(gz)
      }
      return res.send(zlib.gunzipSync(gz))
    } catch (err) {
      if (err.status === 404) return res.status(404).type('text/plain').send('No such sitemap')
      console.error('[sitemap]', file, err.message)
      return res.status(503).set('Retry-After', '300').type('text/plain').send('Sitemap unavailable')
    }
  })
}

module.exports = { mountSitemaps }
