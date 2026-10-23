import { useEffect } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n';

/**
 * Sets the browser-tab title, and the search-engine tags, for every route.
 *
 * Only the watch page used to do this (via SEOHead), so every other page — shorts,
 * home, leaderboard, profiles… — sat on the static <title> from index.html. This
 * component lives once inside the Router and derives the title from the pathname.
 *
 * It also writes what Google reads after rendering the page: a description, the
 * canonical address, og:url / og:title, and `noindex` on pages that only make
 * sense to the signed-in person (upload, drafts, notifications...). Before this,
 * every route carried index.html's homepage og:url and two generic descriptions,
 * so to a crawler /t/hive or /leaderboard described itself as the homepage.
 *
 * Pages that set their OWN (dynamic) title render their own <Helmet>/<SEOHead>;
 * they're listed in SELF_TITLED so we don't emit a competing <title> for them.
 * (react-helmet-async lets the last-rendered value win, and we'd rather not
 * depend on mount order.) /watch and /shorts are in SELF_SEO: SEOHead / Short
 * write everything there, so this component stays out of them entirely.
 */
const SELF_TITLED = ['/watch', '/shorts', '/community/:communityName', '/b/:account', '/badge/:account', '/groups'];
const SELF_SEO = ['/watch', '/shorts'];

// Where rel=canonical points. Always the live site: preview and www serve the
// same pages, and a canonical on 3speak.tv tells search engines which to rank.
const CANONICAL_ORIGIN = 'https://3speak.tv';

// One person's own pages, or a step in a flow: nothing a search result could
// usefully send anyone else to. Matched as prefixes (subpaths included).
const PRIVATE = [
  '/notifications', '/upload', '/publish-backlog', '/youtube-import', '/login', '/newlogin',
  '/auth', '/callback', '/studio', '/embed-studio', '/draft', '/editvideo', '/edit-scheduled',
  '/profile', '/wallet', '/test', '/image', '/openpods/publish', '/chat', '/translate',
  '/invite-links', '/invite', '/home-feed', '/follow-feed', '/watched', '/egress-stream',
  '/ad-wizard',
];

// First match wins. `titleKey` is an i18n key; `title` is a fn of the matched
// params, called at resolve time (never at module load) so it reads the current language.
// `full: true` means the string IS the whole tab title — it does not get the
// "3S | <page>" prefix. Used by the home page, which carries the brand line
// itself rather than being labelled like a sub-page.
// `canonical` maps the matched params to the page's one address (/p/x and
// /user/x are the same profile); without it the pathname is the canonical.
//
// The prefix is "3S" rather than "3Speak": it matches the logo, so a tab is
// recognisable from the mark alone, and putting it first means the platform
// survives the truncation a narrow tab applies to the end of the string.
const ROUTES = [
  // What 3Speak is, in the words people search for. Same line as the crawler
  // homepage (server/og-site.cjs) and index.html.
  { path: '/', end: true, title: () => t('misc.seo.homeTitle'), full: true },
  { path: '/home-feed', titleKey: 'app.routes.homeFeed' },
  { path: '/follow-feed', titleKey: 'app.routes.followFeed' },
  { path: '/trend', titleKey: 'common.nav.trending' },
  { path: '/discover', titleKey: 'app.routes.discover' },
  { path: '/new', titleKey: 'app.routes.newVideos' },
  { path: '/firstupload', titleKey: 'app.routes.firstUploads' },
  { path: '/leaderboard', titleKey: 'app.routes.rankings' },
  { path: '/notifications', titleKey: 'common.nav.notifications' },
  { path: '/groups', titleKey: 'app.routes.groups' },
  { path: '/communities', titleKey: 'common.nav.communities', canonical: () => '/groups' },
  { path: '/badges', titleKey: 'app.routes.badges' },
  { path: '/audio/:author/:permlink', title: (p) => t('app.routes.audioBy', { author: p.author }) },
  { path: '/audio', titleKey: 'app.routes.audio' },
  { path: '/playlist/:playlistId', titleKey: 'app.routes.playlist' },
  { path: '/t/:tag', title: (p) => `#${p.tag}`, canonical: (p) => `/t/${encodeURIComponent(String(p.tag).toLowerCase())}` },
  { path: '/p/:user', title: (p) => `@${p.user}`, canonical: (p) => `/user/${String(p.user).toLowerCase()}` },
  { path: '/user/:user', title: (p) => `@${p.user}`, canonical: (p) => `/user/${String(p.user).toLowerCase()}` },
  // Self-titled (their name needs a lookup), so no label here: the canonical
  // and the site description only. /badge/x is the spelled-out alias of /b/x.
  { path: '/community/:communityName', title: () => null },
  { path: '/b/:account', title: () => null, canonical: (p) => `/b/${String(p.account).toLowerCase()}` },
  { path: '/badge/:account', title: () => null, canonical: (p) => `/b/${String(p.account).toLowerCase()}` },
  { path: '/watched/:username', title: (p) => t('app.routes.watchHistory', { username: p.username }) },
  { path: '/post/:author/:permlink', title: (p) => t('app.routes.postBy', { author: p.author }) },
  { path: '/profile', titleKey: 'app.routes.myProfile' },
  { path: '/upload', titleKey: 'common.actions.upload' },
  { path: '/embed-studio/*', titleKey: 'app.routes.uploadStudio' },
  { path: '/draft', titleKey: 'app.routes.drafts' },
  { path: '/editvideo/:d', titleKey: 'app.routes.editVideo' },
  { path: '/edit-scheduled/:permlink', titleKey: 'app.routes.editScheduledPost' },
  { path: '/chat', titleKey: 'app.routes.chat' },
  { path: '/openpods', title: () => 'OpenPods' },
  { path: '/about', titleKey: 'app.routes.about' },
  { path: '/faq', titleKey: 'app.routes.faq' },
  { path: '/login', titleKey: 'app.routes.login' },
  { path: '/newlogin', titleKey: 'app.routes.login' },
  { path: '/auth/login', titleKey: 'app.routes.login' },
];

