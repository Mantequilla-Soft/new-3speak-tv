// ── BitChute + Rumble readers for the importer (youtube-import.cjs) ───────────
// BitChute: its web app's public JSON API (api.bitchute.com/api/beta), works from
//   this server directly. Channel list = POST channel/videos (paged), one video =
//   POST video (names its channel by channel_id), the file = POST video/media
//   (a direct MP4 on BitChute's CDN).
// Rumble: no API. Pages are behind Cloudflare, which refuses this server and
//   challenges some home IPs ("Just a moment..."), so pages are read through the
//   residential proxy, another exit IP per attempt. A channel's video pages carry
//   every video as JSON (<script type="application/json">: title, date, length,
//   cover, owner, and direct MP4 links per resolution on Rumble's CDN, which this
//   server can download from without the proxy). A single video page carries the
//   owner link and og:title / og:description; its file links come from the
//   owner's channel listing.

const fs = require('fs')
const path = require('path')
const https = require('https')
const { HttpsProxyAgent } = require('https-proxy-agent')

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const PAGE_SIZE = 25

// ── BitChute ─────────────────────────────────────────────────────────────────
const BITCHUTE_API = 'https://api.bitchute.com/api/beta'
const BITCHUTE_VIDEO_RE = /bitchute\.com\/(?:video|embed)\/([A-Za-z0-9_-]{6,20})/i
const BITCHUTE_CHANNEL_RE = /^[A-Za-z0-9_-]{6,40}$/

async function bitchuteApi(endpoint, body) {
  const r = await fetch(`${BITCHUTE_API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': BROWSER_UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (r.status === 404) return null
  if (!r.ok) throw Object.assign(new Error('BitChute is not answering right now'), { status: 502 })
  return r.json()
}

// "2:44:52" / "0:16" → seconds
function hmsToSeconds(s) {
  return String(s || '').split(':').map(Number).reduce((acc, n) => (Number.isFinite(n) ? acc * 60 + n : acc), 0)
}

function bitchuteShape(v, channelId) {
  let tags = []
  try { tags = Array.isArray(v.hashtags) ? v.hashtags : JSON.parse(v.hashtags || '[]') } catch { /* none */ }
  return {
    id: v.video_id,
    channelId: channelId || v.channel?.channel_id || '',
    channelName: v.channel?.channel_name || '',
    title: String(v.video_name || ''),
    description: String(v.description || ''),
    tags: tags.filter((t) => typeof t === 'string'),
    createTime: Date.parse(v.date_published) || 0,
    cover: v.thumbnail_url || '',
    width: 0,
    height: 0,
    duration: hmsToSeconds(v.duration),
    isShort: false,
    live: v.state_id === 'live',
    url: `https://www.bitchute.com/video/${v.video_id}/`,
  }
}

async function bitchuteChannelVideos(channelId, page = 0) {
  const d = await bitchuteApi('channel/videos', { channel_id: channelId, offset: page * PAGE_SIZE, limit: PAGE_SIZE })
  const list = (d?.videos || []).filter((v) => v.video_id && v.state_id === 'published')
  return { videos: list.map((v) => bitchuteShape(v, channelId)), hasMore: (d?.videos || []).length >= PAGE_SIZE }
}

async function bitchuteVideo(videoId) {
  const v = await bitchuteApi('video', { video_id: videoId })
  return v?.video_id ? bitchuteShape(v) : null
}

async function bitchuteMediaUrl(videoId) {
  const d = await bitchuteApi('video/media', { video_id: videoId })
  return d?.media_url || ''
}

