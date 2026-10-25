// OG / Twitter-Card prerender sidecar for social media crawlers.
//
// WHY THIS EXISTS
// ---------------
// preview.3speak.tv (and prod 3speak.tv) ship the SPA as a static shell whose
// only <meta> tags are the generic site defaults. Social crawlers (Twitterbot,
// Discordbot, Telegram, WhatsApp, …) do NOT execute JavaScript, so react-helmet
// never runs for them and every shared video/short renders the same homepage
// card. This standalone service renders per-video Open Graph + Twitter Card +
// schema.org VideoObject HTML for those bots. Humans never hit it — nginx routes
// only crawler User-Agents here (see preview.3speak.tv.nginx).
//
// This started as a port of the old Vercel Edge Middleware (since removed),
// re-expressed as a plain Node http server and EXTENDED to also cover the
// /shorts?v=author/permlink route.
//
// Deps: none — Node 18+ global fetch / AbortController only (run with /usr/bin/node v18;
// nvm v22 segfaults on this box — see the preview-3speak-api service notes).

const http = require('http');
const dns = require('dns');
// ipfs.3speak.tv publishes an AAAA in 200::/7 (Yggdrasil, unroutable). Node 18's
// fetch connects in DNS order with no IPv4 fallback, so every read there sat out
// a 10s connect timeout (Discord teasers, transcripts). IPv4 first, process-wide.
dns.setDefaultResultOrder('ipv4first');
const ogVideo = require('./og-video.cjs');
const ogSite = require('./og-site.cjs');

const PORT = process.env.OG_PORT || 4023;
const HIVE_API = 'https://api.hive.blog';
// Our own gateway for thumbnails and subtitle files. Both Bunny IPFS zones have
// answered 403 "Domain suspended" since 2026-09-08, which left every legacy
// thumbnail in the cards and the VideoObject pointing at an error page.
const IPFS_GATEWAY = 'https://ipfs.3speak.tv';
// Base for author/publisher links + the fallback logo. og:url / canonical are
// derived from the *request* host instead (so a shared preview link points back
// to preview, and a prod link to prod) — see requestOrigin().
const BASE_URL = process.env.OG_BASE_URL || 'https://3speak.tv';
// Where rel=canonical points, whichever host was asked. preview.3speak.tv and
// www.3speak.tv serve the same pages as 3speak.tv; a canonical on prod tells
// search engines which copy to rank instead of letting the copies compete.
const CANONICAL_ORIGIN = (process.env.OG_CANONICAL_ORIGIN || BASE_URL).replace(/\/+$/, '');
// The 1200x630 site banner, for cards with no image of their own. Not the square
// 3speak.jpeg: link previews stretch a square to the card's 1.91:1 shape.
const FALLBACK_THUMBNAIL = `${BASE_URL}/og-image.jpg`;
// The square logo, for schema.org `publisher.logo`, where a square is what is asked for.
const LOGO_URL = `${BASE_URL}/3speak.jpeg`;
const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || 'https://translate.3speak.tv';
// Checker/embed metadata API. Shorts (and some embed-only videos) are NOT Hive
// posts — they're embed assets whose permlink in the share URL is the *asset*
// id, not a Hive permlink. So a Hive lookup by that id 404s. /videodetails
// resolves the embed-video doc (title, thumbnail_url, duration, embed_url).
const CHECKER_URL = process.env.CHECKER_URL || 'https://checker.3speak.tv';
// Cap the transcript we inline so a long video can't bloat the bot response.
const MAX_TRANSCRIPT_CHARS = 20000;

// Comments inlined for crawlers. Real viewer wording is the point (people search
// the phrases other people type), so the bar is only about excluding padding.
const MAX_COMMENTS = 15;
const MIN_COMMENT_CHARS = 10;

const BOT_USER_AGENTS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'Discordbot',
  'TelegramBot',
  'WhatsApp',
  'LinkedInBot',
  'Slackbot',
  'Embedly',
  'Pinterest',
  'vkShare',
  'Applebot',
  'Googlebot',
  'bingbot',
  // AI assistants and their crawlers: none of them run JS either.
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'DuckAssistBot',
  'MistralAI-User',
];

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
}

// Apps that only draw a link preview. A link to a deleted video still gets the
// generic 3Speak card for them (a 404 would leave the chat with a bare URL);
// search engines and AI crawlers get a real 404 instead, see sendMissing().
const LINK_PREVIEW_BOTS = /facebookexternalhit|facebot|twitterbot|discordbot|telegrambot|whatsapp|linkedinbot|slackbot|embedly|pinterest|vkshare|bluesky|cardyb|mastodon|iframely|redditbot|summalybot|misskey|lemmy|mbin|friendica|pleroma|akkoma|synapse|zulipurlpreview|mattermost|january|amethyst|snort|wordpress|ghost\/|discourse|skypeuripreview/i;

// A valid Hive account name. Anything else cannot own a video, so a URL naming
// it is missing without asking anyone.
const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;

/** True when a Hive RPC error says the thing is not there (vs. a node failing). */
function isMissingError(error) {
  const text = error && `${error.message || ''} ${JSON.stringify(error.data || '')}`;
  return /does not exist|not valid|unknown account/i.test(text || '');
}

// Routes that carry the video as a ?v=author/permlink param. The value is the
// canonical path to echo back (og:url/canonical), and whether it's a short.
const VPARAM_ROUTES = {
  '/watch': { routePath: 'watch', kind: 'watch' },
  '/shorts': { routePath: 'shorts', kind: 'shorts' },
  '/shorts/stories': { routePath: 'shorts/stories', kind: 'shorts' },
};

/**
 * Parse video author/permlink + route info from the URL.
 * Supports:
 *   /watch?v=author/permlink            → kind 'watch'
 *   /shorts?v=author/permlink           → kind 'shorts'
 *   /shorts/stories?v=author/permlink   → kind 'shorts' (story-feed deep link)
 *   /@author/permlink (skip "shorts")   → kind 'watch'
 * Returns { author, permlink, kind, routePath } or null.
 */
function parseVideoUrl(url) {
  const { pathname, searchParams } = url;

  const vRoute = VPARAM_ROUTES[pathname];
  if (vRoute) {
    const v = searchParams.get('v');
    if (v && v.includes('/')) {
      const [rawAuthor, ...rest] = v.split('/');
      // Hive account names are lowercase; /watch?v=Alice/x is alice's video.
      const author = rawAuthor.toLowerCase();
      const permlink = rest.join('/');
      if (author && permlink) {
        return { author, permlink, kind: vRoute.kind, routePath: vRoute.routePath };
      }
    }
    return null;
  }

  // /@author/permlink
  const atMatch = pathname.match(/^\/@([^/]+)\/(.+)$/);
  if (atMatch) {
    const [, rawAuthor, permlink] = atMatch;
    if (permlink === 'shorts') return null; // shorts listing page, not a video
    return { author: rawAuthor.toLowerCase(), permlink, kind: 'watch', routePath: 'watch' };
  }

  return null;
}

/**
 * A Hive post as { post }, or { missing: true } when Hive says it does not
 * exist, or { error: true } when the node could not answer. Only "missing" may
 * turn into a 404: a slow node must never get a real video dropped from search.
 */
