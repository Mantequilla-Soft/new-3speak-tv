/**
 * Outside podcast feeds: the "Podcast feeds" tab on /audio.
 *
 * Anyone signed in can follow any podcast's RSS feed. The checker
 * (3speakchecks routes/podcasts.js + services/podcastFeeds.js) stores each show
 * once, however many people follow it, keeps its newest 50 episodes, polls it and
 * listens for podping, and tells the bell about new episodes. Episodes play in
 * the global audio player as `external` tracks straight from the podcast's host,
 * and never count towards 3Speak's pay-per-listen.
 *
 * Changing your list is signed: our own API vouches for the session it verified
 * (Butter Auth, HiveSigner, wallet login, warm-up `~handle`), and a wallet that
 * can sign does it itself when there is no such session.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  signMessageWithAioha,
  getCurrentProvider,
  isManteAuthLogin,
  KeyTypes,
  Providers,
} from '../hive-api/aioha';
import { CHECKER_URL } from '../utils/config';
import { t } from '../i18n';
import { sessionVouch, lastVouchUser } from './podcastProgress';

const API = `${CHECKER_URL}/podcasts`;
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

// Must match podcastMessage() in 3speakchecks/routes/podcasts.js and the signer in
// server/index.cjs exactly.
const podcastMessage = (action, user, payload, timestamp) =>
  ['3speak-podcasts', action, user, payload, String(timestamp)].join('|');

const SIGN_CAPABLE_PROVIDERS = new Set([Providers.Keychain, Providers.HiveAuth, Providers.PeakVault, Providers.Ledger]);
const canSignLocally = () => !isManteAuthLogin() && SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider());

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function vouch(action, payload, user) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (getCurrentProvider() === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${THREESPEAK_API}/podcasts/signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ action, payload }),
    });
    const data = await res.json().catch(() => ({}));
    // The server vouches for whoever ITS session is; never use a proof for someone else.
    if (!res.ok || !data.signature || data.username !== user) return null;
    return { signature: data.signature, timestamp: data.timestamp };
  } catch {
    return null;
  }
}

/* Who is listening, for listener rewards: one vouch from our API (who its session
 * is), reused for most of a day like the progress vouch. Null when the session
 * cannot be proven here; the listen is then simply anonymous. */
const LISTEN_VOUCH_REUSE_MS = 20 * 60 * 60 * 1000;
let listenVouchCache = null;
export async function listenVouch(user) {
  if (!user) return null;
  const c = listenVouchCache;
  if (c && c.user === user && Date.now() - c.timestamp < LISTEN_VOUCH_REUSE_MS) return c;
  const v = await vouch('listen', 'session', user);
  listenVouchCache = v ? { user, ...v } : null;
  return listenVouchCache;
}

async function sign(action, payload, user) {
  const v = await vouch(action, payload, user);
  if (v) return v;
  if (!canSignLocally()) throw new Error(t('audio.podcasts.errors.signIn'));
  const timestamp = Date.now();
  const res = await signMessageWithAioha(podcastMessage(action, user, payload, timestamp), KeyTypes.Posting, t('audio.podcasts.walletPrompt'));
  if (!res?.success || !res.result) throw new Error(t('audio.podcasts.errors.signFailed'));
  return { signature: res.result, timestamp };
}

