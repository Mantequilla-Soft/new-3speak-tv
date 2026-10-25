/**
 * The app's own addresses for profiles and videos, Hive style:
 *
 *   /@alice               a profile      (old: /p/alice, /user/alice)
 *   /@alice/my-video      a video        (old: /watch?v=alice/my-video)
 *
 * The old forms still open the same pages (App.jsx rewrites them), so links
 * already out in the world keep working. Build every NEW in-app link here.
 *
 * NOT for links written into Hive post bodies or comments: PeakD, Ecency and
 * hive.blog turn `3speak.tv/watch?v=` into an embedded player, and our own
 * timestamp parser (utils/timestamps.js) reads that form. Those keep it.
 */

// Path segments under /@user that are pages of the profile, not permlinks.
// /@user/links is Spotlight (its own route in App.jsx); /@user/shorts opens the
// profile's shorts tab.
const PROFILE_SUBPAGES = new Set(['shorts', 'links']);

/** Extra query for a link: '' | 'a=1&b=2' | '?a=1' | '&a=1' all accepted. */
function withQuery(path, query) {
  const q = String(query || '').replace(/^[?&]+/, '');
  return q ? `${path}?${q}` : path;
}

/** /@user, optionally with a query (e.g. 'tab=shorts'). */
export function profilePath(user, query = '') {
  return withQuery(`/@${user}`, query);
}

/** /@author/permlink, optionally with a query (e.g. 't=65' or '&playlist=x&pos=2'). */
export function watchPath(author, permlink, query = '') {
  return withQuery(`/@${author}/${permlink}`, query);
}

/**
 * What a /@… pathname points at:
 *   { kind: 'profile', user }
 *   { kind: 'shorts', user }               /@user/shorts
 *   { kind: 'post', author, permlink }     a video, or any other Hive post
 *   null                                   not a /@ address
 * /@user/links is left to its own route and comes back null.
 */
export function parseHivePath(pathname) {
  const m = String(pathname || '').match(/^\/@([^/]+)(?:\/(.+?))?\/?$/);
  if (!m) return null;
  const [, user, rest] = m;
  if (!rest) return { kind: 'profile', user };
  if (rest === 'shorts') return { kind: 'shorts', user };
  if (PROFILE_SUBPAGES.has(rest)) return null;
  return { kind: 'post', author: user, permlink: rest };
}

/** True on a video's watch page, old or new address. */
export function isWatchPath(pathname) {
  return pathname === '/watch' || parseHivePath(pathname)?.kind === 'post';
}

/** True on a profile page, old or new address. */
export function isProfilePath(pathname) {
  const kind = parseHivePath(pathname)?.kind;
  return kind === 'profile' || kind === 'shorts' || /^\/(p|user)\/[^/]+/.test(pathname);
}
