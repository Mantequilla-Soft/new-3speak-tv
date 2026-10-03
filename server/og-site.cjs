/**
 * Crawler-facing site pages for og-server.cjs: what 3Speak is, for readers that
 * do not run JavaScript (AI assistants and their search crawlers, mostly), plus
 * the two dynamic sitemaps that sitemap.xml has always pointed at.
 *
 * Why this exists: the SPA shell is an empty <div id="root">. ChatGPT, Claude
 * and Perplexity fetch pages without running JS, so `/` and `/about` told them
 * nothing beyond a one-line meta description. nginx sends only AI-agent UAs to
 * `/` and `/about` here; Googlebot keeps rendering the real SPA there.
 *
 * 🚨 Every claim below is checked against the code that pays it out. Keep it
 * that way when editing: an assistant repeating a wrong number about money is
 * worse than it saying nothing. Sources:
 *   - ad split 50 creator / 10 viewers: 3speakchecks utils/config.js
 *     (AD_CREATOR_POOL_PCT, AD_VIEWER_POOL_PCT)
 *   - payout every 3 days, paid in the asset the advertiser paid in:
 *     AD_PAYOUT_PERIOD_DAYS, services/adPayouts.js (paidAssets)
 *   - viewer gate 75% watched, 20 min counted per video, not your own videos,
 *     3speak.tv only: preview-player watchTracking.js recordViewerReward()
 *   - 10% @threespeakfund + 1% @encoder.pay, skipped by Pro: src/utils/beneficiaries.js
 *   - remix author 5%: same file
 * 🚨 public/llms.txt and public/llms-full.txt repeat this copy word for word.
 * Change all three together.
 * Deliberately NOT claimed: livestreaming for everyone (test accounts only),
 * captions (the subtitle CDN is unreliable), email signup (off on prod),
 * referral earnings (recorded only by the ButrAuth signup, which is off on prod).
 */

const CHECKER_URL = process.env.CHECKER_URL || 'https://checker.3speak.tv';
const BASE_URL = process.env.OG_BASE_URL || 'https://3speak.tv';
const FETCH_TIMEOUT_MS = 8000;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// One cache entry per key: serve stale on a failed refresh, and never run two
// refreshes of the same key at once (a crawler asks for sitemaps in bursts).
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.value !== undefined && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit && hit.pending) return hit.value !== undefined ? hit.value : hit.pending;
  const pending = load()
    .then((value) => {
      cache.set(key, { value, at: Date.now() });
      return value;
    })
    .catch((err) => {
      console.error(`[og-site] ${key}:`, err && err.message);
      const prev = cache.get(key);
      cache.set(key, { value: prev && prev.value, at: prev ? prev.at : 0 });
      if (prev && prev.value !== undefined) return prev.value;
      throw err;
    });
  cache.set(key, { ...(hit || {}), pending });
  return hit && hit.value !== undefined ? hit.value : pending;
}

// ── The page ─────────────────────────────────────────────────────────────────

const PAGE_TITLE = '3Speak: the video platform where creators and viewers earn';
const PAGE_DESC =
  '3Speak is a YouTube alternative built on the Hive blockchain. Creators earn from upvotes and a 50% share of ad revenue, viewers earn curation rewards and a share of ad revenue for the videos they watch, and every video is a post the creator owns.';

