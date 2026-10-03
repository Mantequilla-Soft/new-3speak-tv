import { useLocation, matchPath } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n';

/**
 * Sets the browser-tab title for every route.
 *
 * Only the watch page used to do this (via SEOHead), so every other page — shorts,
 * home, leaderboard, profiles… — sat on the static <title> from index.html. This
 * component lives once inside the Router and derives the title from the pathname.
 *
 * Pages that set their OWN (dynamic) title render their own <Helmet>/<SEOHead>;
 * they're listed in SELF_TITLED so we don't emit a competing <title> for them.
 * (react-helmet-async lets the last-rendered value win, and we'd rather not
 * depend on mount order.)
 */
const SELF_TITLED = ['/watch', '/shorts', '/community/:communityName', '/b/:account', '/badge/:account'];

// First match wins. `titleKey` is an i18n key; `title` is a fn of the matched
// params, called at resolve time (never at module load) so it reads the current language.
// `full: true` means the string IS the whole tab title — it does not get the
// "3S | <page>" prefix. Used by the home page, which carries the brand line
// itself rather than being labelled like a sub-page.
//
// The prefix is "3S" rather than "3Speak": it matches the logo, so a tab is
// recognisable from the mark alone, and putting it first means the platform
// survives the truncation a narrow tab applies to the end of the string.
const ROUTES = [
  { path: '/', end: true, titleKey: 'app.routes.home', full: true },
  { path: '/home-feed', titleKey: 'app.routes.homeFeed' },
  { path: '/follow-feed', titleKey: 'app.routes.followFeed' },
  { path: '/trend', titleKey: 'common.nav.trending' },
  { path: '/discover', titleKey: 'app.routes.discover' },
  { path: '/new', titleKey: 'app.routes.newVideos' },
  { path: '/firstupload', titleKey: 'app.routes.firstUploads' },
  { path: '/leaderboard', titleKey: 'app.routes.rankings' },
  { path: '/notifications', titleKey: 'common.nav.notifications' },
  { path: '/groups', titleKey: 'app.routes.groups' },
  { path: '/communities', titleKey: 'common.nav.communities' },
  { path: '/badges', titleKey: 'app.routes.badges' },
  { path: '/audio/:author/:permlink', title: (p) => t('app.routes.audioBy', { author: p.author }) },
  { path: '/audio', titleKey: 'app.routes.audio' },
  { path: '/playlist/:playlistId', titleKey: 'app.routes.playlist' },
  { path: '/t/:tag', title: (p) => `#${p.tag}` },
  { path: '/p/:user', title: (p) => `@${p.user}` },
  { path: '/user/:user', title: (p) => `@${p.user}` },
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
  { path: '/login', titleKey: 'app.routes.login' },
  { path: '/newlogin', titleKey: 'app.routes.login' },
  { path: '/auth/login', titleKey: 'app.routes.login' },
];

const BRAND_FALLBACK_KEY = 'app.routes.brandFallback';

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

export default function RouteTitle() {
  const { pathname } = useLocation();
  // Subscribes to language changes so the title re-renders in the new language.
  useTranslation();

  // Let self-titling pages own the tag entirely.
  if (SELF_TITLED.some((p) => matchPath({ path: p, end: false }, pathname))) return null;

  return (
    <Helmet>
      <title>{resolveDocumentTitle(pathname)}</title>
    </Helmet>
  );
}
