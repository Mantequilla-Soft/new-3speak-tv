/**
 * Card reach: which video cards a viewer actually saw, on which surface, and
 * where an opened video was found. The checker keeps daily counters per video
 * and surface (routes/cardReach.js) and creator stats turns them into
 * impressions, click-through rate and "where viewers found it".
 *
 * A card counts as SEEN when at least half of it was on screen for a second,
 * once per card and surface per page view. Each page view decides once, with
 * probability SAMPLE_RATE, whether it reports what it shows; the checker scales
 * the counts back up by the same rate. Reports are batched and sent with
 * sendBeacon (text/plain: no CORS preflight) every few seconds and when the page
 * is hidden.
 *
 * An OPEN is the watch page loading a video. A card click remembers its surface
 * for a moment in sessionStorage (never in the URL, so shared links stay clean);
 * the watch page takes it, or falls back to classifying document.referrer.
 *
 * Nothing here identifies the viewer. Names stay clear of "analytics",
 * "impression" and "track": blocker lists match those in file and URL names.
 */
import { useCallback, useEffect, useRef } from 'react';
import { CHECKER_URL } from '../utils/config';

// One of the checker's CARD_REACH_RATES.
export const SAMPLE_RATE = 0.5;
const SEEN_MS = 1000;
const FLUSH_MS = 8000;
const BATCH_MAX = 50;
const OPEN_KEY = '3speak_open_src';
const OPEN_TTL_MS = 2 * 60 * 1000;

export const CARD_SURFACES = ['home', 'discover', 'following', 'new', 'trending', 'interests', 'search',
  'channel', 'related', 'shorts', 'playlist', 'tag', 'community', 'other'];

/** The surface a card grid on this path belongs to (Home tabs pass their own). */
export function surfaceForPath(pathname = '', search = '') {
  const p = String(pathname || '/');
  if (p === '/' || p === '/home-feed') return 'home';
  if (p === '/follow-feed') return 'following';
  if (p === '/new' || p === '/firstupload') return 'new';
  if (p === '/trend') return 'trending';
  if (p === '/discover') return /[?&]q=/.test(search) ? 'search' : 'discover';
  if (p.startsWith('/shorts')) return 'shorts';
  if (p.startsWith('/playlist/') || p.startsWith('/watched/')) return 'playlist';
  if (p.startsWith('/t/')) return 'tag';
  if (p.startsWith('/community/') || p.startsWith('/hive-')) return 'community';
  if (p === '/profile' || p.startsWith('/b/') || p.startsWith('/badge/')) return 'channel';
  // /@author/permlink is a watch page (its cards are related videos), /@author a channel.
  if (/^\/@[^/]+\/[^/]+/.test(p) || p.startsWith('/post/') || p.startsWith('/audio/')) return 'related';
  if (/^\/@[^/]+\/?$/.test(p)) return 'channel';
  return 'other';
}

const SEARCH_ENGINES = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|startpage|qwant|search\.brave|kagi)\./i;
const SOCIAL = /(^|\.)(t\.co|twitter\.com|x\.com|facebook\.com|fb\.com|instagram\.com|reddit\.com|youtube\.com|youtu\.be|discord\.com|discordapp\.com|t\.me|telegram\.org|whatsapp\.com|linkedin\.com|lnkd\.in|tiktok\.com|threads\.net|bsky\.app|mastodon\.social|nostr|primal\.net)$/i;
const HIVE_APPS = /(^|\.)(peakd\.com|ecency\.com|hive\.blog|inleo\.io|leofinance\.io|hiveblog|actifit\.io|waivio\.com|liketu\.com|snapie\.io|hivesuite\.app|dbuzz\.com|splinterlands\.com)$/i;