const BRAND_FALLBACK_KEY = 'app.routes.brandFallback';

const matchesAny = (patterns, pathname) =>
  patterns.some((p) => matchPath({ path: p, end: false }, pathname));

function matchRoute(pathname) {
  for (const r of ROUTES) {
    const m = matchPath({ path: r.path, end: r.end ?? false }, pathname);
    if (m) return { route: r, params: m.params };
  }
  return null;
}

/** The page's own label, without the brand suffix. */
function routeLabel(route, params) {
  if (typeof route.title === 'function') return route.title(params);
  return route.titleKey ? t(route.titleKey) : null;
}

export function resolveRouteTitle(pathname) {
  const hit = matchRoute(pathname);
  if (!hit) return null;
  return routeLabel(hit.route, hit.params);
}

/** The exact string that goes in <title>, suffix rules applied. */
export function resolveDocumentTitle(pathname) {
  const hit = matchRoute(pathname);
  const label = hit ? routeLabel(hit.route, hit.params) : null;
  // Unknown route → the plain brand title rather than a stale one.
  if (!label) return t(BRAND_FALLBACK_KEY);
  return hit.route.full ? label : `3S | ${label}`;
}

/**
 * The page's canonical address on 3speak.tv: the route's own mapping, else the
 * path without a trailing slash. The query string is dropped (?tab=, ?sort=,
 * tracking params all show the same page), except /groups' tab, which is a
 * different list.
 */
export function resolveCanonical(pathname, search = '') {
  const hit = matchRoute(pathname);
  const path = hit && hit.route.canonical
    ? hit.route.canonical(hit.params)
    : (pathname.replace(/\/+$/, '') || '/');
  if (path === '/groups') {
    const tab = new URLSearchParams(search).get('tab');
    if (tab && /^[a-z]+$/.test(tab) && tab !== 'communities') return `${CANONICAL_ORIGIN}/groups?tab=${tab}`;
  }
  return `${CANONICAL_ORIGIN}${path}`;
}

/** True for pages search engines should leave out (see PRIVATE). */
export function isPrivateRoute(pathname) {
  return matchesAny(PRIVATE, pathname);
}

export default function RouteTitle() {
  const { pathname, search } = useLocation();
  // Subscribes to language changes so the title re-renders in the new language.
  useTranslation();

  // index.html carries the homepage's description / og:url / og:title for
  // readers that run no JavaScript. Once this component writes the page's
  // own, those copies would contradict it (React does not merge <meta> tags),
  // so they go.
  useEffect(() => {
    document.querySelectorAll('head [data-static-seo]').forEach((node) => node.remove());
  }, []);

  if (matchesAny(SELF_SEO, pathname)) return null;

  const hit = matchRoute(pathname);
  const label = hit ? routeLabel(hit.route, hit.params) : null;
  const ownsTitle = !matchesAny(SELF_TITLED, pathname);
  const isHome = hit && hit.route.full;
  const noindex = isPrivateRoute(pathname);
  const title = resolveDocumentTitle(pathname);
  const description = isHome || !label
    ? t('misc.seo.siteDescription')
    : t('misc.seo.pageDescription', { page: label });
  // Unknown routes render NotFound (which says noindex itself): no canonical,
  // so nothing points at an address that does not exist.
  const canonical = hit && !noindex ? resolveCanonical(pathname, search) : null;

  return (
    <Helmet>
      {ownsTitle && <title>{title}</title>}
      {noindex && <meta name="robots" content="noindex, follow" />}
      <meta name="description" content={description} />
      {canonical && <link rel="canonical" href={canonical} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {ownsTitle && <meta property="og:title" content={title} />}
      <meta property="og:description" content={description} />
      {ownsTitle && <meta name="twitter:title" content={title} />}
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}