async function post(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.results) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getJson(path) {
  const res = await fetch(`${API}/${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/**
 * A read that may include a private feed (a show, its episodes, /latest,
 * /subscriptions): signed in, it carries the session vouch, so the checker can
 * see the reader follows that feed. A vouch that can't be had never stops the
 * read; private feeds are then simply left out.
 */
async function readJson(path, user) {
  const qs = await vouchQuery(user);
  return getJson(qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path);
}

/**
 * `vu=..&vts=..&vsig=..` for a checker read of a private feed (the session
 * vouch of lib/podcastProgress.js), or '' signed out or when there is none.
 * Without `user`, the listener the last vouch was for.
 */
export async function vouchQuery(user = lastVouchUser()) {
  if (!user) return '';
  const v = await sessionVouch(user);
  return v ? String(new URLSearchParams({ vu: user, vts: String(v.timestamp), vsig: v.signature })) : '';
}

/**
 * Where a private feed's episode plays from: its own address may sit behind the
 * feed's login, so the checker streams it (/episode/:id/download, with Range
 * for seeking) once it knows you follow the feed. Null when the session can't
 * be vouched for. The player calls this for tracks with `private: true`.
 */
export async function privateAudioUrl(episodeId, user = lastVouchUser()) {
  const qs = await vouchQuery(user);
  return qs ? `${API}/episode/${encodeURIComponent(episodeId)}/download?${qs}` : null;
}

/** An episode's chapters, read with the vouch (a private feed's are not public). */
export async function fetchPrivateChapters(episodeId, user) {
  try {
    const data = await readJson(`episode/${encodeURIComponent(episodeId)}/chapters`, user);
    return Array.isArray(data?.chapters) ? data.chapters : [];
  } catch {
    return [];
  }
}

/**
 * A private feed's link with its login in it (https://user:pass@host/...), both
 * parts URL-encoded; the checker fetches such a feed with Basic auth. An empty
 * username leaves the link as it is (a feed whose link has a token in it).
 */
export function buildPrivateFeedUrl(url, username, password) {
  const raw = String(url || '').trim();
  const name = String(username || '').trim();
  if (!name) return raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (!/^https?:$/.test(u.protocol)) return raw;
  return `${u.protocol}//${encodeURIComponent(name)}:${encodeURIComponent(String(password || ''))}@${u.host}${u.pathname}${u.search}${u.hash}`;
}

/**
 * Follow one or more feeds. Resolves to the per-URL results [{ url, ok, feed_id, already, code, owner }].
 * `priv` marks private feeds (needs a login), aligned with `urls`.
 */
export async function followFeeds(user, urls, titles = [], priv = []) {
  const rows = urls.map((u, i) => ({ url: String(u).trim(), title: titles[i], priv: !!priv[i] })).filter((r) => r.url);
  const clean = rows.map((r) => r.url);
  const signed = await sign('subscribe', await sha256Hex(clean.join('\n')), user);
  const body = { user, urls: clean, titles: titles.length ? rows.map((r) => r.title || '') : [], ...signed };
  if (rows.some((r) => r.priv)) body.private = rows.map((r) => r.priv);
  const data = await post('subscribe', body);
  return data.results || [];
}

export async function unfollowFeed(user, feedId) {
  const signed = await sign('unsubscribe', feedId, user);
  return post('unsubscribe', { user, feed_id: feedId, ...signed });
}

export async function setFeedNotify(user, feedId, notify) {
  const signed = await sign('notify', `${feedId}:${notify ? 'on' : 'off'}`, user);
  return post('notify', { user, feed_id: feedId, notify, ...signed });
}

/** The user-facing reason a URL could not be followed. */
/** The message for a failed follow; `info` is the checker's result row (Spotify & co. name the platform). */
export function followErrorText(code, info = {}) {
  const known = {
    bad_url: 'badUrl', blocked_address: 'badUrl', not_a_podcast: 'notPodcast', parse_error: 'notPodcast',
    no_episodes: 'noEpisodes', too_large: 'tooLarge', timeout: 'unreachable', network: 'unreachable',
    limit: 'limit', internal_feed: 'internal', disabled: 'disabled',
    closed_platform: 'closedPlatform', apple_only: 'appleOnly', directory_not_found: 'directoryNotFound', directory_down: 'directoryDown',
  };
  const key = known[code] || (String(code || '').startsWith('http_') ? 'unreachable' : 'generic');
  return t(`audio.podcasts.errors.${key}`, { platform: info?.platform || '' });
}

/**
 * A feed URL without the parts that do not change which feed it is (scheme,
 * www., trailing slash), as the checker compares them: so a directory's
 * http://…/feed/ shows as followed when you follow https://…/feed.
 */
export function feedKey(url) {
  try {
    const u = new URL(String(url).trim());
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return String(url || '');
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function usePodcastConfig() {
  return useQuery({
    queryKey: ['podcasts', 'config'],
    queryFn: () => getJson('config'),
    staleTime: 10 * 60 * 1000,
  });
}

export function usePodcastSubscriptions(user) {
  return useQuery({
    queryKey: ['podcasts', 'subs', user],
    enabled: !!user,
    queryFn: async () => (await readJson(`subscriptions?user=${encodeURIComponent(user)}`, user)).subscriptions || [],
    staleTime: 60 * 1000,
  });
}

/** Newest episodes of every followed show, paged by date. */
export function usePodcastLatest(user) {
  return useInfiniteQuery({
    queryKey: ['podcasts', 'latest', user],
    enabled: !!user,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ user, limit: '30' });
      if (pageParam) qs.set('before', pageParam);
      return readJson(`latest?${qs}`, user);
    },
    getNextPageParam: (last) => (last.episodes?.length === 30 ? last.episodes[29].published_at : undefined),
    staleTime: 60 * 1000,
  });
}