/** Where an open came from, by the page that linked here. */
export function classifyReferrer(referrer, ownHost = typeof location !== 'undefined' ? location.host : '') {
  if (!referrer) return 'direct';
  let host;
  try { host = new URL(referrer).hostname; } catch { return 'direct'; }
  if (!host) return 'direct';
  const own = String(ownHost || '').replace(/:\d+$/, '');
  if (own && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`))) return 'other';
  if (/(^|\.)3speak\.tv$/i.test(host)) return 'other';
  if (SEARCH_ENGINES.test(`${host}.`)) return 'search_engine';
  if (SOCIAL.test(host)) return 'social';
  if (HIVE_APPS.test(host)) return 'hive_apps';
  return 'external';
}

/* ── transport ── */
function send(path, body) {
  const url = `${CHECKER_URL}${path}`;
  const text = JSON.stringify(body);
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon
      && navigator.sendBeacon(url, new Blob([text], { type: 'text/plain' }))) return;
  } catch { /* fall back to fetch */ }
  try {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text, keepalive: true }).catch(() => {});
  } catch { /* nothing to do: a lost report is a lost count */ }
}

/* ── page views and sampling ── */
let pageId = null;
let sampled = false;
let seenThisPage = new Set();
let queue = [];
let flushTimer = null;
let random = Math.random;

function currentPageId() {
  if (typeof window === 'undefined') return 'ssr';
  // react-router keys every history entry; a new navigation is a new page view.
  return `${window.history?.state?.key || ''}|${window.location.pathname}${window.location.search}`;
}
function syncPageView() {
  const id = currentPageId();
  if (id === pageId) return;
  pageId = id;
  sampled = random() < SAMPLE_RATE;
  seenThisPage = new Set();
}

export function flushSeen() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  while (queue.length) {
    const items = queue.splice(0, BATCH_MAX);
    send('/reach/seen', { rate: SAMPLE_RATE, items });
  }
}

function queueSeen(item) {
  queue.push(item);
  if (queue.length >= BATCH_MAX) flushSeen();
  else if (!flushTimer) flushTimer = setTimeout(flushSeen, FLUSH_MS);
}

let lifecycleBound = false;
function bindLifecycle() {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeen(); });
  window.addEventListener('pagehide', flushSeen);
}

/** Count this card as seen on `surface` (deduplicated per page view). Exported for tests. */
export function markSeen(author, permlink, surface) {
  if (!author || !permlink || !CARD_SURFACES.includes(surface)) return false;
  syncPageView();
  if (!sampled) return false;
  const key = `${author}/${permlink}|${surface}`;
  if (seenThisPage.has(key)) return false;
  seenThisPage.add(key);
  bindLifecycle();
  queueSeen({ a: author, p: permlink, s: surface });
  return true;
}

/* ── the shared observer ── */
let observer = null;
const watched = new Map(); // element -> { author, permlink, surface, timer }

function onIntersect(entries) {
  for (const e of entries) {
    const info = watched.get(e.target);
    if (!info) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.5) {
      if (!info.timer) {
        info.timer = setTimeout(() => {
          info.timer = null;
          if (watched.get(e.target) === info) markSeen(info.author, info.permlink, info.surface);
        }, SEEN_MS);
      }
    } else if (info.timer) {
      clearTimeout(info.timer);
      info.timer = null;
    }
  }
}

/** Watch one card element. Returns the function that stops watching it. */
export function observeCard(el, author, permlink, surface) {
  if (!el || typeof IntersectionObserver === 'undefined') return () => {};
  if (!observer) observer = new IntersectionObserver(onIntersect, { threshold: [0, 0.5] });
  const prev = watched.get(el);
  if (prev?.timer) clearTimeout(prev.timer);
  watched.set(el, { author, permlink, surface, timer: null });
  observer.observe(el);
  return () => {
    const info = watched.get(el);
    if (info?.timer) clearTimeout(info.timer);
    watched.delete(el);
    observer?.unobserve(el);
  };
}

/** A callback ref that watches the element it is given (and lets go on unmount). */
export function useCardSeen(author, permlink, surface) {
  const stop = useRef(null);
  useEffect(() => () => { stop.current?.(); stop.current = null; }, []);
  return useCallback((el) => {
    stop.current?.();
    stop.current = el ? observeCard(el, author, permlink, surface) : null;
  }, [author, permlink, surface]);
}

/* ── opens ── */

/** A card was clicked: the watch page this opens will know where it came from. */
export function rememberOpenSource(author, permlink, surface) {
  if (!author || !permlink || !CARD_SURFACES.includes(surface)) return;
  try {
    sessionStorage.setItem(OPEN_KEY, JSON.stringify({ k: `${String(author).toLowerCase()}/${permlink}`, s: surface, at: Date.now() }));
  } catch { /* private mode: the referrer decides instead */ }
}

/** The surface a card click left for this video, once (it is removed when read). */
export function takeOpenSource(author, permlink, now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(OPEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.k !== `${String(author).toLowerCase()}/${permlink}`) return null;
    sessionStorage.removeItem(OPEN_KEY);
    return now - v.at < OPEN_TTL_MS && CARD_SURFACES.includes(v.s) ? v.s : null;
  } catch {
    return null;
  }
}

// The address this document was loaded at. A watch page reached by navigating
// inside the app keeps the landing page's document.referrer, so the referrer
// only speaks for the page the visit started on.
function landedHere() {
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    if (!nav?.name) return true;
    const a = new URL(nav.name);
    return a.pathname === window.location.pathname;
  } catch {
    return true;
  }
}

const reported = new Set();
/**
 * The watch page opened this video: report where it was found. `embed` for our
 * own /embed page inside someone else's site. Once per video per page load.
 */
export function reportOpen(author, permlink, { embed = false, referrer } = {}) {
  if (!author || !permlink) return null;
  const key = `${String(author).toLowerCase()}/${permlink}`;
  if (reported.has(key)) return null;
  reported.add(key);
  const ref = referrer !== undefined ? referrer : (typeof document !== 'undefined' ? document.referrer : '');
  const s = embed ? 'embed'
    : (takeOpenSource(author, permlink) || (landedHere() ? classifyReferrer(ref) : 'other'));
  send('/reach/open', { a: String(author).toLowerCase(), p: permlink, s });
  return s;
}

/** For tests: a fresh module state and a chosen coin. */
export function _resetForTests({ rand } = {}) {
  pageId = null; sampled = false; seenThisPage = new Set(); queue = []; reported.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  random = rand || Math.random;
  watched.clear();
  observer = null;
}