async function lookupHivePost(author, permlink) {
  if (!ACCOUNT_RE.test(author) || !permlink) return { missing: true };
  try {
    const res = await fetch(HIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'bridge.get_post',
        params: { author, permlink, observer: '' },
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { error: true };
    const data = await res.json();
    if (data && data.error) return isMissingError(data.error) ? { missing: true } : { error: true };
    const post = data && data.result;
    // A deleted post comes back as an empty shell rather than an error.
    if (!post || !post.author) return { missing: true };
    return { post };
  } catch (_) {
    return { error: true };
  }
}

async function fetchHivePost(author, permlink) {
  return (await lookupHivePost(author, permlink)).post || null;
}

/**
 * Resolve an embed-video doc from the checker (/videodetails/:owner/:permlink)
 * as { doc }, { missing: true } (a 404) or { error: true }. Time-boxed, never
 * blocks the bot response long. The matching `videos`/`embed-video`
 * collections key on owner+permlink (asset id) OR hive_author+hive_permlink,
 * so it works for the share URL's id directly.
 */
async function lookupEmbed(owner, permlink) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(
      `${CHECKER_URL}/videodetails/${encodeURIComponent(owner)}/${encodeURIComponent(permlink)}`,
      { signal: ctrl.signal },
    );
    if (res.status === 404) return { missing: true };
    if (!res.ok) return { error: true };
    const doc = await res.json();
    if (!doc || typeof doc !== 'object' || (!doc.permlink && !doc.owner)) return { missing: true };
    return { doc };
  } catch (_) {
    return { error: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse an embed_url ("@author/permlink") into { author, permlink } or null.
 */
function parseEmbedUrl(embedUrl) {
  if (!embedUrl || typeof embedUrl !== 'string') return null;
  const m = embedUrl.replace(/^@/, '').match(/^([^/]+)\/(.+)$/);
  if (!m) return null;
  return { author: m[1], permlink: m[2] };
}

function parseMeta(jsonMetadata) {
  if (!jsonMetadata) return {};
  if (typeof jsonMetadata === 'object') return jsonMetadata;
  try {
    return JSON.parse(jsonMetadata);
  } catch (_) {
    return {};
  }
}

function isAdultByTitle(title) {
  if (!title) return false;
  return /(\bporn\b|\bxxx\b|\bnsfw\b|\bnude[sd]?\b|\bnaked\b|sex\s*tape|onlyfans|\bhentai\b|camgirl|\bescort\b)/i.test(
    title,
  );
}

function getIndexability(post, meta) {
  const tags = Array.isArray(meta && meta.tags)
    ? meta.tags.map((t) => String(t).toLowerCase())
    : [];

  if (tags.includes('nsfw') || tags.includes('xxx') || tags.includes('porn')) {
    return { index: false, reason: 'nsfw-tag' };
  }
  if (isAdultByTitle(post.title)) {
    return { index: false, reason: 'nsfw-title' };
  }

  if ((post.stats && post.stats.gray === true) || (post.stats && post.stats.hide === true)) {
    return { index: false, reason: 'muted' };
  }
  if (Array.isArray(post.blacklists) && post.blacklists.length > 0) {
    return { index: false, reason: 'blacklist' };
  }

  const videoInfo = (meta && meta.video && meta.video.info) || {};
  const hasVideo = !!(
    videoInfo.duration ||
    videoInfo.ipfs ||
    videoInfo.filename ||
    (Array.isArray(videoInfo.sourceMap) &&
      videoInfo.sourceMap.some((s) => s && s.type && s.type !== 'thumbnail'))
  );
  const appIsSpeak = String((meta && meta.app) || '').toLowerCase().includes('speak');
  const bodyLen = (post.body || '').trim().length;
  if (!hasVideo && !appIsSpeak && bodyLen < 50) {
    return { index: false, reason: 'empty' };
  }

  return { index: true };
}

function resolveCanonical(meta, selfUrl) {
  const declared = meta && meta.canonical_url;
  if (typeof declared === 'string') {
    const trimmed = declared.trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  }
  return selfUrl;
}

function fixThumbnail(thumbnail) {
  if (!thumbnail || typeof thumbnail !== 'string' || thumbnail.trim() === '') {
    return FALLBACK_THUMBNAIL;
  }

  const t = thumbnail.trim();

  if (t.includes('/ipfs/http')) {
    const match = t.match(/\/ipfs\/(https?:\/\/.+)/);
    if (match && match[1]) return match[1];
  }

  if (t.includes('ipfs://')) {
    const hash = t.replace('ipfs://', '').trim();
    if (!hash) return FALLBACK_THUMBNAIL;
    return `${IPFS_GATEWAY}/ipfs/${hash}`;
  }

  if (/^https:\/\/(hot)?ipfs-3speak(-1)?\.b-cdn\.net\/ipfs\//.test(t)) {
    return t.replace(/^https:\/\/[^/]+/, IPFS_GATEWAY);
  }

  if (
    t.includes('images.hive.blog') ||
    t.includes('files.peakd.com') ||
    t.includes('images.3speak.tv')
  ) {
    return t;
  }

  if (t.includes('media.3speak.tv')) {
    return FALLBACK_THUMBNAIL;
  }

  if (t.startsWith('http')) {
    return `https://images.hive.blog/${OG_IMAGE_BOX}/${t}`;
  }

  return t;
}

// Social crawlers reject oversized images (Discord/Twitter drop multi-MB or
// huge-dimension files — a raw images.hive.blog upload is often the user's
// full-res photo at 3+ MB). Route raw hive images through hive's resize proxy
// so the card gets a bounded copy. Already-sized proxies (/WxH/), processed CDN
// (/p/...), avatars (/u/...) and non-hive hosts (images.3speak.tv, the local
// fallback) are left untouched — they're already small.
const OG_IMAGE_BOX = '1280x720';
function boundImage(url) {
  if (!url || typeof url !== 'string') return url;
  const m = url.match(/^https?:\/\/images\.hive\.blog\/([^/]+)\//);
  if (!m) return url;
  const seg = m[1];
  if (/^\d+x\d+$/.test(seg) || seg === 'p' || seg === 'u') return url;
  return `https://images.hive.blog/${OG_IMAGE_BOX}/${url}`;
}

function extractDescription(body) {
  if (!body) return '';
  let text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_~`>]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 200) {
    text = text.slice(0, 197) + '...';
  }
  return text;
}

/**
 * The first line of a post that is real text: not the player link or an image,
 * at least three characters. Snaps put their caption there.
 */
function firstLine(body) {
  for (const line of String(body || '').split('\n')) {
    const text = line
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#*_~`>|▶]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 3 && !/^-+$/.test(text)) return text.length > 100 ? `${text.slice(0, 97).trim()}...` : text;
  }
  return '';
}

