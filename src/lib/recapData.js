// Video lists for the yearly recap's tile galleries (page/Recap.jsx): what an
// account uploaded, and what it watched, over the window. Every entry is one
// card in the same shape:
//   { title, author, permlink, thumbnail, duration, created, short, href }

import { CHECKER_URL, MY_VIDEOS_URL } from '../utils/config';
import { shortHeading } from '../utils/shortTitle';
import { notExcluded } from './hiveYear';

// Enough for a very busy year; the 3D gallery would get heavy past this.
export const GALLERY_MAX = 240;

// img.3speak.tv no longer answers at all (requests fail, not even a 404).
// The checker still makes up `img.3speak.tv/<id>/thumbnail.png` for videos
// that never had a thumbnail, so those count as having none: no request, a
// plain tile, and nothing for the loading screen to wait on.
const DEAD_THUMB_HOSTS = /^https?:\/\/img\.3speak\.tv\//i;
export const usableThumb = (url) => (url && !DEAD_THUMB_HOSTS.test(url) ? url : null);

const watchHref = (author, permlink, short) => (short ? `/shorts?v=${author}/${permlink}` : `/watch?v=${author}/${permlink}`);

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/**
 * Uploads in the window, newest first: { videos: [card], shorts: [card] }.
 * Videos from the profile's list, shorts from the shorts list.
 */
export async function fetchUploadsYear(user, { days = 365 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const u = encodeURIComponent(user);

  const videos = [];
  for (let offset = 0; videos.length < GALLERY_MAX; offset += 50) {
    const data = await getJson(`${MY_VIDEOS_URL}/api/my-videos?username=${u}&limit=50&offset=${offset}&status=published&sort=newest`);
    const rows = data?.data?.videos || [];
    let past = false;
    for (const v of rows) {
      const created = Date.parse(v.created_at);
      if (created < cutoff) { past = true; break; }
      videos.push({
        title: v.title || '',
        author: v.author || v.owner || user,
        permlink: v.permlink,
        thumbnail: usableThumb(v.images?.thumbnail),
        duration: v.duration || v.spkvideo?.duration || 0,
        created,
        short: false,
        href: watchHref(v.author || v.owner || user, v.permlink, false),
      });
    }
    if (past || rows.length < 50) break;
  }

  const shorts = [];
  for (let page = 1; shorts.length < GALLERY_MAX; page += 1) {
    const data = await getJson(`${CHECKER_URL}/shorts/${u}?page=${page}&limit=50`);
    const rows = data?.shorts || [];
    let past = false;
    for (const s of rows) {
      const created = Date.parse(s.createdAt);
      if (created < cutoff) { past = true; break; }
      const [author, hivePermlink] = String(s.embed_url || '').replace(/^@/, '').split('/');
      shorts.push({
        title: s.hive_title || shortHeading(s.hive_body) || '',
        author: author || s.owner || user,
        permlink: hivePermlink || s.permlink,
        thumbnail: usableThumb(s.thumbnail_url),
        duration: s.duration || 0,
        created,
        short: true,
        href: watchHref(s.owner || user, s.permlink, true),
      });
    }
    if (past || page >= (data?.totalPages || 1)) break;
  }

  return { videos: videos.slice(0, GALLERY_MAX), shorts: shorts.slice(0, GALLERY_MAX) };
}

/**
 * The account's own watch history for the window: creators by videos watched,
 * plus every watched video as a card (up to 20 pages of 50).
 * { creators: [{ account, videos }], creatorCount, videos: [card], shorts: [card] }
 */
export async function fetchWatchedYear(user, { days = 365 } = {}) {
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  const byCreator = new Map();
  const videos = [];
  const shorts = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = await getJson(`${CHECKER_URL}/feeds/watched/${encodeURIComponent(user)}?since=${since}&limit=50&page=${page}`);
    (data.videos || []).forEach((v) => {
      const author = String(v._historyKey || '').split('/')[0] || v.author;
      if (!author || author === user) return;
      if (notExcluded(author)) byCreator.set(author, (byCreator.get(author) || 0) + 1);
      const short = !!v._short;
      const card = {
        title: v.title || '',
        author: v.author || author,
        permlink: v.permlink,
        // Newer uploads carry images.thumbnail; older (legacy) ones come through
        // in their own shape, with a top-level `thumbnail` (often ipfs://).
        thumbnail: usableThumb(v.images?.thumbnail || v.thumbnail || v.thumbnail_url),
        duration: v.duration || v.spkvideo?.duration || 0,
        created: (v.created ? Date.parse(v.created) : null) || (v.watched_at ? v.watched_at * 1000 : null),
        short,
        href: watchHref(v.author || author, v.permlink, short),
      };
      if (short) { if (shorts.length < GALLERY_MAX) shorts.push(card); } else if (videos.length < GALLERY_MAX) videos.push(card);
    });
    if (page >= (data.totalPages || 1)) break;
  }
  const creators = [...byCreator.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([account, n]) => ({ account, videos: n }));
  return { creators: creators.slice(0, 5), creatorCount: creators.length, videos, shorts };
}
