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
// This is a near-verbatim port of the Vercel Edge Middleware in ../middleware.js
// (which only runs on Vercel and is dead in our Vite-dev / static-nginx deploys),
// re-expressed as a plain Node http server and EXTENDED to also cover the
// /shorts?v=author/permlink route. Keep the two in sync if you touch either.
//
// Deps: none — Node 18+ global fetch / AbortController only (run with /usr/bin/node v18;
// nvm v22 segfaults on this box — see the preview-3speak-api service notes).

const http = require('http');
const ogVideo = require('./og-video.cjs');

const PORT = process.env.OG_PORT || 4023;
const HIVE_API = 'https://api.hive.blog';
const BUNNY_IPFS_CDN = 'https://hotipfs-3speak-1.b-cdn.net';
// Base for author/publisher links + the fallback logo. og:url / canonical are
// derived from the *request* host instead (so a shared preview link points back
// to preview, and a prod link to prod) — see requestOrigin().
const BASE_URL = process.env.OG_BASE_URL || 'https://3speak.tv';
const FALLBACK_THUMBNAIL = `${BASE_URL}/3speak.jpeg`;
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
];

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
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
      const [author, ...rest] = v.split('/');
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
    const [, author, permlink] = atMatch;
    if (permlink === 'shorts') return null; // shorts listing page, not a video
    return { author, permlink, kind: 'watch', routePath: 'watch' };
  }

  return null;
}

