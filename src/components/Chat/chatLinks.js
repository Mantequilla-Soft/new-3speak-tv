import { getPostDetails, getAccounts } from '../../hive-api/hiveApi'
import { HIVE_API_URL } from '../../utils/config'
import { formatTimeAgo } from '../../i18n'

// Frontends we recognize links for.
const HIVE_HOSTS = new Set([
  'peakd.com', 'ecency.com', 'hive.blog', '3speak.tv', 'leofinance.io', 'inleo.io',
])
function isSupportedHost(host) {
  return HIVE_HOSTS.has(host) || host.endsWith('.okinoko.io') || host.endsWith('.3speak.tv')
}

function parseOne(raw) {
  let u
  try { u = new URL(raw) } catch { return null }
  const host = u.hostname.replace(/^www\./, '')
  if (!isSupportedHost(host)) return null

  // 3Speak watch/shorts: ?v=author/permlink
  const v = u.searchParams.get('v')
  if (v && v.includes('/')) {
    const [author, permlink] = v.replace(/^@/, '').split('/')
    if (author && permlink) return { kind: 'post', author, permlink }
  }

  const path = u.pathname.replace(/\/+$/, '')

  // Post or comment: @author/permlink (also under a /category/ prefix)
  let m = path.match(/@([\w.-]+)\/([\w][\w-]*)/)
  if (m) return { kind: 'post', author: m[1], permlink: m[2] }

  // Profile: @author alone, or 3Speak /p/author and /user/author
  m = path.match(/\/@([\w.-]+)$/) || path.match(/\/(?:p|user)\/([\w.-]+)$/)
  if (m) return { kind: 'profile', author: m[1] }

  // Community: a hive-NNN id anywhere in the path
  m = path.match(/(hive-\d+)/)
  if (m) return { kind: 'community', community: m[1] }

  return null
}

/** Find the first recognized 3Speak/Hive link in a message; else null. */
export function parseChatLink(text) {
  if (!text) return null
  const urls = text.match(/https?:\/\/[^\s)]+/gi) || []
  for (const raw of urls) {
    const info = parseOne(raw.replace(/[.,]+$/, ''))
    if (info) return { ...info, url: raw }
  }
  return null
}

function parseJM(jm) {
  if (!jm) return null
  if (typeof jm === 'string') { try { return JSON.parse(jm) } catch { return null } }
  return jm
}

async function hiveRpc(method, params) {
  const res = await fetch(HIVE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  return (await res.json())?.result
}

// Plain-text excerpt from a (markdown) comment body.
function plainExcerpt(body, max = 180) {
  let t = String(body || '')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links → label
  t = t.replace(/<[^>]+>/g, '')                    // html
  t = t.replace(/[#>*_`~]/g, '')                   // md punctuation
  t = t.replace(/https?:\/\/\S+/g, '')             // bare urls
  t = t.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

const cache = new Map()

async function fetchPost(author, permlink) {
  const post = await getPostDetails(author, permlink)
  if (!post || !post.author) return null
  const jm = parseJM(post.json_metadata)
  if (post.parent_author) {
    return {
      kind: 'comment',
      author: post.author,
      permlink: post.permlink || permlink,
      created: post.created,
      excerpt: plainExcerpt(post.body),
    }
  }
  const video = jm?.video?.info
  return {
    kind: 'post',
    author: post.author,
    permlink: post.permlink || permlink,
    title: post.title || video?.title || `${author}/${permlink}`,
    created: post.created,
    thumbnail: jm?.image?.[0] || null,
    duration: typeof video?.duration === 'number' ? video.duration : null,
    isVideo: !!video || String(jm?.app || '').includes('3speak'),
  }
}

async function fetchProfile(author) {
  const [acc] = (await getAccounts([author])) || []
  if (!acc) return null
  let profile = {}
  try { profile = parseJM(acc.posting_json_metadata)?.profile || {} } catch { /* ignore */ }
  return {
    kind: 'profile',
    author: acc.name,
    displayName: profile.name || acc.name,
    about: profile.about || '',
    avatar: `/img/u/${acc.name}/avatar/small`,
  }
}

async function fetchCommunity(name) {
  const c = await hiveRpc('bridge.get_community', { name })
  if (!c) return null
  return {
    kind: 'community',
    name,
    title: c.title || name,
    about: c.about || '',
    subscribers: c.subscribers || 0,
    avatar: `/img/u/${name}/avatar/small`,
  }
}

/** Fetch normalized metadata for any recognized link. Resolves null on failure. */
export function fetchLinkMeta(link) {
  const key = `${link.kind}:${link.author || ''}/${link.permlink || ''}${link.community || ''}`
  if (cache.has(key)) return cache.get(key)
  let p
  if (link.kind === 'profile') p = fetchProfile(link.author).catch(() => null)
  else if (link.kind === 'community') p = fetchCommunity(link.community).catch(() => null)
  else p = fetchPost(link.author, link.permlink).catch(() => null)
  cache.set(key, p)
  return p
}

export function formatDuration(sec) {
  if (!sec && sec !== 0) return null
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

export function timeAgo(iso) {
  if (!iso) return ''
  return formatTimeAgo(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z', { style: 'narrow' })
}
