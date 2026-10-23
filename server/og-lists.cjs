// Feed, topic and community pages for crawlers: /trend, /new, /shorts,
// /t/:tag, /groups (and /communities), /community/:id and /leaderboard.
//
// The SPA draws these from the checker in the browser, so a reader that runs
// no JavaScript (Bingbot mostly, AI crawlers, link previews) saw an empty
// shell with the homepage's title, and Googlebot had to render a 2 MB app to
// find the first link. Here each one is the same list the page shows, as plain
// links with a real title, description and canonical. Same rules as
// og-pages.cjs:
//
//   - The data is the page's own: the same checker feed and Hive call the
//     SPA makes, so what a crawler reads is what a visitor sees.
//   - A lookup that FAILED answers null (search engines are told to retry). A
//     thing that does not exist answers MISSING (a 404 for search engines):
//     an unknown community, a tag with no videos at all.
//   - rel=canonical always names the 3speak.tv page, og:url the host asked.
//   - NSFW videos are left out of every list, as the feeds leave them out.
//
// nginx must send these paths here for bot User-Agents (outside git): see the
// SEO handoff for the `location` blocks.

const HIVE_API = 'https://api.hive.blog';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const LIST_LIMIT = 40;
// A tag with fewer videos than this is a thin page: kept out of the index,
// its links still followed.
const MIN_TAG_VIDEOS = 3;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const COMMUNITY_RE = /^hive-\d{1,10}$/;

