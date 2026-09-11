import { useLocation, matchPath } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

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

// First match wins. `title` may be a string or a fn of the matched params.
// `full: true` means the string IS the whole tab title — it does not get the
// "3S | <page>" prefix. Used by the home page, which carries the brand line
// itself rather than being labelled like a sub-page.
//
// The prefix is "3S" rather than "3Speak": it matches the logo, so a tab is
// recognisable from the mark alone, and putting it first means the platform
// survives the truncation a narrow tab applies to the end of the string.
const ROUTES = [
  { path: '/', end: true, title: '3S | Real People - Real Stories', full: true },
  { path: '/home-feed', title: 'Home Feed' },
  { path: '/follow-feed', title: 'Follow Feed' },
  { path: '/trend', title: 'Trending' },
  { path: '/discover', title: 'Discover' },
  { path: '/new', title: 'New Videos' },
  { path: '/firstupload', title: 'First Uploads' },
  { path: '/leaderboard', title: 'Rankings' },
  { path: '/notifications', title: 'Notifications' },
  { path: '/groups', title: 'Groups' },
  { path: '/communities', title: 'Communities' },
  { path: '/badges', title: 'Badges' },
  { path: '/audio/:author/:permlink', title: (p) => `Audio by @${p.author}` },
  { path: '/audio', title: 'Audio' },
  { path: '/playlist/:playlistId', title: 'Playlist' },
  { path: '/t/:tag', title: (p) => `#${p.tag}` },
  { path: '/p/:user', title: (p) => `@${p.user}` },
  { path: '/user/:user', title: (p) => `@${p.user}` },
  { path: '/watched/:username', title: (p) => `Watch history — @${p.username}` },
  { path: '/post/:author/:permlink', title: (p) => `Post by @${p.author}` },
  { path: '/profile', title: 'My Profile' },
  { path: '/upload', title: 'Upload' },
  { path: '/embed-studio/*', title: 'Upload Studio' },
  { path: '/draft', title: 'Drafts' },
  { path: '/editvideo/:d', title: 'Edit Video' },
  { path: '/edit-scheduled/:permlink', title: 'Edit Scheduled Post' },
  { path: '/chat', title: 'Chat' },
  { path: '/openpods', title: 'OpenPods' },
  { path: '/about', title: 'About' },
  { path: '/login', title: 'Login' },
  { path: '/newlogin', title: 'Login' },
  { path: '/auth/login', title: 'Login' },
];

const BRAND_FALLBACK = '3Speak - Decentralized Video Platform';

function matchRoute(pathname) {
  for (const r of ROUTES) {
    const m = matchPath({ path: r.path, end: r.end ?? false }, pathname);
    if (m) return { route: r, params: m.params };
  }
  return null;
}

/** The page's own label, without the brand suffix. */
export function resolveRouteTitle(pathname) {
  const hit = matchRoute(pathname);
  if (!hit) return null;
  return typeof hit.route.title === 'function' ? hit.route.title(hit.params) : hit.route.title;
}

/** The exact string that goes in <title>, suffix rules applied. */
export function resolveDocumentTitle(pathname) {
  const hit = matchRoute(pathname);
  const label = hit
    ? (typeof hit.route.title === 'function' ? hit.route.title(hit.params) : hit.route.title)
    : null;
  // Unknown route → the plain brand title rather than a stale one.
  if (!label) return BRAND_FALLBACK;
  return hit.route.full ? label : `3S | ${label}`;
}

export default function RouteTitle() {
  const { pathname } = useLocation();

  // Let self-titling pages own the tag entirely.
  if (SELF_TITLED.some((p) => matchPath({ path: p, end: false }, pathname))) return null;

  return (
    <Helmet>
      <title>{resolveDocumentTitle(pathname)}</title>
    </Helmet>
  );
}