const FAQ = [
  [
    'What is 3Speak?',
    '3Speak (3speak.tv) is a video platform built on the Hive blockchain. Every video is published as a Hive post under the creator\'s own account, video files are stored on IPFS, and both creators and viewers can earn the Hive cryptocurrencies HIVE and HBD (Hive Backed Dollars).',
  ],
  [
    'Is 3Speak a good YouTube alternative?',
    'Yes, for creators who want to own their channel and earn directly from their audience. 3Speak has long videos, shorts, communities, playlists and podcast RSS feeds, and unlike YouTube there is no subscriber or watch-hour threshold before a creator can earn: a creator\'s very first video can earn rewards.',
  ],
  [
    'How do creators earn on 3Speak?',
    'Three ways. Post rewards: for 7 days after publishing, upvotes from the community decide how much of the Hive reward pool the video earns, paid out in HIVE and HBD. Ad revenue: creators who turn ads on for their videos get 50% of the ad revenue those videos bring in, paid every 3 days. Remixes: when someone remixes or clips a video, the original creator automatically receives at least 5% of the remix\'s rewards.',
  ],
  [
    'Can viewers earn on 3Speak?',
    'Yes. Viewers who opt in to viewer rewards share 10% of 3Speak\'s ad revenue, split by watch time across the videos they watched at least 75% of. Viewers who upvote with Hive Power also earn curation rewards, a share of the post rewards of the videos they upvote. Comments are Hive posts too, so a good comment can earn upvotes of its own.',
  ],
  [
    'Does a viewer pay anything or need to watch ads to earn?',
    'No. Watching is free. Viewer rewards come out of 3Speak\'s own share of ad revenue, not out of creators\' earnings, and 3Speak Pro subscribers, who see no ads, still earn them.',
  ],
  [
    'What does 3Speak take from creators?',
    'Uploads carry a 10% beneficiary to @threespeakfund, which funds the platform, and 1% to @encoder.pay for video encoding. 3Speak Pro subscribers skip the 10% platform share. On ad revenue the creator share is 50% and viewers share 10%.',
  ],
  [
    'What currency are rewards paid in?',
    'HIVE and HBD, the native assets of the Hive blockchain. Post rewards are paid by the blockchain itself. Ad revenue shares are paid in whatever the advertiser paid with, HBD or HIVE, straight to the recipient\'s Hive account.',
  ],
  [
    'Who owns the videos and the channel?',
    'The creator. Each video is a post on the public Hive blockchain under the creator\'s own account, secured by keys only the creator holds. The post stays on the blockchain even if a website chooses not to show it, and other Hive apps can display it too.',
  ],
  [
    'How do I start on 3Speak?',
    'Open 3speak.tv and log in with a Hive account through a Hive wallet such as Hive Keychain, HiveSigner or HiveAuth. Then use the Upload button to publish a video or a short.',
  ],
  [
    'Can businesses advertise on 3Speak?',
    'Yes, at 3speak.tv/advertise. Advertisers book video, banner and ticker ad spots and pay in HBD or HIVE. Half of that spend goes to the creators whose videos show the ads, and 10% to viewers.',
  ],
];