// ── Rumble ───────────────────────────────────────────────────────────────────
const RUMBLE_VIDEO_RE = /rumble\.com\/(v[a-z0-9]{3,15})(?:-[^/?#]*)?(?:\.html)?/i
const RUMBLE_CHANNEL_RE = /^(c|user)\/[a-z0-9_.-]{1,80}$/

// Every Rumble answer (parsed, not the 400 KB page) is KEPT on disk, one file per
// channel page / video, and survives restarts (owner's call 2026-10-05: reading
// Rumble is slow through the proxy). A stored answer is served at once; once it is
// older than its refresh age it is read again in the background for next time.
// Owner's call 2026-10-05: never re-read. Channel updates will be a separate step.
const RUMBLE_REFRESH_MS = { channel: Infinity, video: Infinity }

function createRumble({ proxyForAttempt, scrub, attempts = 8, storeDir = path.join(__dirname, 'data', 'rumble-cache') }) {
  const cache = new Map() // url → { at, body }
  const stored = new Map() // key → { at, value }
  const refreshing = new Map() // key → promise
  try {
    fs.mkdirSync(storeDir, { recursive: true })
    for (const f of fs.readdirSync(storeDir)) {
      if (!f.endsWith('.json')) continue
      try { stored.set(decodeURIComponent(f.slice(0, -5)), JSON.parse(fs.readFileSync(path.join(storeDir, f), 'utf8'))) } catch { /* skip broken */ }
    }
  } catch (e) { console.warn(`[yt-import] rumble store unavailable: ${e.message}`) }
  function remember(key, value) {
    const entry = { at: Date.now(), value }
    stored.set(key, entry)
    try {
      const file = path.join(storeDir, `${encodeURIComponent(key)}.json`)
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(entry))
      fs.renameSync(`${file}.tmp`, file)
    } catch (e) { console.warn(`[yt-import] rumble store write failed: ${e.message}`) }
  }
  // Stored answer now (refreshing it in the background when old); a first read waits.
  function storedOrFetch(key, refreshMs, fetcher) {
    const run = () => {
      if (!refreshing.has(key)) {
        const p = fetcher().then((v) => { if (v) remember(key, v); return v }).finally(() => refreshing.delete(key))
        refreshing.set(key, p)
      }
      return refreshing.get(key)
    }
    const hit = stored.get(key)
    if (!hit) return run()
    if (Date.now() - hit.at > refreshMs) run().catch((e) => console.warn(`[yt-import] rumble refresh of ${key} failed: ${scrub(e.message)}`))
    return Promise.resolve(hit.value)
  }

  function getVia(url, proxy, cookie = '') {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        agent: proxy ? new HttpsProxyAgent(proxy) : undefined,
        headers: {
          'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(new Error('too large')) })
        res.on('end', () => resolve({
          status: res.statusCode, body, location: res.headers.location || '',
          cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]),
        }))
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', reject)
    })
  }

  // One page through the proxy, another exit IP whenever Cloudflare challenges one.
  async function getPage(url, ttlMs) {
    const hit = cache.get(url)
    if (hit && Date.now() - hit.at < ttlMs) return hit.body
    for (let i = 1; i <= attempts; i++) {
      let r
      try {
        // Rumble redirects to its own spelling of a channel name (and drops
        // ?page=1): follow up to 3 hops on the same exit IP.
        // Cookies set on a redirect (Cloudflare's among them) go along on the next
        // hop, as a browser would send them; without them a 307 just repeats.
        const proxy = proxyForAttempt()
        const jar = new Map()
        let target = url
        r = await getVia(target, proxy)
        for (let hop = 0; hop < 3 && [301, 302, 307, 308].includes(r.status) && r.location; hop++) {
          for (const c of r.cookies) { const i = c.indexOf('='); if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1)) }
          target = new URL(r.location, target).href
          if (!/^https:\/\/(www\.)?rumble\.com\//.test(target)) break
          r = await getVia(target, proxy, [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
        }
      } catch (e) {
        console.warn(`[yt-import] rumble attempt ${i} for ${url.replace(/^https:\/\/rumble\.com/, '')} failed: ${scrub(e.message)}`)
        continue
      }
      if (r.status === 404) return null
      if (r.status !== 200) console.warn(`[yt-import] rumble attempt ${i} for ${url.replace(/^https:\/\/rumble\.com/, '')}: HTTP ${r.status}`)
      if (r.status === 200) {
        cache.set(url, { at: Date.now(), body: r.body })
        if (cache.size > 300) cache.delete(cache.keys().next().value)
        return r.body
      }
    }
    throw Object.assign(new Error('Rumble is not answering right now, try again in a minute'), { status: 502 })
  }

  const decode = (s) => String(s || '')
    .replace(/&apos;|&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

  // Every video object in the page's JSON blobs.
  function videosInPage(html) {
    const out = []
    const walk = (o) => {
      if (Array.isArray(o)) { for (const x of o) walk(x); return }
      if (!o || typeof o !== 'object') return
      if (o.object_type === 'video' && o.permalink_id && Array.isArray(o.videos)) out.push(o)
      for (const v of Object.values(o)) walk(v)
    }
    for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try { walk(JSON.parse(m[1])) } catch { /* not ours */ }
    }
    return out
  }

  const channelOf = (by) => {
    const m = String(by?.url || by?.relative_url || '').match(/\/(c|user)\/([^/?#]+)/i)
    return m ? `${m[1].toLowerCase()}/${m[2].toLowerCase()}` : ''
  }

  function rumbleShape(o) {
    return {
      id: o.permalink_id,
      channelId: channelOf(o.by),
      channelName: o.by?.title || o.by?.name || '',
      title: decode(o.title),
      description: '',
      tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string') : [],
      createTime: Date.parse(o.upload_date) || 0,
      cover: o.thumb || '',
      width: Number(o.video_width) || 0,
      height: Number(o.video_height) || 0,
      duration: Number(o.duration) || 0,
      isShort: o.is_short === true,
      live: !!o.live || !!o.livestream_status,
      public: o.visibility === 'public' && !o.is_processing,
      versions: o.videos.filter((v) => v.type === 'mp4' && /^https:\/\//.test(v.url || ''))
        .map((v) => ({ url: v.url, res: Number(v.res) || 0 })),
      url: o.url || `https://rumble.com/${o.permalink_id}.html`,
    }
  }

  function channelVideos(channelId, page = 0) {
    return storedOrFetch(`channel:${channelId}:${page}`, RUMBLE_REFRESH_MS.channel, () => readChannelVideos(channelId, page))
  }
  async function readChannelVideos(channelId, page) {
    const base = channelId.startsWith('c/') ? `https://rumble.com/${channelId}/videos` : `https://rumble.com/${channelId}`
    const html = await getPage(`${base}?page=${page + 1}`, 10 * 60 * 1000)
    if (!html) return { videos: [], hasMore: false }
    const all = videosInPage(html).map(rumbleShape).filter((v) => v.channelId === channelId)
    const seen = new Set()
    const videos = all.filter((v) => !seen.has(v.id) && seen.add(v.id) && v.public && v.versions.length && !v.live)
    return { videos, hasMore: html.includes(`page=${page + 2}`) }
  }

  // A video page (its full URL: the bare /<id>.html is a 404): owner, title, description.
  function videoPage(url) {
    const u = new URL(url)
    if (!/^(www\.)?rumble\.com$/i.test(u.hostname)) return Promise.resolve(null)
    const id = (RUMBLE_VIDEO_RE.exec(url) || [])[1]
    return storedOrFetch(`video:${(id || u.pathname).toLowerCase()}`, RUMBLE_REFRESH_MS.video, () => readVideoPage(u))
  }
  async function readVideoPage(u) {
    const html = await getPage(`https://rumble.com${u.pathname}`, 30 * 60 * 1000)
    if (!html) return null
    const owner = html.match(/class="media-by--a"[^>]*href="\/(c|user)\/([^"?#/]+)/i)
    const meta = (p) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']?og:${p}["']?[^>]+content=("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
      return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : ''
    }
    return {
      channelId: owner ? `${owner[1].toLowerCase()}/${owner[2].toLowerCase()}` : '',
      title: meta('title'),
      description: meta('description'),
      cover: meta('image'),
    }
  }

  // The video's file links come from its owner's listing: walk their pages.
  async function findInChannel(channelId, id, maxPages = 12) {
    for (let p = 0; p < maxPages; p++) {
      const { videos, hasMore } = await channelVideos(channelId, p)
      const hit = videos.find((v) => v.id === id)
      if (hit) return hit
      if (!hasMore) break
    }
    return null
  }

  // Video pages are the slow, flaky part (fewer exit IPs get through, 500 KB each),
  // so nobody waits for them: list entries carry a description once one has been
  // stored, and the missing ones are read in the background, one at a time.
  const storedVideo = (id) => stored.get(`video:${String(id).toLowerCase()}`)?.value || null
  const warmQueue = []
  let warming = false
  function warmDescriptions(videos, onFound = () => {}) {
    for (const v of videos) {
      const known = storedVideo(v.id)
      if (known) { if (known.description) onFound(v.id, known); continue }
      if (!warmQueue.some((x) => x.id === v.id)) warmQueue.push({ ...v, onFound })
    }
    if (warming) return
    warming = true
    ;(async () => {
      while (warmQueue.length) {
        const v = warmQueue.shift()
        try {
          const pageInfo = await videoPage(v.url)
          if (pageInfo?.description) await v.onFound(v.id, pageInfo)
        } catch { /* next time */ }
        await new Promise((r) => setTimeout(r, 3000))
      }
    })().finally(() => { warming = false })
  }

  return { channelVideos, readChannelVideos, videoPage, findInChannel, storedVideo, warmDescriptions }
}

// Rumble names each file by resolution (1080/720/480/360). Take the biggest that
// fits the cap, else the smallest there is.
function pickRumbleVersion(versions, cap) {
  const sorted = [...versions].sort((a, b) => b.res - a.res)
  return sorted.find((v) => v.res <= cap) || sorted[sorted.length - 1] || null
}

module.exports = {
  BITCHUTE_VIDEO_RE, BITCHUTE_CHANNEL_RE, RUMBLE_VIDEO_RE, RUMBLE_CHANNEL_RE,
  bitchuteChannelVideos, bitchuteVideo, bitchuteMediaUrl,
  createRumble, pickRumbleVersion, hmsToSeconds,
}