function secondsToISO8601(sec) {
  const total = Math.round(Number(sec) || 0);
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}` || 'PT0S';
}

/** 0:38, 12:05, 1:02:09: how chapter lists write a start time. */
function clockTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * The post's chapters (json_metadata.video.chapters, written by the upload
 * Timeline step) as [{ start, end, title }], each ending where the next begins
 * and the last at the video's end. Two or more, or none: one chapter is no
 * timeline.
 */
function videoChapters(meta, duration) {
  const raw = meta && meta.video && Array.isArray(meta.video.chapters) ? meta.video.chapters : [];
  const list = raw
    .map((c) => ({ start: Math.floor(Number(c && c.start)), title: String((c && c.title) || '').trim().slice(0, 100) }))
    .filter((c) => Number.isFinite(c.start) && c.start >= 0 && c.title)
    .sort((a, b) => a.start - b.start)
    .filter((c, i, all) => i === 0 || c.start > all[i - 1].start)
    .slice(0, 50);
  if (list.length < 2) return [];
  const total = Math.floor(Number(duration) || 0);
  return list.map((c, i) => {
    const end = i + 1 < list.length ? list[i + 1].start : total;
    return end > c.start ? { ...c, end } : c;
  });
}

/** The post's topic tags as /t/ links. Community ids (hive-123456) are not topics. */
function videoTags(meta) {
  const tags = meta && Array.isArray(meta.tags) ? meta.tags : [];
  return [...new Set(tags.map((t) => String(t || '').toLowerCase().trim()))]
    .filter((t) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(t) && !/^hive-\d+$/.test(t))
    .slice(0, 10);
}

const MAX_RELATED = 12;

/** Related videos from the checker, as links for crawlers. [] on any failure. */
async function fetchRelated(author, permlink) {
  try {
    const res = await fetch(
      `${CHECKER_URL}/feeds/related/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}?limit=${MAX_RELATED}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data.videos) ? data.videos : [])
      .map((v) => ({ author: v.author || v.owner, permlink: v.permlink, title: String(v.title || '').trim() }))
      .filter((v) => v.author && v.permlink && v.title && !(v.author === author && v.permlink === permlink))
      .slice(0, MAX_RELATED);
  } catch (_) {
    return [];
  }
}

function toIsoDate(created) {
  if (!created || typeof created !== 'string') return null;
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(created) ? created : `${created}Z`;
}

function srtToText(srt) {
  if (!srt || typeof srt !== 'string') return '';
  const out = [];
  let last = '';
  for (const block of srt.trim().replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const lines = block.split('\n');
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;
    const text = lines
      .slice(tsIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text !== last) {
      out.push(text);
      last = text;
    }
  }
  let joined = out.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length > MAX_TRANSCRIPT_CHARS) {
    joined = joined.slice(0, MAX_TRANSCRIPT_CHARS).replace(/\s+\S*$/, '') + '…';
  }
  return joined;
}

// Subtitle files live on IPFS. The checker's /subtitle-proxy fetches the CID
// server-side, falling through the gateways to the ingest node's own IPFS API,
// so it goes first. Direct is the fallback only: ipfs.3speak.tv publishes an
// unroutable AAAA (200::/7), and Node 18's fetch sits out a 10s connect
// timeout on it instead of trying IPv4, which ate the whole transcript budget.
async function fetchSrt(cid, signal) {
  try {
    const proxied = await fetch(`${CHECKER_URL}/subtitle-proxy/${cid}`, { signal });
    if (proxied.ok) return await proxied.text();
  } catch (_) { /* fall through to the gateway */ }
  try {
    const direct = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`, { signal });
    if (direct.ok) return await direct.text();
  } catch (_) { /* no transcript for this one */ }
  return null;
}

/**
 * The video's transcript, plus the languages it has captions in.
 *
 * English is preferred, then whatever the video actually has — a Spanish talk
 * should be indexed by its Spanish words rather than not at all. Only ONE
 * language is inlined on purpose: a page carrying the same speech five times
 * over reads as duplicated, near-spam text and muddies the page's own language
 * signal, which is the opposite of what this is for. The other languages are
 * declared as `subtitleLanguage` instead, which is the field meant to carry them.
 */
async function fetchTranscript(author, permlink) {
  const ctrl = new AbortController();
  // Two network hops now (list, then the file, possibly via the proxy), so the
  // old 2.5s budget for the whole chain was tight even when the CDN answered.
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const listRes = await fetch(`${TRANSLATE_API_URL}/subtitles/${author}/${permlink}`, {
      signal: ctrl.signal,
    });
    if (!listRes.ok) return null;
    const list = await listRes.json();
    if (!Array.isArray(list) || list.length === 0) return null;

    const languages = list.map((l) => l && l.lang).filter(Boolean);
    const preferred = list.find((l) => l && l.lang === 'en') || list[0];
    // One unfetchable file shouldn't cost the page its transcript when the video
    // has seven other translations sitting right there.
    const ordered = [preferred, ...list.filter((l) => l !== preferred)];

    for (const entry of ordered) {
      if (!entry || !entry.cid) continue;
      const srt = await fetchSrt(entry.cid, ctrl.signal);
      if (!srt) continue;
      const text = srtToText(srt);
      if (text) return { text, lang: entry.lang || 'en', languages };
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip a Hive comment body down to plain prose.
 *
 * URLs and markdown links go entirely, label kept — deliberately, and not just
 * for tidiness: with no anchors in the output there is no PageRank to hand a
 * comment spammer, which is the whole reason inlining user text is normally a
 * risk. Images, code fences and markup go the same way, then whitespace is
 * collapsed so the length test measures words rather than formatting.
 */
function commentToText(body) {
  if (!body || typeof body !== 'string') return '';
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_>#`~|-]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Emoji and punctuation shouldn't count toward the length floor: "🔥🔥🔥🔥🔥" is
// not a ten-character comment in any sense that matters.
function meaningfulLength(text) {
  return text.replace(/[^\p{L}\p{N}]/gu, '').length;
}

/**
 * Top-level replies worth showing a crawler: substantive ones first, capped.
 *
 * Only direct replies (get_content_replies returns exactly those), so a long
 * argument in a sub-thread doesn't drown the page. Ordered by payout, which is
 * Hive's own quality signal and a far better ranking than recency.
 */
async function fetchComments(author, permlink) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetch(HIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'condenser_api.get_content_replies',
        params: [author, permlink],
        id: 1,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const replies = (data && data.result) || [];
    if (!Array.isArray(replies)) return [];

    const payout = (c) => parseFloat(c.pending_payout_value) + parseFloat(c.total_payout_value) || 0;
    return replies
      .map((c) => ({
        author: c.author,
        text: commentToText(c.body),
        created: toIsoDate(c.created),
        score: payout(c) * 1000 + (c.net_votes || 0),
      }))
      .filter((c) => c.author && meaningfulLength(c.text) >= MIN_COMMENT_CHARS)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_COMMENTS);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** JSON-LD as a <script>, with `<` escaped so no value can close the tag. */
function ldScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** schema.org BreadcrumbList from [name, url] pairs, root first. */
function breadcrumbLd(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  };
}

