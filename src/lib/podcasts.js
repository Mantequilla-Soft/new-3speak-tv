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

/** Follow one or more feeds. Resolves to the per-URL results [{ url, ok, feed_id, already, code, owner }]. */
export async function followFeeds(user, urls, titles = []) {
  const clean = urls.map((u) => String(u).trim()).filter(Boolean);
  const signed = await sign('subscribe', await sha256Hex(clean.join('\n')), user);
  const data = await post('subscribe', { user, urls: clean, titles, ...signed });
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
export function followErrorText(code) {
  const known = {
    bad_url: 'badUrl', blocked_address: 'badUrl', not_a_podcast: 'notPodcast', parse_error: 'notPodcast',
    no_episodes: 'noEpisodes', too_large: 'tooLarge', timeout: 'unreachable', network: 'unreachable',
    limit: 'limit', internal_feed: 'internal', disabled: 'disabled',
  };
  const key = known[code] || (String(code || '').startsWith('http_') ? 'unreachable' : 'generic');
  return t(`audio.podcasts.errors.${key}`);
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
    queryFn: async () => (await getJson(`subscriptions?user=${encodeURIComponent(user)}`)).subscriptions || [],
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
      return getJson(`latest?${qs}`);
    },
    getNextPageParam: (last) => (last.episodes?.length === 30 ? last.episodes[29].published_at : undefined),
    staleTime: 60 * 1000,
  });
}

const rangeQuery = (since, until) => `${since ? `&since=${encodeURIComponent(since)}` : ''}${until ? `&until=${encodeURIComponent(until)}` : ''}`;

/** A show and its newest episodes; `since` / `until` (ISO dates) are the show page's date filter. */
export function usePodcastFeed(feedId, since = '', until = '') {
  return useQuery({
    queryKey: ['podcasts', 'feed', feedId, since, until],
    enabled: !!feedId,
    queryFn: () => getJson(`feed/${feedId}?limit=60${rangeQuery(since, until)}`),
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

export const fetchOlderEpisodes = (feedId, offset, since = '', until = '') =>
  getJson(`feed/${feedId}/older?offset=${offset}&limit=60${rangeQuery(since, until)}`);
export const fetchEpisode = (episodeId) => getJson(`episode/${encodeURIComponent(episodeId)}`);

/** One episode and its show: { episode, feed }. */
export function usePodcastEpisode(episodeId) {
  return useQuery({
    queryKey: ['podcasts', 'episode', episodeId],
    enabled: !!episodeId,
    queryFn: () => fetchEpisode(episodeId),
    staleTime: 5 * 60 * 1000,
  });
}

/** The full show notes (raw HTML from the feed; sanitise before showing). */
export function useEpisodeNotes(episodeId) {
  return useQuery({
    queryKey: ['podcasts', 'notes', episodeId],
    enabled: !!episodeId,
    queryFn: async () => (await getJson(`episode/${encodeURIComponent(episodeId)}/notes`)).html || '',
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}
export const searchPodcasts = (q) => getJson(`search?q=${encodeURIComponent(q)}`);
/** Shows a host or guest appears in, with how many of their episodes matched. */
export const searchPeople = (q) => getJson(`person?q=${encodeURIComponent(q)}`);

// The top-level podcast categories the checker passes on to Podcast Index (by
// this English name; the label is translated, audio.podcasts.categories.*).
export const TRENDING_CATEGORIES = [
  'Arts', 'Business', 'Comedy', 'Education', 'Fiction', 'Government', 'Health', 'History', 'Kids',
  'Leisure', 'Music', 'News', 'Religion', 'Science', 'Society', 'Sports', 'Technology', 'True Crime', 'TV',
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
    queryFn: () => getJson(`notifications?user=${encodeURIComponent(user)}`),
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
  };
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

export function downloadOpml(subscriptions, user) {
  const blob = new Blob([buildOpml(subscriptions, user)], { type: 'text/x-opml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '3speak-podcasts.opml';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