async function fetchHivePost(author, permlink) {
  const res = await fetch(HIVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'bridge.get_post',
      params: { author, permlink, observer: '' },
      id: 1,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const post = data && data.result;
  if (!post || !post.author || post.author === '') return null;
  return post;
}

/**
 * Resolve an embed-video doc from the checker (/videodetails/:owner/:permlink).
 * Returns the raw doc or null. Time-boxed — never blocks the bot response long.
 * The matching `videos`/`embed-video` collections key on owner+permlink (asset
 * id) OR hive_author+hive_permlink, so it works for the share URL's id directly.
 */
async function fetchEmbedDetails(owner, permlink) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(
      `${CHECKER_URL}/videodetails/${encodeURIComponent(owner)}/${encodeURIComponent(permlink)}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc || typeof doc !== 'object' || (!doc.permlink && !doc.owner)) return null;
    return doc;
  } catch (_) {
    return null;
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
    return `${BUNNY_IPFS_CDN}/ipfs/${hash}`;
  }

  if (t.includes('ipfs-3speak.b-cdn.net')) {
    return t.replace('https://ipfs-3speak.b-cdn.net', BUNNY_IPFS_CDN);
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

function secondsToISO8601(sec) {
  const total = Math.round(Number(sec) || 0);
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}` || 'PT0S';
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

// Subtitle files live on IPFS, and the hot CDN 500s ("block was not found
// locally") for anything it hasn't pinned yet — as of 2026-08 that is EVERY
// subtitle file, which is why the transcript section silently never rendered
// despite this code existing. The checker's /subtitle-proxy fetches the CID
// server-side, falling through the gateways to the ingest node's own IPFS API,
// so it answers when the CDN doesn't.
async function fetchSrt(cid, signal) {
  try {
    const direct = await fetch(`${BUNNY_IPFS_CDN}/ipfs/${cid}`, { signal });
    if (direct.ok) return await direct.text();
  } catch (_) { /* fall through to the proxy */ }
  try {
    const proxied = await fetch(`${CHECKER_URL}/subtitle-proxy/${cid}`, { signal });
    if (proxied.ok) return await proxied.text();
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

function buildOgHtml({
  title,
  description,
  image,
  url,
  duration,
  author,
  noindex,
  uploadDate,
  embedUrl,
  transcript,
  transcriptLang,
  subtitleLanguages,
  comments,
  commentCount,
  video,
}) {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safeUrl = escapeHtml(url);
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

  const robotsMeta = noindex
    ? '<meta name="robots" content="noindex, follow" />'
    : '<meta name="robots" content="index, follow" />';

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: title,
    description: description || title,
    thumbnailUrl: image,
    contentUrl: url,
    embedUrl,
    url,
    author: { '@type': 'Person', name: `@${author}`, url: `${BASE_URL}/user/${author}` },
    publisher: {
      '@type': 'Organization',
      name: '3Speak',
      logo: { '@type': 'ImageObject', url: FALLBACK_THUMBNAIL },
    },
  };
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
  const jsonLd = `<script type="application/ld+json">${JSON.stringify(ld).replace(
    /</g,
    '\\u003c',
  )}</script>`;

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle} - 3Speak</title>
  ${robotsMeta}

  <!-- Open Graph -->
  <meta property="og:type" content="video.other" />
  <meta property="og:site_name" content="3Speak" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:url" content="${safeUrl}" />
  ${durationMeta}${videoMeta}

  <!-- Twitter Card -->
  ${twitterCard}
  <meta name="twitter:site" content="@3speaktv" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeImage}" />

  <link rel="canonical" href="${safeUrl}" />

  ${jsonLd}
</head>
<body>
  <h1>${safeTitle}</h1>
  <p><a href="${safeUrl}">${safeTitle}</a> by @${safeAuthor} on <a href="${escapeHtml(BASE_URL)}">3Speak</a></p>
  <p>${safeDesc}</p>${transcriptSection}${commentsSection}
</body>
</html>`;
}

// Generic site card — returned for bots on non-video URLs (or on any error),
// so the worst case is identical to today's static index.html defaults rather
// than a broken response. Mirrors index.html's primary OG/Twitter tags.
function buildGenericHtml(siteUrl) {
  const url = escapeHtml(siteUrl);
  const title = '3S | Real People - Real Stories';
  const desc =
    '3Speak is a decentralized video sharing platform built on blockchain technology. Watch, upload, and share videos while earning cryptocurrency rewards.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="robots" content="index, follow" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="3Speak" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${FALLBACK_THUMBNAIL}" />
  <meta property="og:url" content="${url}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@3speaktv" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${FALLBACK_THUMBNAIL}" />
  <link rel="canonical" href="${url}" />
</head>
<body><h1>${title}</h1><p>${desc}</p></body>
</html>`;
}

// Reconstruct the public origin from the proxy headers nginx forwards
// (X-Forwarded-Proto + Host) so og:url/canonical match the host that was
// actually shared — preview on preview, prod on prod.
function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['host'] || '3speak.tv').split(',')[0].trim();
  return `${proto}://${host}`;
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

  try {
    const video = parseVideoUrl(url);
    if (!video) return sendHtml(req, res, 200, buildGenericHtml(origin + req.url));

    // Started now so the probe overlaps the Hive/checker lookups below. It only
    // resolves + probes (cached per rendition); the teaser build starts further
    // down, once the page is known to be allowed to carry the video.
    const videoBot = ogVideo.wantsVideo(req.headers['user-agent']);
    const inlineVideo = videoBot
      ? ogVideo.ogVideoFor(video.author, video.permlink).catch(() => null)
      : Promise.resolve(null);

    // Resolve the Hive post and/or the embed-video doc. Shorts (and some embed
    // videos) aren't Hive posts — the share URL's permlink is the embed *asset*
    // id, so a Hive lookup by it 404s. Strategy:
    //   - /shorts: resolve the embed doc first, then the Hive post via embed_url.
    //   - /watch & /@: try Hive directly; only on a miss fall back to the embed
    //     doc (cheap, and avoids a checker call for ordinary videos).
    let post = null;
    let embed = null;
    if (video.kind === 'shorts') {
      embed = await fetchEmbedDetails(video.author, video.permlink);
      const hiveRef = embed && parseEmbedUrl(embed.embed_url);
      if (hiveRef) post = await fetchHivePost(hiveRef.author, hiveRef.permlink);
    } else {
      post = await fetchHivePost(video.author, video.permlink);
      if (!post) {
        embed = await fetchEmbedDetails(video.author, video.permlink);
        const hiveRef = embed && parseEmbedUrl(embed.embed_url);
        if (hiveRef) post = await fetchHivePost(hiveRef.author, hiveRef.permlink);
      }
    }

    if (!post && !embed) return sendHtml(req, res, 200, buildGenericHtml(origin + req.url));

    const meta = post ? parseMeta(post.json_metadata) : {};
    const videoInfo = (meta.video && meta.video.info) || {};

    // Thumbnail: embed doc's thumbnail_url wins (it's the one the app shows for
    // shorts), then the Hive post's sourceMap/image, then the site fallback.
    let thumbnail = (embed && embed.thumbnail_url) || null;
    if (!thumbnail && videoInfo.sourceMap) {
      const thumbSource = videoInfo.sourceMap.find((s) => s.type === 'thumbnail');
      if (thumbSource) thumbnail = thumbSource.url;
    }
    if (!thumbnail && meta.image && meta.image[0]) thumbnail = meta.image[0];
    const image = boundImage(fixThumbnail(thumbnail));

    const kindLabel = video.kind === 'shorts' ? 'Short' : 'Video';
    const title =
      (post && post.title) ||
      (embed && (embed.hive_title || embed.embed_title || embed.originalFilename)) ||
      `${kindLabel} by @${video.author}`;

    const description = post
      ? extractDescription(post.body)
      : `A ${kindLabel.toLowerCase()} by @${video.author} on 3Speak.`;

    // Canonicalize to the exact route that was shared (/watch, /shorts or
    // /shorts/stories), keeping the original permlink so the link opens right.
    const selfUrl = `${origin}/${video.routePath}?v=${video.author}/${video.permlink}`;
    const canonicalUrl = resolveCanonical(meta, selfUrl);
    const duration = videoInfo.duration || (embed && embed.duration) || null;
    const uploadDate = toIsoDate((post && post.created) || (embed && embed.createdAt));

    // Indexability: full signal set when there's a Hive post; for embed-only
    // assets fall back to the NSFW flag + title heuristic.
    const indexability = post ? getIndexability(post, meta) : null;
    const index = post
      ? indexability.index
      : !(embed && embed.isNsfwContent) && !isAdultByTitle(title);
    // Inline playback follows the same NSFW/muted/blacklist rules, but not the
    // SEO-only "empty" one: a short posted as an Ecency wave is a reply with a
    // one-line body, which is thin for Google and perfectly fine for Discord.
    const inlineAllowed =
      (index || (indexability && indexability.reason === 'empty')) &&
      !(embed && (embed.gated === true || embed.gated === 'true'));

    // Transcripts only exist for Hive-backed videos; fetch by the resolved Hive
    // author/permlink (not the embed asset id), and skip on noindex pages.
    let transcript = null;
    let transcriptLang = null;
    let subtitleLanguages = null;
    let comments = [];
    let inline = null;
    // Transcript + comments are for search engines; Discord shows neither, and
    // it gives up on a slow unfurl. Skipping them for the video bot keeps its
    // card at "lookup + teaser build" even when the translate API hangs
    // (seen 2026-10-02: every Discord card waited out the 6s transcript budget).
    if (post && index && !videoBot) {
      // Both hang off the same Hive post; fetch them together rather than
      // adding the comment round-trip on top of the transcript's.
      const [t, c, v] = await Promise.all([
        fetchTranscript(post.author, post.permlink),
        fetchComments(post.author, post.permlink),
        inlineVideo,
      ]);
      if (inlineAllowed) inline = v;
      transcript = (t && t.text) || null;
      transcriptLang = (t && t.lang) || null;
      subtitleLanguages = (t && t.languages) || null;
      comments = c;
    } else if (inlineAllowed) {
      inline = await inlineVideo;
    }
    // Discord fetches the MP4 the moment it unfurls and gives up if it's slow,
    // so hold the card until the teaser is built (2-4s typically, capped).
    if (inline) await inline.prepare(8000);

    const html = buildOgHtml({
      title,
      description,
      image,
      url: canonicalUrl,
      duration,
      author: video.author,
      noindex: !index,
      uploadDate,
      embedUrl: `${origin}/embed?v=${video.author}/${video.permlink}`,
      transcript,
      transcriptLang,
      subtitleLanguages,
      comments,
      commentCount: post && typeof post.children === 'number' ? post.children : undefined,
      video: inline ? { url: origin + inline.path, width: inline.width, height: inline.height } : null,
    });

    return sendHtml(req, res, 200, html);
  } catch (err) {
    console.error('[og] error:', err && err.message);
    // Never fail the bot — degrade to the generic card.
    return sendHtml(req, res, 200, buildGenericHtml(origin + req.url));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`3Speak OG prerender service running on 127.0.0.1:${PORT}`);
});