function buildOgHtml({
  title,
  description,
  image,
  url,
  canonical = url,
  duration,
  author,
  noindex,
  uploadDate,
  embedUrl,
  contentUrl,
  chapters,
  tags,
  related,
  origin = BASE_URL,
  transcript,
  transcriptLang,
  subtitleLanguages,
  comments,
  commentCount,
  video,
  oembedUrl,
  player,
  ogType = 'video.other',
  imageType,
}) {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safeUrl = escapeHtml(url);
  const safeCanonical = escapeHtml(canonical);
  const safeAuthor = escapeHtml(author);

  const durationMeta = duration
    ? `<meta property="og:video:duration" content="${Math.round(duration)}" />`
    : '';

  // Inline playback in Discord: a direct progressive MP4 (see og-video.cjs).
  // twitter:card=player only goes out with it, i.e. only to Discordbot: a real
  // Twitter player card needs an approved twitter:player iframe, and without one
  // X would drop the large-image card it shows today.
  const videoAbs = video ? escapeHtml(video.url) : '';
  const videoMeta = video
    ? `
  <meta property="og:video" content="${videoAbs}" />
  <meta property="og:video:url" content="${videoAbs}" />
  <meta property="og:video:secure_url" content="${videoAbs}" />
  <meta property="og:video:type" content="video/mp4" />
  <meta property="og:video:width" content="${Number(video.width) || 1280}" />
  <meta property="og:video:height" content="${Number(video.height) || 720}" />`
    : '';
  const twitterCard = video
    ? `<meta name="twitter:card" content="player" />
  <meta name="twitter:player:stream" content="${videoAbs}" />
  <meta name="twitter:player:stream:content_type" content="video/mp4" />
  <meta name="twitter:player:width" content="${Number(video.width) || 1280}" />
  <meta name="twitter:player:height" content="${Number(video.height) || 720}" />`
    : '<meta name="twitter:card" content="summary_large_image" />';
  // The iframe player for apps that read twitter:player whatever the card type
  // (Misskey, Iframely). X ignores it under summary_large_image, which is what
  // it should keep showing: its player cards need approval.
  const playerMeta = player
    ? `
  <meta name="twitter:player" content="${escapeHtml(player.url)}" />
  <meta name="twitter:player:width" content="${player.width}" />
  <meta name="twitter:player:height" content="${player.height}" />`
    : '';
  const playerOgVideo = player && player.ogVideo
    ? `
  <meta property="og:video" content="${escapeHtml(player.url)}" />
  <meta property="og:video:url" content="${escapeHtml(player.url)}" />
  <meta property="og:video:secure_url" content="${escapeHtml(player.url)}" />
  <meta property="og:video:type" content="text/html" />
  <meta property="og:video:width" content="${player.width}" />
  <meta property="og:video:height" content="${player.height}" />`
    : '';

  const robotsMeta = noindex
    ? '<meta name="robots" content="noindex, follow" />'
    : '<meta name="robots" content="index, follow" />';

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: title,
    description: description || title,
    thumbnailUrl: image,
    embedUrl,
    url: canonical,
    author: { '@type': 'Person', name: `@${author}`, url: `${BASE_URL}/@${author}` },
    publisher: {
      '@type': 'Organization',
      name: '3Speak',
      logo: { '@type': 'ImageObject', url: LOGO_URL },
    },
  };
  // The media itself, when the player can name it. Never the watch page: a
  // contentUrl that answers HTML tells Google there is no video to fetch.
  if (contentUrl) ld.contentUrl = contentUrl;
  if (uploadDate) ld.uploadDate = uploadDate;
  const isoDuration = secondsToISO8601(duration);
  if (isoDuration) ld.duration = isoDuration;
  if (transcript) ld.transcript = transcript;
  // Which languages this video has captions in. Declared rather than inlined:
  // the words go in once (see fetchTranscript), the availability goes here.
  if (Array.isArray(subtitleLanguages) && subtitleLanguages.length) {
    ld.subtitleLanguage = subtitleLanguages;
  }
  if (typeof commentCount === 'number' && commentCount >= 0) ld.commentCount = commentCount;
  if (Array.isArray(comments) && comments.length) {
    ld.comment = comments.map((c) => ({
      '@type': 'Comment',
      author: { '@type': 'Person', name: `@${c.author}` },
      text: c.text,
      ...(c.created ? { dateCreated: c.created } : {}),
    }));
  }
  // Chapters as key moments: Google links each one into the video by its &t=,
  // on the page it ranks, so off the canonical.
  const atTime = (sec) => `${canonical}${canonical.includes('?') ? '&' : '?'}t=${sec}`;
  if (Array.isArray(chapters) && chapters.length) {
    ld.hasPart = chapters.map((c) => ({
      '@type': 'Clip',
      name: c.title,
      startOffset: c.start,
      ...(c.end ? { endOffset: c.end } : {}),
      url: atTime(c.start),
    }));
  }
  // 3Speak > @creator > video: search results show this trail instead of the
  // bare ?v= address.
  const breadcrumbs = breadcrumbLd([
    ['3Speak', `${CANONICAL_ORIGIN}/`],
    [`@${author}`, `${CANONICAL_ORIGIN}/@${author}`],
    [title, canonical],
  ]);
  const jsonLd = ldScript(noindex ? ld : [ld, breadcrumbs]);

  // `lang` on the section matters when the spoken language isn't the page's:
  // it stops a Spanish transcript being read as bad English.
  const transcriptSection = transcript
    ? `\n  <section${transcriptLang ? ` lang="${escapeHtml(transcriptLang)}"` : ''}>\n    <h2>Transcript</h2>\n    <p>${escapeHtml(transcript)}</p>\n  </section>`
    : '';

  // Rendered without a single anchor: commentToText already removed the links,
  // so there is nothing here for a spammer to gain.
  const commentsSection = Array.isArray(comments) && comments.length
    ? `\n  <section>\n    <h2>Comments</h2>\n${comments
        .map((c) => `    <article><p><b>@${escapeHtml(c.author)}</b>: ${escapeHtml(c.text)}</p></article>`)
        .join('\n')}\n  </section>`
    : '';

  // The player on the page: Google only lists a page under video results when
  // the video is actually on it.
  const playerFrame = player
    ? `\n  <iframe src="${escapeHtml(player.url)}" width="${player.width}" height="${player.height}" title="${safeTitle}" allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
    : '';

  const chaptersSection = Array.isArray(chapters) && chapters.length
    ? `\n  <section>\n    <h2>Chapters</h2>\n    <ol>\n${chapters
        .map((c) => `      <li><a href="${escapeHtml(atTime(c.start))}">${clockTime(c.start)} ${escapeHtml(c.title)}</a></li>`)
        .join('\n')}\n    </ol>\n  </section>`
    : '';

  const tagLine = Array.isArray(tags) && tags.length
    ? `\n  <p>Tags: ${tags
        .map((t) => `<a href="${escapeHtml(`${origin}/t/${t}`)}">#${escapeHtml(t)}</a>`)
        .join(' ')}</p>`
    : '';

  // Other videos, so a crawler that lands here can walk on into the catalogue.
  const relatedSection = Array.isArray(related) && related.length
    ? `\n  <section>\n    <h2>More videos on 3Speak</h2>\n    <ul>\n${related
        .map((r) => `      <li><a href="${escapeHtml(`${origin}/@${r.author}/${r.permlink}`)}">${escapeHtml(r.title)}</a> by @${escapeHtml(r.author)}</li>`)
        .join('\n')}\n    </ul>\n  </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle} - 3Speak</title>
  ${robotsMeta}

  <!-- Open Graph -->
  <meta property="og:type" content="${escapeHtml(ogType)}" />
  <meta property="og:site_name" content="3Speak" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="${safeImage}" />${
    imageType ? `\n  <meta property="og:image:type" content="${escapeHtml(imageType)}" />` : ''
  }
  <meta property="og:url" content="${safeUrl}" />
  ${durationMeta}${videoMeta}${playerOgVideo}

  <!-- Twitter Card -->
  ${twitterCard}${playerMeta}
  <meta name="twitter:site" content="@3speaktv" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeImage}" />

  <link rel="canonical" href="${safeCanonical}" />${
    oembedUrl
      ? `\n  <link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembedUrl)}" />`
      : ''
  }

  ${jsonLd}
</head>
<body>
  <h1>${safeTitle}</h1>${playerFrame}
  <p><a href="${safeUrl}">${safeTitle}</a> by <a href="${escapeHtml(`${origin}/@${author}`)}">@${safeAuthor}</a> on <a href="${escapeHtml(origin)}">3Speak</a></p>
  <p>${safeDesc}</p>${tagLine}${chaptersSection}${transcriptSection}${commentsSection}${relatedSection}