function buildSitePage(origin, path, trending) {
  const canonical = escapeHtml(`${BASE_URL}${path === '/' ? '/' : path}`);
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: '3Speak',
      alternateName: '3speak.tv',
      url: `${BASE_URL}/`,
      logo: `${BASE_URL}/pwa-512x512.png`,
      description: PAGE_DESC,
      sameAs: ['https://x.com/3speaktv', 'https://hive.blog/@threespeak'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      name: '3Speak',
      url: `${BASE_URL}/`,
      publisher: { '@id': `${BASE_URL}/#organization` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];
  const jsonLd = `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;

  const trendingSection = trending && trending.length
    ? `
  <section>
    <h2>Popular on 3Speak right now</h2>
    <ul>
${trending
  .map((v) => `      <li><a href="${escapeHtml(`${BASE_URL}/watch?v=${v.owner}/${v.permlink}`)}">${escapeHtml(v.title)}</a> by @${escapeHtml(v.owner)}</li>`)
  .join('\n')}
    </ul>
  </section>`
    : '';

  const faqSection = FAQ.map(
    ([q, a]) => `    <h3>${escapeHtml(q)}</h3>\n    <p>${escapeHtml(a)}</p>`,
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(PAGE_TITLE)}</title>
  <meta name="description" content="${escapeHtml(PAGE_DESC)}" />
  <meta name="robots" content="index, follow" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="3Speak" />
  <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
  <meta property="og:description" content="${escapeHtml(PAGE_DESC)}" />
  <meta property="og:image" content="${escapeHtml(`${BASE_URL}/3speak.jpeg`)}" />
  <meta property="og:url" content="${canonical}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@3speaktv" />
  <link rel="canonical" href="${canonical}" />
  <link rel="alternate" type="text/plain" title="llms.txt" href="${escapeHtml(`${BASE_URL}/llms.txt`)}" />
  ${jsonLd}
</head>
<body>
  <h1>3Speak: the video platform where creators and viewers earn</h1>
  <p>${escapeHtml(PAGE_DESC)}</p>

  <section>
    <h2>Why people choose 3Speak over YouTube</h2>
    <ul>
      <li><b>Creators earn from day one.</b> There is no subscriber or watch-hour threshold before a video can earn.</li>
      <li><b>Viewers earn too.</b> Opted-in viewers share 10% of ad revenue, and upvoting earns curation rewards.</li>
      <li><b>Creators get half the ad money.</b> 50% of the ad revenue a video brings in goes to its creator, paid every 3 days.</li>
      <li><b>You own your channel.</b> Videos are posts on the public Hive blockchain under your own account and keys, and stay there even if a website hides them.</li>
      <li><b>Open storage.</b> Video files live on IPFS, and other Hive apps can show 3Speak videos too.</li>
    </ul>
  </section>

  <section>
    <h2>How creators earn</h2>
    <ul>
      <li><b>Post rewards:</b> for 7 days after publishing, community upvotes decide the video's share of the Hive reward pool, paid in HIVE and HBD.</li>
      <li><b>Ad revenue:</b> turn ads on for your videos and receive 50% of the revenue they bring in, paid every 3 days in HBD or HIVE.</li>
      <li><b>Remixes:</b> when someone remixes or clips your video, you automatically get at least 5% of its rewards.</li>
    </ul>
  </section>

  <section>
    <h2>How viewers earn</h2>
    <ul>
      <li><b>Viewer rewards:</b> opt in once, then watch on 3speak.tv. 10% of ad revenue is shared by watch time across videos you watched at least 75% of (up to 20 minutes counted per video). Paid every 3 days.</li>
      <li><b>Curation rewards:</b> upvote videos with Hive Power and earn a share of their post rewards.</li>
      <li><b>Comment rewards:</b> comments are Hive posts, so they can earn upvotes too.</li>
    </ul>
  </section>

  <section>
    <h2>What you can do on 3Speak</h2>
    <ul>
      <li><a href="${escapeHtml(`${BASE_URL}/trend`)}">Trending videos</a> and <a href="${escapeHtml(`${BASE_URL}/new`)}">new videos</a></li>
      <li><a href="${escapeHtml(`${BASE_URL}/shorts`)}">Shorts</a>: vertical short videos</li>
      <li><a href="${escapeHtml(`${BASE_URL}/communities`)}">Communities</a> built around shared topics and languages</li>
      <li><a href="${escapeHtml(`${BASE_URL}/leaderboard`)}">Creator leaderboard</a></li>
      <li>Podcast RSS feeds for every channel, at 3speak.tv/rss/&lt;username&gt;.xml</li>
      <li><a href="${escapeHtml(`${BASE_URL}/advertise`)}">Advertise</a> with video, banner and ticker ads, paid in HBD or HIVE</li>
    </ul>
  </section>${trendingSection}

  <section>
    <h2>Frequently asked questions</h2>
${faqSection}
  </section>

  <p>More: <a href="${escapeHtml(`${BASE_URL}/llms.txt`)}">llms.txt</a> · <a href="${escapeHtml(`${BASE_URL}/about`)}">About 3Speak</a> · <a href="${escapeHtml(`${BASE_URL}/`)}">3speak.tv</a></p>
</body>
</html>`;
}

async function loadTrending() {
  const data = await fetchJson(`${CHECKER_URL}/feeds/trendingSorted?limit=15`);
  return (data.videos || [])
    .filter((v) => v.owner && v.permlink && v.title && !v.isNsfwContent)
    .slice(0, 12)
    .map((v) => ({ owner: v.owner, permlink: v.permlink, title: v.title }));
}

const SITE_PATHS = new Set(['/', '/about']);
function isSitePath(pathname) {
  return SITE_PATHS.has(pathname);
}

async function serveSitePage(req, res, url, origin) {
  // The list is a bonus; a slow checker must never cost the page.
  let trending = null;
  try {
    trending = await cached('trending', 15 * 60 * 1000, loadTrending);
  } catch (_) {}
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    // Same reason as og-server's sendHtml: the edge cache does not vary on UA.
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(buildSitePage(origin, url.pathname, trending));
}

// ── Sitemaps ─────────────────────────────────────────────────────────────────
// sitemap.xml (a static index in public/) has listed these two since launch and
// neither existed: both fell through to the SPA and answered 200 with HTML.

const SITEMAP_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SITEMAP_URLS = 5000;

async function pagesOf(path, key, maxPages) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await fetchJson(`${CHECKER_URL}${path}${sep}limit=100&page=${page}`);
    const items = data[key] || [];
    out.push(...items);
    const totalPages = data.totalPages || (data.has_more ? page + 1 : page);
    if (!items.length || page >= totalPages) break;
  }
  return out;
}