const rangeQuery = (since, until) => `${since ? `&since=${encodeURIComponent(since)}` : ''}${until ? `&until=${encodeURIComponent(until)}` : ''}`;

const searchQuery = (q) => (q ? `&q=${encodeURIComponent(q)}` : '');

/**
 * A show and its newest episodes; `since` / `until` (ISO dates) are the show
 * page's date filter, `q` its episode search. `user` (signed in) can read a
 * private feed they follow.
 */
export function usePodcastFeed(feedId, since = '', until = '', q = '', user = null) {
  return useQuery({
    queryKey: ['podcasts', 'feed', feedId, since, until, q, user || ''],
    enabled: !!feedId,
    queryFn: () => readJson(`feed/${feedId}?limit=60${rangeQuery(since, until)}${searchQuery(q)}`, user),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

/** What everyone on 3Speak follows: { top: [...10 most followed], recent: [...recently followed] }. */
export function usePodcastDiscover() {
  return useQuery({
    queryKey: ['podcasts', 'discover'],
    queryFn: () => getJson('discover'),
    staleTime: 60 * 1000,
  });
}

export const fetchOlderEpisodes = (feedId, offset, since = '', until = '', q = '', user = null) =>
  readJson(`feed/${feedId}/older?offset=${offset}&limit=60${rangeQuery(since, until)}${searchQuery(q)}`, user);
export const fetchEpisode = (episodeId, user = null) => readJson(`episode/${encodeURIComponent(episodeId)}`, user);

/** One episode and its show: { episode, feed }. */
export function usePodcastEpisode(episodeId, user = null) {
  return useQuery({
    queryKey: ['podcasts', 'episode', episodeId, user || ''],
    enabled: !!episodeId,
    queryFn: () => fetchEpisode(episodeId, user),
    staleTime: 5 * 60 * 1000,
  });
}

/** The full show notes (raw HTML from the feed; sanitise before showing). */
export function useEpisodeNotes(episodeId, user = null) {
  return useQuery({
    queryKey: ['podcasts', 'notes', episodeId, user || ''],
    enabled: !!episodeId,
    queryFn: async () => (await readJson(`episode/${encodeURIComponent(episodeId)}/notes`, user)).html || '',
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}
/** Podcast Index, Apple Podcasts (in `country`'s store) and fyyd at once, merged by the checker. */
export const searchPodcasts = (q, country = '') => getJson(`search?${new URLSearchParams({ q, country })}`);
/** Shows a host or guest appears in, with how many of their episodes matched. */
export const searchPeople = (q) => getJson(`person?q=${encodeURIComponent(q)}`);

// The top-level podcast categories the checker passes on to Podcast Index (by
// this English name; the label is translated, audio.podcasts.categories.*).
export const TRENDING_CATEGORIES = [
  'Arts', 'Business', 'Comedy', 'Education', 'Fiction', 'Government', 'Health', 'History', 'Kids',
  'Leisure', 'Music', 'News', 'Religion', 'Science', 'Society', 'Sports', 'Technology', 'True Crime', 'TV',
];

/** Apple Podcasts' top charts for one country and category ('' = all), ranked. */
export function usePodcastCharts(country, cat, enabled = true) {
  return useQuery({
    queryKey: ['podcasts', 'charts', country, cat],
    enabled: enabled && !!country,
    queryFn: async () => (await getJson(`charts?${new URLSearchParams({ country, cat })}`)).results || [],
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

// Apple's storefronts, as the checker offers them when it does not say (old checker).
export const CHART_COUNTRIES = [
  'us', 'gb', 'ca', 'au', 'ie', 'nz', 'in', 'za', 'ng', 'ke', 'de', 'at', 'ch', 'fr', 'be', 'nl', 'lu', 'es', 'pt',
  'it', 'pl', 'cz', 'se', 'no', 'dk', 'fi', 'ua', 'tr', 'gr', 'ro', 'hu', 'il', 'ae', 'sa', 'eg', 'mx', 'br', 'ar',
  'co', 'cl', 'pe', 'jp', 'kr', 'tw', 'hk', 'sg', 'ph', 'id', 'my', 'th', 'vn',
];

/** Podcast Index's trending shows, for one language ('' = all) and category ('' = all). */
export function usePodcastTrending(lang, cat, enabled = true) {
  return useQuery({
    queryKey: ['podcasts', 'trending', lang, cat],
    enabled,
    queryFn: async () => (await getJson(`trending?${new URLSearchParams({ lang, cat })}`)).results || [],
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}

export function useInvalidatePodcasts() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['podcasts'] }), [qc]);
}

// ─── Bell ─────────────────────────────────────────────────────────────────────
// No rows on the server: the checker lists episodes that arrived after you
// followed each show, and what you have seen is remembered in this browser.

const seenKey = (user) => `podcast-notifs-seen:${user}`;
const listeners = new Set();
const subscribeSeen = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const readSeen = (user) => {
  try { return Number(localStorage.getItem(seenKey(user))) || 0; } catch { return 0; }
};

export function markPodcastNotificationsSeen(user) {
  if (!user) return;
  try { localStorage.setItem(seenKey(user), String(Date.now())); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

export function usePodcastNotifications(user) {
  const seenAt = useSyncExternalStore(subscribeSeen, () => (user ? readSeen(user) : 0), () => 0);
  const { data } = useQuery({
    queryKey: ['podcasts', 'notifications', user],
    enabled: !!user,
    queryFn: () => readJson(`notifications?user=${encodeURIComponent(user)}`, user),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const feeds = data?.feeds || {};
  const episodes = (data?.episodes || []).map((e) => ({
    ...e,
    feed: feeds[e.feed_id] || null,
    seen: new Date(e.first_seen_at).getTime() <= seenAt,
  }));
  return { episodes, unseenCount: episodes.filter((e) => !e.seen).length };
}

// ─── Cover art ────────────────────────────────────────────────────────────────

/**
 * Cover art comes from the checker (routes/podcasts.js /art), which renders a
 * small square JPEG from the podcast's own image: Hive's image proxy refuses much
 * of it. `art` is the token the API hands out next to every image.
 */
export const ART_SIZES = [64, 128, 256, 512];
export const artUrl = (art, px = 128) => (art ? `${API}/art/${art}/${px}.jpg` : '');

// Shown when a podcast has no cover or it can't be loaded: a microphone in 3Speak
// red on a flat dark tile, not the 3Speak logo, so an outside show never looks
// like one of ours.
export const PODCAST_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>"
  + "<rect width='120' height='120' fill='#2a2a2a'/>"
  + "<g fill='none' stroke='#e53935' stroke-width='5' stroke-linecap='round'>"
  + "<rect x='49' y='28' width='22' height='40' rx='11' fill='#e53935' stroke='none'/>"
  + "<path d='M37 56a23 23 0 0 0 46 0'/><path d='M60 79v12'/><path d='M47 91h26'/>"
  + "<path d='M26 44a36 36 0 0 0 0 26' opacity='.6'/><path d='M94 44a36 36 0 0 1 0 26' opacity='.6'/></g></svg>",
)}`;

/** onError handler for a cover <img>: swap to the placeholder once. */
export function onArtError(e) {
  const img = e.currentTarget;
  if (img.src !== PODCAST_PLACEHOLDER) img.src = PODCAST_PLACEHOLDER;
}

// ─── Playing ──────────────────────────────────────────────────────────────────

/** An episode as a track for the global audio player. */
export function episodeToTrack(ep, feed) {
  return {
    _id: ep.id,
    external: true,
    src: ep.audio_url,
    title: ep.title,
    owner: '',
    show: feed?.title || '',
    show_id: ep.feed_id,
    thumbnail_url: ep.image || feed?.image || '',
    art: ep.art || feed?.art || '',
    duration: ep.duration || 0,
    summary: ep.summary || '',
    link: ep.link || feed?.link || '',
    value: ep.value || feed?.value || null,
    funding: feed?.funding || [],
    feed_url: feed?.url || '',
    // Podcasting 2.0 extras (see the checker's feed parser), only when the feed has them.
    ...pick(ep, EPISODE_EXTRAS),
    ...(ep.private || feed?.private ? { private: true } : {}),
  };
}

const EPISODE_EXTRAS = ['season', 'episode', 'episode_type', 'chapters', 'transcripts', 'persons', 'soundbites', 'video'];
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

/**
 * A show's live stream (podcast:liveItem) as a track: no length, no progress,
 * never downloaded; the player shows LIVE for it.
 */
export function liveToTrack(live, feed) {
  return {
    _id: `live:${feed?.id || ''}:${live.id}`,
    external: true,
    live: true,
    src: live.url,
    mime: live.mime || '',
    title: live.title || feed?.title || '',
    owner: '',
    show: feed?.title || '',
    show_id: feed?.id || '',
    thumbnail_url: feed?.image || '',
    art: feed?.art || '',
    duration: 0,
    summary: '',
    link: live.link || feed?.link || '',
    value: feed?.value || null,
    funding: feed?.funding || [],
    feed_url: feed?.url || '',
    ...(feed?.private ? { private: true } : {}),
  };
}

/** "S2 E14", "E14", "S2" or '' for an episode's numbers. */
export function episodeNumberLabel(ep) {
  const s = Number(ep?.season) > 0 ? `S${Number(ep.season)}` : '';
  const e = Number(ep?.episode) > 0 ? `E${Number(ep.episode)}` : '';
  return [s, e].filter(Boolean).join(' ');
}

export const podcastPath = (feedId) => `/audio?type=external&podcast=${feedId}`;
export const episodePath = (episodeId) => `/audio?type=external&episode=${encodeURIComponent(episodeId)}`;

// ─── Stand-in waveform ────────────────────────────────────────────────────────

const waveCache = new Map();

/**
 * An outside episode has no pre-computed waveform (3Speak uploads do), and its
 * host usually sends no CORS, so the audio can't be analysed in the browser. The
 * player draws this instead: 800 samples in [-1, 1] like the real ones, shaped
 * like speech (slow loudness drift, word-level jitter, the odd pause) and seeded
 * by the episode id, so one episode always shows the same picture. Decorative:
 * it does not follow the actual audio.
 */
export function pseudoWaveform(id, n = 800) {
  if (waveCache.has(id)) return waveCache.get(id);
  let seed = 2166136261;
  for (const ch of String(id)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const phase = [rand(), rand(), rand()].map((p) => p * Math.PI * 2);
  const out = new Array(n);
  let pause = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / n;
    // Loudness drifts slowly over the episode, as voices and segments change.
    const drift = 0.55 + 0.2 * Math.sin(t * 9 + phase[0]) + 0.12 * Math.sin(t * 31 + phase[1]) + 0.08 * Math.sin(t * 87 + phase[2]);
    if (pause > 0) pause -= 1;
    else if (rand() < 0.012) pause = 2 + Math.floor(rand() * 4);
    const level = pause > 0 ? 0.05 + rand() * 0.08 : drift * (0.45 + rand() * 0.55);
    out[i] = Math.max(-1, Math.min(1, (i % 2 ? -1 : 1) * level));
  }
  const result = [out];
  waveCache.set(id, result);
  if (waveCache.size > 50) waveCache.delete(waveCache.keys().next().value);
  return result;
}

// ─── OPML ─────────────────────────────────────────────────────────────────────

/** Every feed in an OPML file (what podcast apps export): [{ url, title }]. */
export function parseOpml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('audio.podcasts.opml.invalid'));
  const seen = new Set();
  const out = [];
  for (const o of doc.querySelectorAll('outline')) {
    const url = (o.getAttribute('xmlUrl') || o.getAttribute('xmlurl') || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: (o.getAttribute('text') || o.getAttribute('title') || '').trim() });
  }
  return out;
}

const xmlEscape = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function buildOpml(subscriptions, user) {
  const lines = subscriptions.map((s) => `    <outline type="rss" text="${xmlEscape(s.title || s.url)}" xmlUrl="${xmlEscape(s.url)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${xmlEscape(`${user} on 3speak.tv`)}</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${lines.join('\n')}
  </body>
</opml>
`;
}

/**
 * Saves the followed shows as an OPML file. Private feeds are left out (the
 * checker never hands out their link, and it would carry the login); returns
 * to how many were left out, so the page can say so.
 */
export function downloadOpml(subscriptions, user) {
  const open = subscriptions.filter((s) => !s.private && s.url);
  const left = subscriptions.length - open.length;
  if (!open.length) return left;
  const blob = new Blob([buildOpml(open, user)], { type: 'text/x-opml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '3speak-podcasts.opml';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return left;
}