</body>
</html>`;
}

// Generic site card — returned for bots on non-video URLs (or on any error),
// so the worst case is identical to today's static index.html defaults rather
// than a broken response. Mirrors index.html's primary OG/Twitter tags.
const GENERIC_CARD = {
  title: '3Speak: the video platform where creators and viewers earn',
  description:
    '3Speak is the decentralized YouTube alternative where creators earn from their first video and viewers can earn too. Real people, real stories.',
  image: FALLBACK_THUMBNAIL,
};

// Pages with a card of their own (nginx must send their bots here: add a
// `location = <path>` block like /watch's). Title + description mirror the
// page's own SEOHead or, without one, its own words (src/locales/en), so the
// card says what the page says. `image` is a path on the host that was asked:
// the files live in public/ (public/og/: feeds on a wall of thumbnails, tools
// in the /advertise style).
//
// Apart from /advertise, nginx sends only link-preview fetchers here, never
// search engines ($threespeak_preview_bot): these pages have nothing for a
// crawler beyond the card, and Google renders the real page.
const UPLOAD_CARD = {
  title: '3S | Upload to 3Speak',
  description: 'Publish videos and shorts to your own Hive account on 3Speak, with chapters and links.',
  image: '/og/upload.jpg',
};
const PAGE_CARDS = {
  '/advertise': {
    title: '3S | Advertise on 3Speak videos',
    description: 'Put a short ad inside videos on 3Speak, paid in HBD or HIVE. Every advertiser is reviewed by hand.',
    image: '/og-advertise.jpg',
  },
  '/discover': {
    title: '3S | Discover 3Speak',
    description: 'Search videos, shorts, audio, communities and playlists on 3Speak.',
    image: '/og/discover.jpg',
  },
  '/surf': {
    title: '3S | Surf 3Speak',
    description: 'Pick a channel and lean back. 3Speak lines up the best videos on that topic one after another.',
    image: '/og/surf.jpg',
  },
  '/audio': {
    title: '3S | Audio on 3Speak',
    description: 'Podcasts and music on 3Speak, with their own player. Publish audio the same way you publish video.',
    image: '/og/audio.jpg',
  },
  '/badges': {
    title: '3S | Badges on 3Speak',
    description: 'Badges are awards given on Hive for events, contributions and milestones. Open one to see everyone who holds it and what they publish.',
    image: '/og/badges.jpg',
  },
  '/upload': UPLOAD_CARD,
  '/embed-studio': UPLOAD_CARD,
  '/faq': {
    title: '3S | Frequently asked questions',
    description: 'New to 3Speak? Here are the answers to the questions people ask us most.',
    image: '/og/faq.jpg',
  },
  // Live only where the importer is switched on (VITE_VIDEO_IMPORT): nginx is the switch.
  '/youtube-import': {
    title: '3S | Import your videos to 3Speak',
    description: 'Bring your videos from YouTube or TikTok to 3Speak. Title, description, tags and thumbnail are filled in for you.',
    image: '/og/youtube-import.jpg',
  },
  // Live only once streaming is open to everyone (VITE_ENABLE_OPENPODS): nginx is the switch.
  '/openpods': {
    title: '3S | Go live on 3Speak',
    description: 'Stream on 3Speak from your browser or OBS, with live chat.',
    image: '/og/openpods.jpg',
  },
};

/**
 * The generic card. `canonical` defaults to the page on 3speak.tv without its
 * query string; `noindex` is for URLs that are not a page of their own (a
 * /watch with no video named, a lookup that failed).
 */
function buildGenericHtml(siteUrl, card = GENERIC_CARD, { canonical, noindex = false } = {}) {
  const url = escapeHtml(siteUrl);
  let canonicalUrl = canonical;
  if (!canonicalUrl) {
    try {
      canonicalUrl = `${CANONICAL_ORIGIN}${new URL(siteUrl).pathname}`;
    } catch (_) {
      canonicalUrl = `${CANONICAL_ORIGIN}/`;
    }
  }
  const title = escapeHtml(card.title);
  const desc = escapeHtml(card.description);
  const image = escapeHtml(card.image);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="3Speak" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${url}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@3speaktv" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${image}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
</head>
<body><h1>${title}</h1><p>${desc}</p><p><a href="${escapeHtml(`${CANONICAL_ORIGIN}/`)}">3Speak</a></p></body>
</html>`;
}

// Reconstruct the public origin from the proxy headers nginx forwards
// (X-Forwarded-Proto + Host) so og:url matches the host that was actually
// shared: preview on preview, prod on prod. www is folded into the apex: it is
// the same site, and videos do not play on www (the IPFS gateway sends CORS
// headers for the apex only). rel=canonical uses CANONICAL_ORIGIN instead.
function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['host'] || '3speak.tv').split(',')[0].trim().replace(/^www\.3speak\.tv$/i, '3speak.tv');
  return `${proto}://${host}`;
}

/**
 * A URL that names something that does not exist (a deleted video, an unknown
 * account). Search engines and AI crawlers get a real 404, so the URL drops
 * out of their index instead of sitting there as a copy of the homepage (a
 * "soft 404"). Link-preview apps keep the generic 3Speak card, marked noindex.
 */
