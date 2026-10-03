// Channel Surfing: watching 3Speak like TV. A "channel" is one v2 topic; flipping
// plays the next video the tag feed ranks for it.
//
// The ranking is the checker's, not ours: /videos/tag/:tag already runs the shared
// feed pipeline (recency decay, retention re-rank, interest boost, hide-seen via
// feedParams()). All this module adds is "don't show me the same thing twice this
// session", because hide-watched only covers signed-in viewers and only once a
// view has been recorded.
//
// Surf mode lives in the watch URL as `&surf=<slug>`, so it survives a reload and
// the back button, and a watch page opened any other way never shows the bar.
import axios from 'axios';
import { TAG_FEED_URL, FEED_URL } from './config';
import { feedParams } from './feedParams';
import { TAG_CATEGORIES } from './tagsV2';
import { aiKey, isAiFlagged, loadAiFlags } from './aiFlags';
import { useAppStore } from '../lib/store';
import { t as translate } from '../i18n';

export const SURF_PARAM = 'surf';

// A channel is a topic OR a whole category, the same two levels the interests
// picker offers. Numbers walk the tree (each category, then its topics), so
// "CH 07" is always the same channel for everyone.
export const CHANNELS = TAG_CATEGORIES.flatMap((c) => [
  { slug: c.slug, labelKey: c.labelKey, emoji: c.emoji, isCategory: true, topics: c.topics.map((t) => t.slug) },
  ...c.topics.map((t) => ({ ...t, isCategory: false, category: c.slug })),
]).map((c, i) => ({ ...c, number: i + 1 }));
const BY_SLUG = new Map(CHANNELS.map((c) => [c.slug, c]));

// A Hive community is a channel too ("Surf this community" on its page), just not
// one in the numbered lineup: it has no CH number, and ↑/↓ from it step into the
// lineup. Its slug is the community id; the display name is remembered from the
// community page, because the watch page has nothing else to read it from.
const COMMUNITY_SLUG = /^hive-\d+$/;
const COMMUNITY_TITLES_KEY = '3speak_surf_community_titles';
const loadCommunityTitles = () => {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_TITLES_KEY) || '{}') || {}; } catch { return {}; }
};
export function rememberCommunityChannel(id, title) {
  if (!COMMUNITY_SLUG.test(id || '') || !title) return;
  try {
    const titles = loadCommunityTitles();
    if (titles[id] === title) return;
    titles[id] = title;
    localStorage.setItem(COMMUNITY_TITLES_KEY, JSON.stringify(titles));
  } catch { /* ignore */ }
}
export const getChannel = (slug) => {
  const hit = BY_SLUG.get(slug);
  if (hit) return hit;
  if (!COMMUNITY_SLUG.test(slug || '')) return null;
  // A remembered title is user content (shown as-is); without one, labelKey.
  const title = loadCommunityTitles()[slug] || null;
  return { slug, label: title, labelKey: title ? null : 'misc.surf.community', emoji: '👥', isCommunity: true, isCategory: false };
};

/** Display name of a channel in the current language. */
export const channelLabel = (ch) => (ch?.label || (ch?.labelKey ? translate(ch.labelKey) : ''));

export const channelNumber = (ch) => (ch?.isCommunity ? 'CM' : String(ch?.number ?? 0).padStart(2, '0'));
export const channelTitle = (ch) => (ch?.isCategory ? translate('misc.surf.allOf', { label: channelLabel(ch) }) : channelLabel(ch));

/** The channel `step` places away from `slug`, wrapping at both ends. */
export function stepChannel(slug, step) {
  const i = CHANNELS.findIndex((c) => c.slug === slug);
  const n = CHANNELS.length;
  return CHANNELS[(((i < 0 ? 0 : i) + step) % n + n) % n];
}

export const videoAuthor = (v) => v?.author?.username || v?.author || v?.owner || null;
export const videoKey = (v) => {
  const a = videoAuthor(v);
  return a && v?.permlink ? `${a}/${v.permlink}` : null;
};

export const surfUrl = (v, slug) =>
  `/watch?v=${videoAuthor(v)}/${v.permlink}&${SURF_PARAM}=${encodeURIComponent(slug)}`;

// ── Seen this session ──────────────────────────────────────────────────────────
// sessionStorage, not local: a fresh tab is a fresh evening in front of the TV.
const SEEN_KEY = '3speak_surf_seen';
const SEEN_CAP = 500;
const loadSeen = () => {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
};
export function markSeen(key) {
  if (!key) return;
  try {
    const list = loadSeen().filter((k) => k !== key);
    list.push(key);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_CAP)));
  } catch { /* storage unavailable: repeats are possible, nothing breaks */ }
}
const seenSet = () => new Set(loadSeen());

// ── Last channel ───────────────────────────────────────────────────────────────
const LAST_KEY = '3speak_surf_last';
export const loadLastChannel = () => {
  try { return getChannel(localStorage.getItem(LAST_KEY)); } catch { return null; }
};
export const saveLastChannel = (slug) => {
  try { localStorage.setItem(LAST_KEY, slug); } catch { /* ignore */ }
};