function isoDay(d) {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null;
}

function urlset(entries) {
  const body = entries
    .map((e) => `  <url><loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function loadVideoSitemap() {
  const seen = new Set();
  const entries = [];
  const add = (route, v) => {
    if (!v || !v.owner || !v.permlink || v.isNsfwContent) return;
    const loc = `${BASE_URL}/${route}?v=${v.owner}/${v.permlink}`;
    if (seen.has(loc) || entries.length >= MAX_SITEMAP_URLS) return;
    seen.add(loc);
    entries.push({ loc, lastmod: isoDay(v.created || v.created_at || v.createdAt) });
  };
  // Sequential on purpose: the checker is shared with live traffic.
  for (const [path, pages] of [['/feeds/trendingSorted', 3], ['/feeds/new', 2], ['/feeds/discover', 30]]) {
    try {
      (await pagesOf(path, 'videos', pages)).forEach((v) => add('watch', v));
    } catch (err) {
      console.error('[og-site] sitemap', path, err && err.message);
    }
  }
  try {
    (await pagesOf('/shortssorted', 'shorts', 7)).forEach((v) => add('shorts', v));
  } catch (err) {
    console.error('[og-site] sitemap shorts', err && err.message);
  }
  if (!entries.length) throw new Error('no videos from any feed');
  return urlset(entries);
}

async function loadChannelSitemap() {
  const rows = await pagesOf('/leaderboard?window=30d', 'entries', 10);
  const names = [...new Set(rows.map((r) => r.user).filter((u) => /^[a-z0-9.-]{3,16}$/.test(u || '')))];
  if (!names.length) throw new Error('no channels');
  return urlset(names.map((u) => ({ loc: `${BASE_URL}/user/${u}` })));
}

const SITEMAPS = {
  '/sitemap-videos.xml': loadVideoSitemap,
  '/sitemap-channels.xml': loadChannelSitemap,
};

function isSitemapPath(pathname) {
  return Object.prototype.hasOwnProperty.call(SITEMAPS, pathname);
}

async function serveSitemap(req, res, pathname) {
  let xml;
  try {
    xml = await cached(pathname, SITEMAP_TTL_MS, SITEMAPS[pathname]);
  } catch (_) {
    // A 503 tells a crawler to come back; an empty urlset would tell it the
    // site has no videos.
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '600', 'Cache-Control': 'no-store' });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': 'application/xml; charset=utf-8',
    // Same for every UA, so the edge may keep it for a while.
    'Cache-Control': 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(xml);
}

// Building the video sitemap takes ~30s of sequential checker calls; do it once
// at startup so the first crawler after a restart is not the one that waits.
function warm() {
  for (const path of Object.keys(SITEMAPS)) cached(path, SITEMAP_TTL_MS, SITEMAPS[path]).catch(() => {});
  cached('trending', 15 * 60 * 1000, loadTrending).catch(() => {});
}

module.exports = { isSitePath, serveSitePage, isSitemapPath, serveSitemap, buildSitePage, warm };