function sendMissing(req, res, origin, url) {
  const ua = req.headers['user-agent'] || '';
  const card = GENERIC_CARD;
  if (LINK_PREVIEW_BOTS.test(ua)) {
    return sendHtml(req, res, 200, buildGenericHtml(origin + url.pathname + url.search, card, { noindex: true }));
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Not found - 3Speak</title>
  <meta name="robots" content="noindex, follow" />
</head>
<body>
  <h1>This page is not on 3Speak</h1>
  <p>The video or channel may have been removed, or the link is mistyped.</p>
  <p><a href="${escapeHtml(`${CANONICAL_ORIGIN}/`)}">3Speak home</a> · <a href="${escapeHtml(`${CANONICAL_ORIGIN}/trend`)}">Trending videos</a> · <a href="${escapeHtml(`${CANONICAL_ORIGIN}/new`)}">New videos</a></p>
</body>
</html>`;
  return sendHtml(req, res, 404, html);
}

/**
 * A lookup failed (Hive node or checker down, timeout). Search engines get a
 * 503 + Retry-After, which they read as "come back later" and which costs the
 * page nothing; a noindex or a homepage copy here would push a real video out
 * of the index over one slow node. Link-preview apps get the generic card.
 */
function sendUnavailable(req, res, origin, url) {
  const ua = req.headers['user-agent'] || '';
  if (LINK_PREVIEW_BOTS.test(ua)) {
    return sendHtml(req, res, 200, buildGenericHtml(origin + url.pathname + url.search, GENERIC_CARD, { noindex: true }));
  }
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' });
  return res.end(req.method === 'HEAD' ? undefined : 'Temporarily unavailable, please retry');
}

function sendHtml(req, res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    // no-store, NOT s-maxage: preview/prod sit behind Cloudflare, whose cache is
    // keyed by URL and does NOT vary on User-Agent. If a shared cache stored this
    // bot-only prerender it could serve the stripped OG page to a real human (or
    // a stale page to bots). Bot traffic is low, so skipping the edge cache is a
    // cheap price for never cross-serving. (The Vercel original used s-maxage
    // because Vercel's edge keys differently — not safe here.)
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(html);
}

// Discord drops og:description from any embed that carries a video, so a
// video card would lose the post's text. It does show an oEmbed author_name
// above the video (the same trick fxtwitter uses), so the description goes
// there. The card was just rendered when Discord asks for this, so its text is
// remembered briefly instead of fetched twice.
const OEMBED_PATH = '/og-video/oembed.json';

// Public oEmbed (https://oembed.com) of type "video": the play.3speak.tv
// iframe. Mastodon, Misskey, WordPress, Ghost and Iframely read it to play
// 3Speak links inline; it is listed in the oembed.com provider registry.
// OEMBED_PATH above is a different, Discord-only trick and stays separate.
const PUBLIC_OEMBED_PATH = '/oembed';
const PLAYER_ORIGIN = (process.env.OG_PLAYER_ORIGIN || 'https://play.3speak.tv').replace(/\/+$/, '');

/** The no-autoplay iframe player for a parsed share URL. play.3speak.tv's
 * /watch resolves legacy videos, new uploads and shorts alike. */
function playerUrlFor(video) {
  return `${PLAYER_ORIGIN}/watch?v=${encodeURIComponent(video.author)}/${encodeURIComponent(video.permlink)}&mode=iframe`;
}

/** Player box: 16:9 for videos, 9:16 for shorts, shrunk to fit maxwidth/maxheight. */
function playerSize(video, maxwidth, maxheight) {
  const portrait = video.kind === 'shorts';
  let width = portrait ? 360 : 640;
  let height = portrait ? 640 : 360;
  const mw = parseInt(maxwidth, 10);
  const mh = parseInt(maxheight, 10);
  if (mw > 0 && width > mw) {
    height = Math.round((height * mw) / width);
    width = mw;
  }
  if (mh > 0 && height > mh) {
    width = Math.round((width * mh) / height);
    height = mh;
  }
  return { width, height };
}

// Apps that read og:video as an iframe page (og:video:type text/html) and play
// it inline: Lemmy, Mbin, Friendica, Snort, Misskey. Not for everyone: Facebook,
// WhatsApp and X would read it as a broken video file, Amethyst and Stoat play
// og:video in a <video> tag, and Discord/Telegram get the MP4 teaser instead.
const PLAYER_OG_VIDEO_BOTS = new RegExp(
  (process.env.OG_PLAYER_BOTS || 'Lemmy,Mbin,Friendica,Snort,SummalyBot,Misskey,Mastodon,Pleroma,Akkoma,Iframely')
    .split(',').map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).join('|'),
  'i',
);

function publicOembedUrl(origin, canonicalUrl) {
  return `${origin}${PUBLIC_OEMBED_PATH}?url=${encodeURIComponent(canonicalUrl)}&format=json`;
}

function sendOembedError(req, res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  return res.end(req.method === 'HEAD' ? undefined : message);
}

async function servePublicOembed(req, res, url, origin) {
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  if (format !== 'json') return sendOembedError(req, res, 501, 'Only format=json is supported');

  let target;
  try {
    target = new URL(url.searchParams.get('url') || '');
  } catch (_) {
    return sendOembedError(req, res, 404, 'Not a 3Speak video URL');
  }
  if (!/^(www\.)?3speak\.tv$/i.test(target.hostname) && target.host !== new URL(origin).host) {
    return sendOembedError(req, res, 404, 'Not a 3Speak video URL');
  }
  const video = parseVideoUrl(target);
  if (!video) return sendOembedError(req, res, 404, 'Not a 3Speak video URL');

  const card = await resolveVideoCard(video, origin);
  if (!card || card.missing) return sendOembedError(req, res, 404, 'Video not found');
  // NSFW, muted, blacklisted or gated: no player anywhere off-site.
  if (!card.inlineAllowed) return sendOembedError(req, res, 401, 'This video cannot be embedded');

  const player = playerUrlFor(video);
  const { width, height } = playerSize(video, url.searchParams.get('maxwidth'), url.searchParams.get('maxheight'));
  const body = {
    version: '1.0',
    type: 'video',
    title: card.title,
    author_name: video.author,
    author_url: `${origin}/@${video.author}`,
    provider_name: '3Speak',
    provider_url: `${origin}/`,
    cache_age: 3600,
    thumbnail_url: card.image,
    thumbnail_width: video.kind === 'shorts' ? 720 : 1280,
    thumbnail_height: video.kind === 'shorts' ? 1280 : 720,
    html: `<iframe src="${escapeHtml(player)}" width="${width}" height="${height}" frameborder="0" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen title="${escapeHtml(`3Speak video: ${card.title}`)}"></iframe>`,
    width,
    height,
  };
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(JSON.stringify(body));
}
const oembedMemo = new Map();
const OEMBED_TTL_MS = 60 * 60 * 1000;

function rememberOembed(ref, entry) {
  if (oembedMemo.size > 5000) oembedMemo.clear();
  oembedMemo.set(ref, { ...entry, expires: Date.now() + OEMBED_TTL_MS });
}

async function serveOembed(req, res, url, origin) {
  const ref = url.searchParams.get('v') || '';
  const [author, ...rest] = ref.split('/');
  const permlink = rest.join('/');
  let entry = oembedMemo.get(ref);
  if (!entry || Date.now() > entry.expires) {
    entry = null;
    // After a restart: one Hive lookup. Shorts (asset ids) just get the
    // generic line.
    if (/^[a-z0-9][a-z0-9.-]{1,15}$/.test(author) && permlink) {
      const post = await fetchHivePost(author, permlink).catch(() => null);
      if (post) entry = { description: extractDescription(post.body), url: `${origin}/@${author}/${permlink}` };
    }
  }
  const text = (entry && entry.description) || (author ? `A video by @${author} on 3Speak` : '3Speak');
  const body = {
    version: '1.0',
    type: 'link',
    // Discord caps author_name at 256 characters.
    author_name: text.length > 256 ? `${text.slice(0, 253)}...` : text,
    author_url: (entry && entry.url) || origin,
    provider_name: '3Speak',
    provider_url: origin,
  };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  res.end(JSON.stringify(body));
}

// Share images of communities and profiles, drawn by the API (og-cards.cjs).
// Only the URL helper is used here; the drawing code loads in the API.
const { cardUrl } = require('./og-cards.cjs');

// Profiles, playlists/albums and audio posts. See og-pages.cjs.
const ogPages = require('./og-pages.cjs')({
  BASE_URL, CANONICAL_ORIGIN, CHECKER_URL, escapeHtml, fixThumbnail, boundImage, extractDescription,
  parseMeta, getIndexability, lookupHivePost, isMissingError, breadcrumbLd,
  secondsToISO8601, toIsoDate, ogVideo, cardUrl,
});

// Feed, topic and community pages. See og-lists.cjs.
const ogLists = require('./og-lists.cjs')({
  CANONICAL_ORIGIN, CHECKER_URL, FALLBACK_THUMBNAIL, escapeHtml, fixThumbnail, boundImage,
  isMissingError, breadcrumbLd, ldScript, isAdultByTitle, cardUrl,
});

/**
 * Everything a card says about one video: the Hive post and/or embed doc,
 * title, description, thumbnail and the indexing / inline-playback verdicts.
 * Shared by the watch-page card and /oembed. `{ missing: true }` when both
 * Hive and the checker said there is no such video, null when a lookup failed.
 */
async function resolveVideoCard(video, origin) {
  // No Hive account can have this name, so no video can be under it.
  if (!ACCOUNT_RE.test(video.author)) return { missing: true };
  // Resolve the Hive post and/or the embed-video doc. Shorts (and some embed
  // videos) aren't Hive posts — the share URL's permlink is the embed *asset*
  // id, so a Hive lookup by it 404s. Strategy:
  //   - /shorts: resolve the embed doc first, then the Hive post via embed_url.
  //     A snap the checker never saw is still a Hive post: try that last.
  //   - /watch & /@: try Hive directly; only on a miss fall back to the embed
  //     doc (cheap, and avoids a checker call for ordinary videos).
  let post = null;
  let embed = null;
  let hiveLookup = null;
  let embedLookup = null;
  const fromEmbed = async () => {
    embedLookup = await lookupEmbed(video.author, video.permlink);
    embed = embedLookup.doc || null;
    const hiveRef = embed && parseEmbedUrl(embed.embed_url);
    if (hiveRef) post = await fetchHivePost(hiveRef.author, hiveRef.permlink);
  };
  if (video.kind === 'shorts') {
    await fromEmbed();
    if (!embed) {
      hiveLookup = await lookupHivePost(video.author, video.permlink);
      post = hiveLookup.post || null;
    }
  } else {
    hiveLookup = await lookupHivePost(video.author, video.permlink);
    post = hiveLookup.post || null;
    if (!post) await fromEmbed();
  }

  if (!post && !embed) {
    return hiveLookup && hiveLookup.missing && embedLookup && embedLookup.missing ? { missing: true } : null;
  }

  const meta = post ? parseMeta(post.json_metadata) : {};
  const videoInfo = (meta.video && meta.video.info) || {};

  // A video posted as a Hive reply is usually a short (a snap or wave). Opened
  // as /watch?v=<author>/<post>, it is still the short: ask the checker, which
  // knows the post by its Hive address too, so the page names /shorts as its
  // canonical instead of competing with it.
  if (!embed && post && post.parent_author && meta.video) {
    const asShort = await lookupEmbed(post.author, post.permlink);
    if (asShort.doc && asShort.doc.short === true) embed = asShort.doc;
  }
  const isShort = video.kind === 'shorts' || !!(embed && embed.short === true);

  // Thumbnail: embed doc's thumbnail_url wins (it's the one the app shows for
  // shorts), then the Hive post's sourceMap/image, then the site fallback.
  let thumbnail = (embed && embed.thumbnail_url) || null;
  if (!thumbnail && videoInfo.sourceMap) {
    const thumbSource = videoInfo.sourceMap.find((s) => s.type === 'thumbnail');
    if (thumbSource) thumbnail = thumbSource.url;
  }
  if (!thumbnail && meta.image && meta.image[0]) thumbnail = meta.image[0];
  const image = boundImage(fixThumbnail(thumbnail));

  const kindLabel = isShort ? 'Short' : 'Video';
  // A short is a Hive REPLY (to a snaps/waves container), titled "RE: Snaps
  // Container // <date>". That says nothing about the short, so a reply's own
  // title only counts when nothing better exists: the caption the creator
  // wrote, i.e. the first line of the post.
  const isReply = !!(post && post.parent_author);
  const title =
    (post && !isReply && post.title) ||
    (embed && (embed.hive_title || embed.embed_title)) ||
    (post && firstLine(post.body)) ||
    (embed && embed.originalFilename) ||
    `${kindLabel} by @${video.author}`;

  const description = post
    ? extractDescription(post.body)
    : `A ${kindLabel.toLowerCase()} by @${video.author} on 3Speak.`;

  // og:url is the exact route that was shared (a video at /@author/permlink,
  // whichever of its two addresses was used; /shorts or /shorts/stories),
  // keeping the original permlink so the link opens right.
  const selfUrl = video.kind === 'watch'
    ? `${origin}/@${video.author}/${video.permlink}`
    : `${origin}/${video.routePath}?v=${video.author}/${video.permlink}`;
  // rel=canonical is ONE address per video, whichever way it was reached:
  //   - a short by its asset id, as the sitemap lists it. Its Hive post body
  //     links /shorts?v=<author>/<hive permlink>, which is the same short.
  //   - a video by its Hive post (/@a/p and the embed asset id fold into it),
  //     an embed-only video by its asset.
  //   - /shorts/stories is the story-feed view of the same short.
  let canonicalPath;
  if (isShort) {
    canonicalPath = embed && embed.owner && embed.permlink
      ? `shorts?v=${embed.owner}/${embed.permlink}`
      : `shorts?v=${video.author}/${video.permlink}`;
  } else if (post) {
    canonicalPath = `@${post.author}/${post.permlink}`;
  } else {
    canonicalPath = `@${embed.owner || video.author}/${embed.permlink || video.permlink}`;
  }
  const canonicalUrl = resolveCanonical(meta, `${CANONICAL_ORIGIN}/${canonicalPath}`);
  const duration = videoInfo.duration || (embed && embed.duration) || null;
  const uploadDate = toIsoDate((post && post.created) || (embed && embed.createdAt));

  // Indexability: full signal set when there's a Hive post; for embed-only
  // assets fall back to the NSFW flag + title heuristic.
  const indexability = post ? getIndexability(post, meta) : null;
  // A Hive post with no video in it (a text post opened as /@author/permlink)
  // is not a video page: kept out of the index rather than offered as one.
  const isVideo = !!embed || !!meta.video || /speak/i.test(String(meta.app || ''));
  const index = post
    ? indexability.index && isVideo
    : !(embed && embed.isNsfwContent) && !isAdultByTitle(title);
  // Inline playback follows the same NSFW/muted/blacklist rules, but not the
  // SEO-only "empty" one: a short posted as an Ecency wave is a reply with a
  // one-line body, which is thin for Google and perfectly fine for Discord.
  const inlineAllowed =
    (index || (indexability && indexability.reason === 'empty')) &&
    !(embed && (embed.gated === true || embed.gated === 'true'));
  return {
    post, embed, meta, image, title, description, selfUrl, canonicalUrl,
    duration, uploadDate, index, indexability, inlineAllowed,
  };
}

const server = http.createServer(async (req, res) => {
  const origin = requestOrigin(req);

  // Lightweight health probe for systemd / curl checks.
  if (req.url === '/og-health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  let url;
  try {
    url = new URL(req.url, origin);
  } catch (_) {
    return sendHtml(req, res, 200, buildGenericHtml(origin));
  }

  // The teaser MP4 behind og:video. nginx sends this path here for every UA:
  // Discord fetches it through its media proxy and from clients directly.
  if (url.pathname === ogVideo.THUMB_PATH) {
    try {
      return await ogVideo.serveThumb(req, res, url);
    } catch (err) {
      console.error('[og] thumb error:', err && err.message);
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end();
    }
  }

  if (url.pathname === PUBLIC_OEMBED_PATH) {
    try {
      return await servePublicOembed(req, res, url, origin);
    } catch (err) {
      console.error('[og] public oembed error:', err && err.message);
      return sendOembedError(req, res, 500, 'oEmbed lookup failed');
    }
  }

  if (url.pathname === OEMBED_PATH) {
    try {
      return await serveOembed(req, res, url, origin);
    } catch (err) {
      console.error('[og] oembed error:', err && err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end();
    }
  }

  if (ogVideo.isMediaPath(url.pathname)) {
    try {
      return await ogVideo.serveMedia(req, res, url.pathname);
    } catch (err) {
      console.error('[og-video] serve error:', err && err.message);
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Retry-After': '30' });
      }
      return res.end();
    }
  }

  // What 3Speak is (/ and /about, AI agents and Bingbot per nginx). See og-site.cjs.
  if (ogSite.isSitePath(url.pathname)) {
    try {
      return await ogSite.serveSitePage(req, res, url, origin);
    } catch (err) {
      console.error('[og] site page error:', err && err.message);
      return sendHtml(req, res, 200, buildGenericHtml(origin + req.url));
    }
  }

  const pageCard = PAGE_CARDS[url.pathname.replace(/\/+$/, '')];
  if (pageCard) {
    return sendHtml(req, res, 200, buildGenericHtml(origin + url.pathname, { ...pageCard, image: origin + pageCard.image }));
  }

  const page = ogPages.match(url);
  if (page) {
    try {
      const html = await ogPages.render(req, res, page, origin);
      if (html === ogPages.MISSING) return sendMissing(req, res, origin, url);
      if (!html) return sendUnavailable(req, res, origin, url);
      return sendHtml(req, res, 200, html);
    } catch (err) {
      console.error(`[og] ${page.kind} page error:`, err && err.message);
      return sendUnavailable(req, res, origin, url);
    }
  }

  // Feed and topic pages (/trend, /new, /t/:tag, /community/:id, ...): their
  // videos as plain links. See og-lists.cjs.
  const list = ogLists.match(url);
  if (list) {
    try {
      const html = await ogLists.render(req, list, origin);
      if (html === ogLists.MISSING) return sendMissing(req, res, origin, url);
      if (!html) return sendUnavailable(req, res, origin, url);
      return sendHtml(req, res, 200, html);
    } catch (err) {
      console.error(`[og] ${list.kind} list error:`, err && err.message);
      return sendUnavailable(req, res, origin, url);
    }
  }

  try {
    const video = parseVideoUrl(url);
    // /watch with no video named (or a broken ?v=) is not a page of its own.
    if (!video) return sendHtml(req, res, 200, buildGenericHtml(origin + req.url, GENERIC_CARD, { noindex: true }));

    // Started now so the probe overlaps the Hive/checker lookups below. It only
    // resolves + probes (cached per rendition); the teaser build starts further
    // down, once the page is known to be allowed to carry the video.
    const videoBot = ogVideo.wantsVideo(req.headers['user-agent']);
    const inlineVideo = videoBot
      ? ogVideo.ogVideoFor(video.author, video.permlink).catch(() => null)
      : Promise.resolve(null);

    const card = await resolveVideoCard(video, origin);
    if (card && card.missing) return sendMissing(req, res, origin, url);
    if (!card) return sendUnavailable(req, res, origin, url);
    const {
      post, meta, title, description, selfUrl, canonicalUrl, duration, uploadDate, index, inlineAllowed,
    } = card;
    let { image } = card;
    // WhatsApp shows no preview at all for a WebP image (every 3Speak
    // thumbnail is WebP), and may read video.other as "a video" it can't
    // play. It gets a JPEG copy and a plain website card instead.
    const whatsapp = /whatsapp/i.test(req.headers['user-agent'] || '');
    const waThumb = whatsapp ? ogVideo.jpegThumbPath(image) : null;
    if (waThumb) image = origin + waThumb;

    // Transcripts only exist for Hive-backed videos; fetch by the resolved Hive
    // author/permlink (not the embed asset id), and skip on noindex pages.
    let transcript = null;
    let transcriptLang = null;
    let subtitleLanguages = null;
    let comments = [];
    let related = [];
    let contentUrl = null;
    let gone = false;
    let inline = null;
    // Transcript + comments are for search engines; Discord shows neither, and
    // it gives up on a slow unfurl. Skipping them for the video bot keeps its
    // card at "lookup + teaser build" even when the translate API hangs
    // (seen 2026-10-02: every Discord card waited out the 6s transcript budget).
    if (post && index && !videoBot) {
      // All hang off the same Hive post; fetch them together rather than
      // adding each round-trip on top of the transcript's.
      const [t, c, v, r, m, d] = await Promise.all([
        fetchTranscript(post.author, post.permlink),
        fetchComments(post.author, post.permlink),
        inlineVideo,
        fetchRelated(post.author, post.permlink),
        inlineAllowed ? ogVideo.manifestUrl(video.author, video.permlink) : null,
        card.embed ? { doc: card.embed } : lookupEmbed(post.author, post.permlink),
      ]);
      if (inlineAllowed) inline = v;
      related = r;
      contentUrl = m;
      // The post stands but the video does not: the checker marks a video
      // `unavailable` only once EVERY gateway answers a definite 404
      // (3speakchecks utils/unavailable.js), and `deleted` is the creator's.
      // A failed lookup proves nothing and keeps the page indexed.
      const doc = d && d.doc;
      gone = !!doc && (doc.unavailable === true || doc.status === 'deleted');
      transcript = (t && t.text) || null;
      transcriptLang = (t && t.lang) || null;
      subtitleLanguages = (t && t.languages) || null;
      comments = c;
    } else if (inlineAllowed) {
      inline = await inlineVideo;
    }
    // Discord fetches the MP4 the moment it unfurls and gives up if it's slow,
    // so its card waits for the teaser build (2-4s typically, capped). Other
    // apps get the card at once (WhatsApp drops slow previews); the build runs
    // in the background and the media route waits for it if they ask early.
    if (inline) {
      const discord = /discordbot/i.test(req.headers['user-agent'] || '');
      await inline.prepare(discord ? 8000 : 0);
      rememberOembed(`${video.author}/${video.permlink}`, { description, url: canonicalUrl });
    }

    const html = buildOgHtml({
      title,
      description,
      image,
      url: selfUrl,
      canonical: canonicalUrl,
      duration,
      author: video.author,
      noindex: !index || gone,
      uploadDate,
      // The same player the oEmbed and the sitemap hand out.
      embedUrl: playerUrlFor(video),
      contentUrl,
      // Each chapter links to the canonical watch page + &t=, so only when that
      // page is ours (a post may declare a canonical_url elsewhere).
      chapters: canonicalUrl.startsWith(`${CANONICAL_ORIGIN}/watch?`) ? videoChapters(meta, duration) : [],
      tags: videoTags(meta),
      related,
      origin,
      transcript,
      transcriptLang,
      subtitleLanguages,
      comments,
      commentCount: post && typeof post.children === 'number' ? post.children : undefined,
      video: inline ? { url: origin + inline.path, width: inline.width, height: inline.height } : null,
      ogType: whatsapp ? 'website' : 'video.other',
      imageType: waThumb ? 'image/jpeg' : undefined,
      oembedUrl: inline
        ? `${origin}${OEMBED_PATH}?v=${encodeURIComponent(`${video.author}/${video.permlink}`)}`
        : inlineAllowed ? publicOembedUrl(origin, canonicalUrl) : null,
      // Iframe player for Misskey & co. Not with the teaser: Discord gets its
      // MP4 player card instead.
      player: !inline && inlineAllowed && !whatsapp
        ? {
          url: playerUrlFor(video),
          ...playerSize(video),
          ogVideo: PLAYER_OG_VIDEO_BOTS.test(req.headers['user-agent'] || ''),
        }
        : null,
    });

    return sendHtml(req, res, 200, html);
  } catch (err) {
    console.error('[og] error:', err && err.message);
    // Never fail the bot: a link preview degrades to the generic card, a
    // search engine is told to come back.
    return sendUnavailable(req, res, origin, url);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`3Speak OG prerender service running on 127.0.0.1:${PORT}`);
  setTimeout(ogSite.warm, 5000);
});