module.exports = function createLists(h) {
  const {
    CANONICAL_ORIGIN, CHECKER_URL, FALLBACK_THUMBNAIL, escapeHtml, fixThumbnail, boundImage,
    isMissingError, breadcrumbLd, ldScript, isAdultByTitle,
  } = h;

  const MISSING = Symbol('missing');

  // One entry per key; serve stale on a failed refresh. Bounded, since every
  // tag is a key of its own.
  const cache = new Map();
  async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    try {
      const value = await load();
      if (cache.size > 2000) cache.clear();
      cache.set(key, { value, at: Date.now() });
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    }
  }

  /** Checker JSON; a 404 is { missing: true }, any other failure throws. */
  async function checker(path) {
    const res = await fetch(`${CHECKER_URL}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }

  async function hive(method, params) {
    const res = await fetch(HIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`hive ${res.status}`);
    const data = await res.json();
    if (data.error) {
      if (isMissingError(data.error)) return { missing: true };
      throw new Error(`hive ${data.error.message}`);
    }
    return { result: data.result };
  }

  const clip = (text, n) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 3).trim()}...` : t;
  };

  // A short's caption: hive_title is empty on most of them, so the first line
  // of the post that is not the player link.
  function shortTitle(s) {
    if (s.hive_title && String(s.hive_title).trim()) return clip(s.hive_title, 100);
    for (const line of String(s.hive_body || '').split('\n')) {
      const text = line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[#*_>`~|▶-]+/g, ' ')
        .trim();
      if (text.length >= 3) return clip(text, 100);
    }
    return '';
  }

  const clock = (sec) => {
    const total = Math.round(Number(sec) || 0);
    if (total <= 0) return '';
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = String(total % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  };

  /** Feed videos as list items, NSFW left out. */
  function videoItems(videos) {
    return (Array.isArray(videos) ? videos : [])
      .filter((v) => v && (v.owner || v.author) && v.permlink && v.title && !v.isNsfwContent && !isAdultByTitle(v.title))
      .map((v) => {
        const author = v.author || v.owner;
        return {
          path: `/watch?v=${author}/${v.permlink}`,
          name: clip(v.title, 120),
          author,
          extra: clock(v.duration || (v.spkvideo && v.spkvideo.duration)),
          image: (v.images && (v.images.thumbnail || v.images.poster)) || v.thumbnail || null,
        };
      });
  }

  function shortItems(shorts) {
    return (Array.isArray(shorts) ? shorts : [])
      .filter((s) => s && s.owner && s.permlink && !s.isNsfwContent)
      .map((s) => ({
        path: `/shorts?v=${s.owner}/${s.permlink}`,
        name: shortTitle(s) || `Short by @${s.hive_author || s.owner}`,
        author: s.hive_author || s.owner,
        extra: clock(s.duration),
        image: s.thumbnail_url || null,
      }))
      .filter((s) => !isAdultByTitle(s.name));
  }

  // Every list page links the others, so a crawler that lands on one finds them all.
  const SECTIONS = [
    ['/trend', 'Trending videos'],
    ['/new', 'New videos'],
    ['/shorts', 'Shorts'],
    ['/groups', 'Communities'],
    ['/leaderboard', 'Top creators'],
  ];

  function buildPage({
    origin, path, title, h1, description, intro, items, itemsHeading, noindex = false, crumbs,
    extraLd = [], extraBody = '',
  }) {
    const canonical = `${CANONICAL_ORIGIN}${path}`;
    const firstImage = items.map((i) => i.image).find(Boolean);
    const image = firstImage ? boundImage(fixThumbnail(firstImage)) : FALLBACK_THUMBNAIL;
    const abs = (p) => `${origin}${p}`;

    const ld = [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
        url: canonical,
        isPartOf: { '@type': 'WebSite', name: '3Speak', url: `${CANONICAL_ORIGIN}/` },
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: items.length,
          itemListElement: items.map((i, n) => ({
            '@type': 'ListItem', position: n + 1, url: `${CANONICAL_ORIGIN}${i.path}`, name: i.name,
          })),
        },
      },
      breadcrumbLd([['3Speak', `${CANONICAL_ORIGIN}/`], ...(crumbs || [[h1, canonical]])]),
      ...extraLd,
    ];

    const list = items.length
      ? `\n  <section>\n    <h2>${escapeHtml(itemsHeading)}</h2>\n    <ol>\n${items
        .map((i) => `      <li><a href="${escapeHtml(abs(i.path))}">${escapeHtml(i.name)}</a>${
          i.author ? ` by <a href="${escapeHtml(abs(`/user/${i.author}`))}">@${escapeHtml(i.author)}</a>` : ''}${
          i.extra ? ` · ${escapeHtml(i.extra)}` : ''}</li>`)
        .join('\n')}\n    </ol>\n  </section>`
      : '';
    const nav = SECTIONS
      .filter(([p]) => p !== path)
      .map(([p, label]) => `<a href="${escapeHtml(abs(p))}">${escapeHtml(label)}</a>`)
      .join(' · ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} - 3Speak</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="3Speak" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(abs(path))}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@3speaktv" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  ${ldScript(ld)}
</head>
<body>
  <h1>${escapeHtml(h1)}</h1>
  <p>${escapeHtml(intro || description)}</p>${extraBody}${list}
  <p>More on <a href="${escapeHtml(abs('/'))}">3Speak</a>: ${nav}</p>
</body>
</html>`;
  }

  // Shared tail of every description: what 3Speak is, in one clause.
  const ABOUT = 'the decentralized YouTube alternative where creators and viewers earn';

  // ─── The pages ─────────────────────────────────────────────────────────────

  async function trendPage(origin) {
    const data = await cached('trend', () => checker(`/feeds/trendingSorted?limit=${LIST_LIMIT}`));
    const items = videoItems(data.videos);
    return buildPage({
      origin, path: '/trend', title: 'Trending videos', h1: 'Trending videos on 3Speak',
      description: `Trending videos on 3Speak, ${ABOUT}.`,
      items, itemsHeading: 'Trending now',
    });
  }

  async function newPage(origin) {
    const data = await cached('new', () => checker(`/feeds/new?limit=${LIST_LIMIT}`));
    const items = videoItems(data.videos);
    return buildPage({
      origin, path: '/new', title: 'New videos', h1: 'New videos on 3Speak',
      description: `The newest videos on 3Speak, ${ABOUT}.`,
      items, itemsHeading: 'Just uploaded',
    });
  }

  async function shortsPage(origin) {
    const data = await cached('shorts', () => checker(`/shortssorted?limit=${LIST_LIMIT}`));
    const items = shortItems(data.shorts);
    return buildPage({
      origin, path: '/shorts', title: 'Shorts', h1: 'Shorts on 3Speak',
      description: `Short vertical videos on 3Speak, ${ABOUT}.`,
      items, itemsHeading: 'Shorts',
    });
  }

  async function tagPage(origin, tag) {
    const data = await cached(`tag:${tag}`, () => checker(`/videos/tag/${encodeURIComponent(tag)}?page=1&limit=${LIST_LIMIT}&type=videos`));
    if (data.missing) return MISSING;
    const total = Number(data.total) || 0;
    const items = videoItems(data.videos);
    if (!total && !items.length) return MISSING;
    const count = total > items.length ? `${total.toLocaleString('en-US')} videos` : null;
    return buildPage({
      origin,
      path: `/t/${tag}`,
      title: `#${tag} videos`,
      h1: `#${tag}`,
      description: `${count ? `${count} tagged` : 'Videos tagged'} #${tag} on 3Speak, ${ABOUT}.`,
      items,
      itemsHeading: `Videos tagged #${tag}`,
      noindex: Math.max(total, items.length) < MIN_TAG_VIDEOS,
    });
  }

  async function groupsPage(origin) {
    const { result } = await cached('groups', () => hive('bridge.list_communities', { last: '', limit: 100, observer: '' }));
    const items = (Array.isArray(result) ? result : [])
      .filter((c) => c && COMMUNITY_RE.test(c.name) && c.title && !c.is_nsfw)
      .map((c) => ({
        path: `/community/${c.name}`,
        name: clip(c.title, 80),
        extra: Number(c.subscribers) > 0 ? `${Number(c.subscribers).toLocaleString('en-US')} members` : '',
      }));
    return buildPage({
      origin, path: '/groups', title: 'Communities', h1: 'Communities on 3Speak',
      description: `Communities on 3Speak built around shared topics and languages. 3Speak is ${ABOUT}.`,
      items, itemsHeading: 'Communities',
    });
  }

  async function communityPage(origin, id) {
    const info = await cached(`community:${id}`, () => hive('bridge.get_community', { name: id, observer: '' }));
    if (info.missing || !info.result) return MISSING;
    const c = info.result;
    const feed = await cached(`community-new:${id}`, () => checker(`/feeds/community/${encodeURIComponent(id)}/new?page=1&limit=${LIST_LIMIT}`))
      .catch(() => ({ videos: [] }));
    const items = videoItems(feed.videos);
    const name = clip(c.title || id, 80);
    const about = clip(c.about, 300);
    const members = Number(c.subscribers) > 0 ? `${Number(c.subscribers).toLocaleString('en-US')} members` : null;
    const extraLd = [{
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name,
      url: `${CANONICAL_ORIGIN}/community/${id}`,
      ...(about ? { description: about } : {}),
      ...(c.lang ? { knowsLanguage: c.lang } : {}),
    }];
    return buildPage({
      origin,
      path: `/community/${id}`,
      title: `${name} community`,
      h1: name,
      description: clip(`${about || `The ${name} community on 3Speak.`}${members ? ` ${members}.` : ''}`, 200),
      intro: about || `The ${name} community on 3Speak, ${ABOUT}.`,
      items,
      itemsHeading: `New in ${name}`,
      crumbs: [['Communities', `${CANONICAL_ORIGIN}/groups`], [name, `${CANONICAL_ORIGIN}/community/${id}`]],
      extraLd,
      extraBody: members ? `\n  <p>${escapeHtml(members)}</p>` : '',
      // c.is_nsfw: the whole community is adult content.
      noindex: c.is_nsfw === true,
    });
  }

  async function leaderboardPage(origin) {
    const data = await cached('leaderboard', () => checker('/leaderboard?window=30d&limit=50'));
    const items = (Array.isArray(data.entries) ? data.entries : [])
      .filter((e) => e && e.user)
      .map((e) => {
        const uploads = Number(e.video_uploads) || 0;
        const shorts = Number(e.short_uploads) || 0;
        return {
          path: `/user/${e.user}`,
          name: `@${e.user}`,
          extra: [uploads && `${uploads} ${uploads === 1 ? 'video' : 'videos'}`, shorts && `${shorts} ${shorts === 1 ? 'short' : 'shorts'}`]
            .filter(Boolean).join(', '),
        };
      });
    return buildPage({
      origin, path: '/leaderboard', title: 'Top creators', h1: 'Top creators on 3Speak',
      description: `The most active creators on 3Speak in the last 30 days, ranked by uploads. 3Speak is ${ABOUT}.`,
      items, itemsHeading: 'Most uploads in the last 30 days',
    });
  }

  /** Which list a URL is, or null. */
  function match(url) {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p === '/trend') return { kind: 'trend' };
    if (p === '/new') return { kind: 'new' };
    // /shorts?v=... is one short (og-server's video card), bare /shorts the feed.
    if (p === '/shorts' && !url.searchParams.get('v')) return { kind: 'shorts' };
    if (p === '/groups' || p === '/communities') return { kind: 'groups' };
    if (p === '/leaderboard') return { kind: 'leaderboard' };
    let m = p.match(/^\/t\/([^/]+)$/);
    if (m) {
      let tag;
      try { tag = decodeURIComponent(m[1]).toLowerCase().trim(); } catch (_) { tag = ''; }
      return TAG_RE.test(tag) ? { kind: 'tag', tag } : { kind: 'missing' };
    }
    m = p.match(/^\/community\/([^/]+)$/);
    if (m) return COMMUNITY_RE.test(m[1]) ? { kind: 'community', id: m[1] } : { kind: 'missing' };
    return null;
  }

  /** Rendered HTML, MISSING, or null when a lookup failed. */
  async function render(req, list, origin) {
    switch (list.kind) {
      case 'trend': return trendPage(origin);
      case 'new': return newPage(origin);
      case 'shorts': return shortsPage(origin);
      case 'tag': return tagPage(origin, list.tag);
      case 'groups': return groupsPage(origin);
      case 'community': return communityPage(origin, list.id);
      case 'leaderboard': return leaderboardPage(origin);
      case 'missing': return MISSING;
      default: return null;
    }
  }

  return { match, render, MISSING };
};