// ── Feed ───────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
const MAX_PAGES = 5;
const PAGE_TTL_MS = 5 * 60 * 1000;
const pageCache = new Map(); // `${slug}|${page}|${feedParams()}` → { at, promise }

function fetchTagPage(slug, page) {
  // feedParams() is personal (user, interests, hide-watched, chrono), so it is part
  // of the key: switching account or a feed setting must not reuse another answer.
  const params = feedParams();
  const key = `${slug}|${page}|${params}`;
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.promise;
  const promise = axios
    .get(`${TAG_FEED_URL}/videos/tag/${encodeURIComponent(slug)}?page=${page}&limit=${PAGE_SIZE}&type=videos${params}`)
    .then((res) => ({
      videos: (res.data?.videos || []).filter((v) => videoKey(v)),
      total: res.data?.total || 0,
    }))
    .catch((err) => { pageCache.delete(key); throw err; });
  pageCache.set(key, { at: Date.now(), promise });
  return promise;
}

// A community channel plays the community's Trending feed (views over 30 days,
// personalised by feedParams() like the tag feeds), and falls back to its New feed
// for a quiet community with nothing in that window.
function fetchCommunityPage(id, page) {
  const params = feedParams();
  const key = `${id}|${page}|${params}`;
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.promise;
  const get = (variant, extra) => axios
    .get(`${FEED_URL}/feeds/community/${encodeURIComponent(id)}/${variant}?page=${page}&limit=${PAGE_SIZE}${extra}`)
    .then((res) => ({
      videos: (res.data?.videos || []).filter((v) => videoKey(v)),
      // The community feeds report no usable total; a full page means "maybe more".
      total: (page - 1) * PAGE_SIZE + (res.data?.videos || []).length + ((res.data?.videos || []).length === PAGE_SIZE ? 1 : 0),
    }));
  const promise = get('trending', params)
    .then((r) => (r.videos.length || page > 1 ? r : get('new', '')))
    .catch((err) => { pageCache.delete(key); throw err; });
  pageCache.set(key, { at: Date.now(), promise });
  return promise;
}

/**
 * One page of a channel. A topic is one tag feed. A category is not: the checker
 * matches the category slug only as a literal tag, which the tagger uses just for
 * "this area, unsure which topic". So a category channel reads the category tag
 * plus every topic under it and deals them out round-robin, each list already in
 * the checker's ranked order, so no single busy topic drowns out the rest.
 */
async function fetchChannelPage(slug, page) {
  const ch = getChannel(slug);
  if (ch?.isCommunity) return fetchCommunityPage(slug, page);
  if (!ch?.isCategory) return fetchTagPage(slug, page);
  const lists = await Promise.all([slug, ...ch.topics].map((t) =>
    fetchTagPage(t, page).catch(() => ({ videos: [], total: 0 }))));
  const out = [];
  const seen = new Set();
  const longest = Math.max(0, ...lists.map((l) => l.videos.length));
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const v = l.videos[i];
      const k = v && videoKey(v);
      if (k && !seen.has(k)) { seen.add(k); out.push(v); }
    }
  }
  return { videos: out, total: Math.max(0, ...lists.map((l) => l.total)) };
}

// "Hide AI-generated" is a client-side filter everywhere (Card3, the shorts
// feed), not a checker param, so the tag feed still returns flagged videos.
// Same lookup as the cards: the hive author pair, and the owner pair when it
// differs.
const aiKeysOf = (v) => [aiKey(videoAuthor(v), v.permlink), v.owner ? aiKey(v.owner, v.permlink) : null]
  .filter(Boolean);
const isAiVideo = (v) => isAiFlagged(videoAuthor(v), v.permlink) || (!!v.owner && isAiFlagged(v.owner, v.permlink));

/**
 * The best-ranked video on `slug` that this session has not shown yet and is not
 * `excludeKey` (what is playing now). Walks a few pages; when the whole window has
 * been seen, starts the channel over rather than going dark. null = nothing on air.
 * With "Hide AI-generated" on, flagged videos are never picked, not even as the
 * start-over fallback.
 */
export async function findNextOnChannel(slug, excludeKey = null) {
  const seen = seenSet();
  const hideAi = !!useAppStore.getState().hideAi;
  let firstOther = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { videos, total } = await fetchChannelPage(slug, page);
    if (hideAi) await loadAiFlags(videos.flatMap(aiKeysOf));
    for (const v of videos) {
      const k = videoKey(v);
      if (k === excludeKey) continue;
      if (hideAi && isAiVideo(v)) continue;
      if (!firstOther) firstOther = v;
      if (!seen.has(k)) return v;
    }
    if (page * PAGE_SIZE >= total || videos.length === 0) break;
  }
  return firstOther;
}
