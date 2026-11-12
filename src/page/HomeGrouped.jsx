import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import UploadBlockNotice from "../components/UploadBlockNotice/UploadBlockNotice";
import { spotlightAllowed } from "../utils/spotlightRules";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import "./HomeGrouped.scss";
import { SkeletonCard } from "../components/Cards/GridSkeleton";
import Card3 from "../components/Cards/Card3";
import { FEED_URL, TRENDING_SORTED_URL, FOLLOW_FEED_URL, DISCOVER_FEED_URL, INTERESTS_FEED_URL, NEW_CONTENT_URL, CHECKER_URL, appendNsfw, warmupRailEnabledFor } from "../utils/config";
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { batchCheckWatched } from "../utils/watchHistory";
import { getHidden, withViewer, useDismissals, isDismissed } from "../utils/userFilters";
import { aiKey, isAiFlagged, loadAiFlags } from "../utils/aiFlags";
import useViewCounts from "../hooks/useViewCounts";
import { useAppStore } from "../lib/store";
import { getFeedSeed, refreshHomeFeeds } from "../utils/feedSeed";
import ShortsStories from "../components/ShortsStories/ShortsStories";
import WelcomeBanner from "../components/WelcomeTour/WelcomeBanner";
import NewFromFollowing from "../components/NewFromFollowing/NewFromFollowing";
import SuggestedCreators from "../components/SuggestedCreators/SuggestedCreators";
import { useWarmupVideos, useFollowedWarmupVideos } from "../hooks/useWarmupVideos";
import { useLiveStreams } from "../hooks/useLiveStreams";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import ShortsRow from "../components/ShortsRow/ShortsRow";
import { useAiFilteredShorts } from "../hooks/useAiFilteredShorts";
import { useGridColumns, useShortsPerRow, useTilesPerRow } from "../hooks/useGridMetrics";
import { fetchCommunityFeed } from "../lib/snaps";
import { SnapCard } from "../components/Userprofilepage/CommunitySnaps";
import { fetchPlaylistsFeed } from "../lib/playlistsFeed";
import PlaylistFeedCard from "../components/Cards/PlaylistFeedCard";
import AudioTile from "../components/AudioTile/AudioTile";
import { audioItemPath } from "../components/AudioItem/AudioItemView";
import { SHORTS_API_URL } from "../utils/config";
import { Icon } from "../components/v2/Icon";
import { Button, Dialog, EmptyState, IconButton, Toggle } from "../components/v2/ui";
import { cx } from "../components/v2/helpers";
import { useTranslation } from "react-i18next";
import useCardSize from "../hooks/useCardSize";
import HomeHero from "../components/HomeHero/HomeHero";
import HomeActivity from "../components/HomeActivity/HomeActivity";
import { fetchFeaturedPages } from "../lib/featuredPages";
import { spreadIn } from "../lib/spreadIn";

// Extra feed params for the logged-in user: interests (checker weights the feed
// toward them), currentuser (needed for BOTH the always-on dismissals and
// hide-watched) and the hide-watched preference itself. Empty when logged out.
const feedParams = () => {
  const st = useAppStore.getState();
  let p = '';
  const list = st.interests;
  if (Array.isArray(list) && list.length) p += `&interests=${encodeURIComponent(list.join(','))}`;
  if (st.user) {
    p += `&currentuser=${encodeURIComponent(st.user)}`;
    p += `&hidewatched=${st.hideWatched ? '1' : '0'}`;
  }
  // Pin the shuffle to THIS page load. Without a seed the checker falls back to a
  // 5-minute time bucket, which reshuffled the feed under the user every 5 minutes
  // even if they never navigated or refreshed. One seed per page load means the
  // order is stable across navigation and only changes on a real refresh.
  p += `&seed=${getFeedSeed()}`;
  return p;
};

// Page sizes per feed — used to decide whether another page exists.
const PAGE_MAIN = 50;   // trending / follow / new
const PAGE_POOL = 30;   // discover / interests

// Fetch functions for each feed (paginated).
const fetchHome = async (page = 1) => {
  // Use the checker's trendingSorted feed for the "home" group — the older
  // /apiv2/feeds/home path on legacy is gone now that FEED_URL points at the
  // checker. trendingSorted is the broadest curated set the checker exposes.
  const res = await axios.get(`${TRENDING_SORTED_URL}?page=${page}&limit=${PAGE_MAIN}${feedParams()}`);
  return res.data.videos || res.data.trends || [];
};

const fetchFollowFeed = async (username, page = 1) => {
  const res = await axios.get(appendNsfw(`${FOLLOW_FEED_URL}/${username}?page=${page}&limit=${PAGE_MAIN}${feedParams()}`, useAppStore.getState().showNsfw));
  return res.data?.videos || [];
};

// Discovery row: driven by interests + watch-retention, blind to votes/views.
// The checker seeds its shuffle in 5-minute buckets, so paging within that window
// stays consistent without us pinning a seed.
const fetchDiscover = async (page = 1) => {
  const res = await axios.get(appendNsfw(`${DISCOVER_FEED_URL}?page=${page}&limit=${PAGE_POOL}${feedParams()}`, useAppStore.getState().showNsfw));
  return res.data?.videos || [];
};

// Featured (the Spotlight): one of the best-performing videos of the last 48 hours,
// drawn large as the first card of the Discover tab. "Best" = Hive rewards, and
// nothing else. NOT the trending score: that counts the old view counter (one per
// play, no de-duplication, bot-inflated before the purge), and for videos from the
// new uploader the checker has no vote or comment counts (it sends 0), so views
// alone carried a 57-minute upload with 41 views and no votes, comments or rewards
// into the top 10. Rewards come live from Hive for every video, old or new.
// The candidates come newest-first (`chrono=1`), so the views-based score does not
// even decide which videos are looked at, and without currentuser, which would tilt
// toward creators the viewer follows: these are the top videos for everyone. The
// viewer's own filters are applied here instead: anything they watched (whatever
// their hide-watched setting), dismissed, or whose creator they hid, and with
// "Hide AI-generated" on, anything flagged as AI. That has to happen here, before
// a video is picked: the grid drops an AI card itself, and when that card was the
// big one the whole Spotlight went with it. Returns the remaining candidates in
// rank order; orderFeatured shuffles the first twenty.
const FEATURED_WINDOW_MS = 48 * 60 * 60 * 1000;
const FEATURED_TOP = 20;
// At least this much in Hive rewards to be in the Spotlight at all.
const FEATURED_MIN_REWARD = 1;
const FEATURED_PAGE = 100;
const FEATURED_MAX_PAGES = 3;

const fetchFeatured = async (viewer, hideAi) => {
  const since = Date.now() - FEATURED_WINDOW_MS;
  const createdAt = (v) => new Date(v.created || v.created_at).getTime();
  const rewardOf = (v) => Number(v.stats?.total_hive_reward || 0);
  // Newest first, until a page reaches back past the window. Pages 1 and 2 at
  // once, page 1 usually already asked for by index.html (lib/featuredPages.js).
  // 🚨 index.html's early script builds the same URL: keep both in step.
  const showNsfw = useAppStore.getState().showNsfw;
  const all = await fetchFeaturedPages({
    getPage: (page) => axios.get(appendNsfw(
      `${TRENDING_SORTED_URL}?page=${page}&limit=${FEATURED_PAGE}&chrono=1`,
      showNsfw,
    )).then((res) => res.data),
    showNsfw,
    since,
    pageSize: FEATURED_PAGE,
    maxPages: FEATURED_MAX_PAGES,
    createdAt,
  });
  const authorOf = (v) => v.author?.username || v.author || v.owner;
  // The watched lookup takes 50 at most, and a pool that deep is plenty.
  const recent = all
    .filter((v) => createdAt(v) >= since && rewardOf(v) >= FEATURED_MIN_REWARD && spotlightAllowed(v))
    .sort((a, b) => rewardOf(b) - rewardOf(a))
    .slice(0, 50);
  const norm = (x) => String(x || '').toLowerCase();
  // One video per creator: their best. Applied AFTER the viewer's filters, so a
  // creator whose best video they already watched can still be there with the next.
  const onePerCreator = (list) => {
    const seen = new Set();
    return list.filter((v) => {
      const who = norm(authorOf(v));
      if (seen.has(who)) return false;
      seen.add(who);
      return true;
    });
  };
  // The same lookup keys as the grid's AI pill (Card3 aiKeysFor): the hive author,
  // and the owner when a different account owns the asset. A failed lookup reads
  // as "not flagged", so the Spotlight never disappears over an outage.
  // Asked for the whole pool at once, alongside the watched / hidden lookups.
  const aiKeysOf = (v) => [aiKey(authorOf(v), v.permlink), v.owner ? aiKey(v.owner, v.permlink) : null];
  const aiReady = hideAi && recent.length ? loadAiFlags(recent.flatMap(aiKeysOf).filter(Boolean)) : null;
  const dropAi = (list) => (hideAi
    ? list.filter((v) => !isAiFlagged(authorOf(v), v.permlink) && !(v.owner && isAiFlagged(v.owner, v.permlink)))
    : list);
  if (!viewer || !recent.length) {
    await aiReady;
    return onePerCreator(dropAi(recent));
  }
  const [watched, hidden] = await Promise.all([
    batchCheckWatched(viewer, recent.map((v) => ({ author: authorOf(v), permlink: v.permlink }))),
    getHidden(viewer),
    aiReady,
  ]);
  const hiddenVideos = new Set(hidden.videos.map((h) => `${norm(h.owner)}/${norm(h.permlink)}`));
  const hiddenCreators = new Set(hidden.creators.map((h) => norm(h.creator)));
  return onePerCreator(dropAi(recent.filter((v) => {
    const people = [norm(authorOf(v)), norm(v.owner)];
    return !watched.has(`${authorOf(v)}/${v.permlink}`)
      && !people.some((p) => hiddenCreators.has(p) || hiddenVideos.has(`${p}/${norm(v.permlink)}`));
  })));
};

// The last Spotlight pool for this viewer and these filters, so a returning
// visitor's hero shows at once while the fresh pool loads (owner 2026-11-12:
// the landing page should load faster). Shown as placeholder data only: the
// real fetch always runs, and HomeHero keeps its slide when the order changes.
const FEATURED_CACHE = "featured-pool-v1";
const readFeaturedCache = (key) => {
  try {
    const c = JSON.parse(localStorage.getItem(FEATURED_CACHE) || "null");
    // The rule above applies to a pool cached before it existed, too.
    const pool = c && c.key === key && Array.isArray(c.pool) ? c.pool.filter(spotlightAllowed) : [];
    return pool.length ? pool : undefined;
  } catch { return undefined; }
};
const writeFeaturedCache = (key, pool) => {
  try { localStorage.setItem(FEATURED_CACHE, JSON.stringify({ key, at: Date.now(), pool: (pool || []).slice(0, 30) })); } catch { /* full or blocked */ }
};

// The top FEATURED_TOP in a random order fixed for the page load: each candidate's
// place comes from hashing the session seed with its key, so a reload (new seed)
// shuffles again, while watching the featured video (it leaves the pool) hands
// over to the one that was already next, instead of reshuffling the rest. The
// hero (HomeHero) starts on the first and slides through the others.
const featuredKeyOf = (v) => `${v.author?.username || v.author || v.owner}/${v.permlink}`;
const seededRank = (seed, key) => {
  let h = 2166136261 ^ seed; // FNV-1a
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const orderFeatured = (pool, seed) => (pool || [])
  .slice(0, FEATURED_TOP)
  .map((v) => ({ v, r: seededRank(seed, featuredKeyOf(v)) }))
  .sort((a, b) => a.r - b.r)
  .map(({ v }) => v);

// From 1280px up the activity panel sits beside the feed (20a) and takes over
// the community posts the feed otherwise mixes in (v2.wide).
const WIDE_QUERY = "(min-width: 1280px)";
const useMedia = (query) => {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setOn(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return on;
};

// "Interests" row: ONLY videos whose winning topic is in the user's interests,
// re-ranked by retention with older ones sprinkled in. Empty with no interests.
// Uses the DEDICATED /feeds/interests endpoint, which has its own topic-stratified
// pool. The old `/feeds/discover?interestsOnly=1` filtered the discover pool — a
// uniform sample of the catalogue — so niche topics ran out after a page or two
// (science surfaced 29 of its 785 videos). Now every topic has ~25+ pages.
const fetchInterestsFeed = async (page = 1) => {
  const res = await axios.get(appendNsfw(`${INTERESTS_FEED_URL}?page=${page}&limit=${PAGE_POOL}${feedParams()}`, useAppStore.getState().showNsfw));
  return res.data?.videos || [];
};


// Shorts sprinkled between the Discover rows. Paginated, and pulled in as the feed
// grows, so the rails keep coming instead of stopping at a fixed count. Each rail
// takes the NEXT slice, so no short repeats down the page.
const SHORTS_PAGE = 60;       // per request

// Shorts params. NOT feedParams(): that appends `&chrono=1` when "simple feeds" is
// on, and the New rail also needs chrono — express would then parse `chrono` as the
// ARRAY ['1','1'] and `req.query.chrono === '1'` would be false, silently disabling
// it. So build the params here and emit chrono exactly once.
// Discover and Interests both draw from the RANKED shorts feed, so without this
// they'd share a seed and show the identical shorts. Offset the session seed per
// section so each feed gets its own shuffle (mulberry32 diverges completely for any
// distinct integer seed). Irrelevant for `new` (date-sorted), harmless there.
const SHORTS_SEED_OFFSET = { discover: 0, interests: 7919, home: 15733, new: 24917 };

const shortsParams = (mode, sectionKey) => {
  const st = useAppStore.getState();
  let p = `&seed=${getFeedSeed() + (SHORTS_SEED_OFFSET[sectionKey] || 0)}`;
  if (Array.isArray(st.interests) && st.interests.length) p += `&interests=${encodeURIComponent(st.interests.join(','))}`;
  if (st.user) {
    p += `&currentuser=${encodeURIComponent(st.user)}`;
    p += `&hidewatched=${st.hideWatched ? '1' : '0'}`;
    if (mode === 'follow') p += `&followedby=${encodeURIComponent(st.user)}`;
  }
  if (mode === 'chrono') p += '&chrono=1';
  return p;
};

// A different SEED only reshuffles the same shorts — the shorts ranking is
// recency-dominated, so the newest float to the top of both feeds regardless. To
// make Interests show genuinely DIFFERENT shorts from Discover, start it a page in.
const SHORTS_PAGE_OFFSET = { discover: 0, interests: 1, home: 0, new: 0 };

const fetchFeedShorts = async (mode, sectionKey, page = 1) => {
  const offset = SHORTS_PAGE_OFFSET[sectionKey] || 0;
  const url = (p) => appendNsfw(
    `${SHORTS_API_URL}?page=${p}&limit=${SHORTS_PAGE}${shortsParams(mode, sectionKey)}`,
    useAppStore.getState().showNsfw,
  );

  const res = await axios.get(url(page + offset));
  const shorts = res.data?.shorts || [];

  // A small shorts pool may not HAVE the offset page. Rather than leaving the feed
  // with no rails at all, fall back to the un-offset page.
  if (!shorts.length && offset && page === 1) {
    const fb = await axios.get(url(page));
    return fb.data?.shorts || [];
  }
  return shorts;
};

// Promoted leads every feed, so the checker drops dismissed and (with the
// preference on) already-watched promos up front. Filtering only client-side
// flashed a watched promo for a split second until watch history loaded.
const fetchPromoted = async () => {
  const st = useAppStore.getState();
  const viewer = st.user ? `&currentuser=${encodeURIComponent(st.user)}&hidewatched=${st.hideWatched ? '1' : '0'}` : '';
  const res = await axios.get(appendNsfw(`${CHECKER_URL}/feeds/promoted?limit=20${viewer}`, st.showNsfw));
  return res.data?.videos || [];
};

// "New Content" stays purely chronological — no interests, no retention, and
// never hide-watched (hidewatched=0). Still passes currentuser so the checker can
// drop explicit dismissals, which apply on every feed.
const fetchNewContent = async (page = 1) => {
  const st = useAppStore.getState();
  const dismissals = st.user ? `&currentuser=${encodeURIComponent(st.user)}&hidewatched=0` : '';
  const res = await axios.get(appendNsfw(`${NEW_CONTENT_URL}?page=${page}&limit=${PAGE_MAIN}${dismissals}`, st.showNsfw));
  return res.data?.videos || [];
};


// New 3Speak audio for the Discover community rows: the last 3 days, newest
// first (the checker reads `from=3` as "3 days ago").
const AUDIO_FEED_DAYS = 3;
const AUDIO_FEED_PAGE = 50;
// Service accounts whose audio and playlists never show in the feed (the audio
// page hides the same ones, HIDDEN_AUDIO_OWNERS in Audio.jsx).
const HIDDEN_OWNERS = new Set(['badadib']);
const fetchFeedAudio = async (page = 1) => {
  const { showNsfw, user } = useAppStore.getState();
  // The viewer rides along so creators they hid stay out of the stream.
  const res = await axios.get(appendNsfw(withViewer(`${CHECKER_URL}/audio?from=${AUDIO_FEED_DAYS}&page=${page}&limit=${AUDIO_FEED_PAGE}`, user), showNsfw));
  return res.data?.audio || [];
};

// Warm-up videos slotted into a newest-first feed at their own date, ahead of
// the first video older than them. One older than everything loaded so far
// waits for the page that reaches its date (or the end of the feed), so it does
// not sit at the bottom and then jump up as more pages arrive.
const placeByDate = (videos, extras, complete) => {
  if (!extras.length) return videos;
  const at = (v) => new Date(v.created || v.created_at).getTime() || 0;
  const out = [...videos];
  // Newest first, so each lands after the newer warm-up videos placed before it.
  for (const x of [...extras].sort((a, b) => at(b) - at(a))) {
    const i = out.findIndex((v) => at(v) < at(x));
    if (i >= 0) out.splice(i, 0, x);
    else if (complete) out.push(x);
  }
  return out;
};

// getNextPageParam: keep paging as long as the last page returned ANYTHING. This
// is more robust than requiring an exactly-full page (server-side filtering can
// trim a page below `limit` even when more pages exist); the feed stops on the
// first empty page. One extra (empty) request at the very end is fine.
const nextPage = () => (lastPage, allPages) =>
  (lastPage?.length || 0) > 0 ? allPages.length + 1 : undefined;

// Discover keeps two videos by the same creator at least this many cards apart,
// so one creator never fills a screen. Nothing is hidden: a video that comes too
// soon waits and goes in as soon as it fits. A card count, not rows, on purpose:
// tied to the column count, resizing the window would reshuffle the feed.
const CREATOR_SPACING = 8;

/**
 * Reorder a feed so the same creator is at least CREATOR_SPACING cards apart.
 * Deterministic and append-safe: the output for the first N videos never
 * depends on what comes after them, so when the next page loads, cards already
 * on screen do not move. A video still waiting at the end of the loaded pages is
 * held back for the next page; only once the feed is `complete` (no more pages)
 * do the leftovers go at the end, closer together than the spacing.
 */
const spreadCreators = (videos, complete) => {
  const who = (v) => String(v.author?.username || v.author || v.owner || '').toLowerCase();
  const out = [];
  const lastAt = new Map(); // creator -> position of their latest card in `out`
  const waiting = [];
  const fits = (v) => !lastAt.has(who(v)) || out.length - lastAt.get(who(v)) >= CREATOR_SPACING;
  const place = (v) => { lastAt.set(who(v), out.length); out.push(v); };
  // Waiting videos go first, oldest first, whenever one fits again
  const drain = () => {
    for (let i = 0; i < waiting.length;) {
      if (fits(waiting[i])) { place(waiting.splice(i, 1)[0]); i = 0; } else i++;
    }
  };
  for (const v of videos) {
    drain();
    if (fits(v)) place(v); else waiting.push(v);
  }
  drain();
  if (complete) waiting.forEach(place);
  return out;
};

// Helper to deduplicate videos by author+permlink
const deduplicateVideos = (videos) => {
  const seen = new Set();
  return videos.filter(video => {
    const author = video.author?.username || video.author || video.owner;
    const key = `${author}-${video.permlink}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Section icons (Material Symbols) shown in the tab bar and the Customize dialog (34b).
const iconsByTitle = {
  "Home Feed": "home",
  "Follow Feed": "subscriptions",
  "New Content": "schedule",
  "Promoted": "rocket_launch",
  "Discover": "explore",
  "Interests": "interests",
};

// ── Persisted custom tab order (array of section keys) in localStorage ──
const TAB_ORDER_KEY = "3speak_home_tab_order";
const loadTabOrder = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || "null");
    return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : [];
  } catch { return []; }
};
const saveTabOrder = (order) => {
  try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
};

// ── The tab you were on, by KEY ('discover', 'home', 'interests', 'new'), not by
// position: Interests only exists for some accounts and the order is draggable, so
// a saved index would land on a different feed. ──
const ACTIVE_TAB_KEY = "3speak_home_active_tab";
const loadActiveTab = () => {
  try { return localStorage.getItem(ACTIVE_TAB_KEY) || null; } catch { return null; }
};
const saveActiveTab = (key) => {
  try { localStorage.setItem(ACTIVE_TAB_KEY, key); } catch { /* ignore */ }
};

// ── Sections the viewer turned off in Customize Home (array of keys) ──
const HIDDEN_TABS_KEY = "3speak_home_hidden_tabs";
const loadHiddenTabs = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(HIDDEN_TABS_KEY) || "null");
    return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : [];
  } catch { return []; }
};
const saveHiddenTabs = (keys) => {
  try { localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
};

// Reorder sections by the saved order; new/unknown keys keep their natural spot.
const applyTabOrder = (sections, order) => {
  if (!order || !order.length) return sections;
  const bySection = new Map(sections.map((s) => [s.key, s]));
  const out = [];
  for (const key of order) if (bySection.has(key)) { out.push(bySection.get(key)); bySection.delete(key); }
  for (const s of sections) if (bySection.has(s.key)) out.push(s);
  return out;
};

// Customize Home (34b): drag the sections by their grip (or move them with the
// arrows, which show on keyboard focus), and turn off the ones you don't want.
// Below the feeds, two switches for what the feeds mix in: the Shorts rails
// (the same setting as in Settings) and live streams. Mounted only while open,
// so it starts from the saved layout. At least one feed always stays on.
function CustomizeHomeDialog({ sections, hidden, onClose, onSave }) {
  const { t } = useTranslation();
  const inlineShorts = useAppStore((st) => st.inlineShorts);
  const setInlineShorts = useAppStore((st) => st.setInlineShorts);
  const byKey = useMemo(() => new Map(sections.map((s) => [s.key, s])), [sections]);
  const [order, setOrder] = useState(() => sections.map((s) => s.key));
  const [off, setOff] = useState(() => new Set(hidden));
  const [shortsOn, setShortsOn] = useState(inlineShorts !== false);
  const [dragKey, setDragKey] = useState(null);
  const listRef = useRef(null);
  const onCount = order.filter((k) => !off.has(k)).length;
  const move = (i, dir) => setOrder((prev) => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (key, on) => setOff((prev) => {
    const next = new Set(prev);
    if (on) next.delete(key); else next.add(key);
    return next;
  });
  // Drag by the grip: the row under the pointer's height takes the dragged one.
  const onGripDown = (key) => (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragKey(key);
  };
  const onGripMove = (e) => {
    if (!dragKey || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll('[data-section-key]')];
    const over = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY >= b.top && e.clientY <= b.bottom;
    });
    const target = over?.dataset.sectionKey;
    if (!target || target === dragKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== dragKey);
      next.splice(prev.indexOf(target), 0, dragKey);
      return next;
    });
  };
  const onGripUp = () => setDragKey(null);
  const save = () => {
    if (shortsOn !== (inlineShorts !== false)) setInlineShorts(shortsOn);
    onSave(order, [...off].filter((k) => byKey.has(k) || k === 'live'));
  };
  const row = ({ key, icon, label, on, onChange, canDisable = true, grip = true, i }) => (
    <div key={key} data-section-key={grip ? key : undefined} className={cx('home-customize-row', !on && 'is-off', dragKey === key && 'is-dragging')}>
      {grip ? (
        <span className="home-customize-grip" aria-hidden="true" title={t('feeds.home.dragToReorder')}
          onPointerDown={onGripDown(key)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
          <Icon name="drag_indicator" size={20} />
        </span>
      ) : <span className="home-customize-grip is-blank" aria-hidden="true" />}
      <span className="home-customize-icon"><Icon name={icon} size={20} /></span>
      <b className="home-customize-label">{label}</b>
      {grip && (
        <span className="home-customize-moves">
          <IconButton icon="arrow_upward" label={t('profile.layout.moveUp')} size={32} variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} />
          <IconButton icon="arrow_downward" label={t('profile.layout.moveDown')} size={32} variant="ghost" disabled={i === order.length - 1} onClick={() => move(i, 1)} />
        </span>
      )}
      <Toggle
        checked={on}
        label={on ? t('profile.layout.hide') : t('profile.layout.show')}
        disabled={on && !canDisable}
        onChange={onChange}
      />
    </div>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('feeds.home.customizeTitle')}
      width={460}
      className="home-customize-dialog"
      closeLabel={t('common.actions.close')}
      footer={(
        <Button variant="primary" size={48} block trailing="check" className="home-customize-save" onClick={save}>
          {t('profile.layout.save')}
        </Button>
      )}
    >
      <p className="home-customize-hint">{t('feeds.home.customizeHint')}</p>
      <div className="home-customize-list" ref={listRef}>
        {order.map((key, i) => {
          const s = byKey.get(key);
          if (!s) return null;
          const on = !off.has(key);
          return row({ key, icon: iconsByTitle[s.title] || 'view_day', label: s.label, on, i, canDisable: onCount > 1, onChange: (v) => toggle(key, v) });
        })}
        {row({ key: 'shorts', icon: 'view_day', label: t('feeds.tabs.shorts'), on: shortsOn, grip: false, onChange: setShortsOn })}
        {row({ key: 'live', icon: 'sensors', label: t('feeds.live.title'), on: !off.has('live'), grip: false, onChange: (v) => toggle('live', v) })}
      </div>
    </Dialog>
  );
}

// Bottom-of-list sentinel — fires onLoadMore when it scrolls into view (600px
// early) so the next page is fetched before the user hits the actual end.
function InfiniteSentinel({ hasMore, loading, onLoadMore }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEffect(() => {
    if (!hasMore) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) onLoadMore();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadMore]);
  if (!hasMore) return null;
  return <div ref={ref} className="home-tab-sentinel">{loading && <span className="home-tab-loading">{t('feeds.loadingMore')}</span>}</div>;
}

// Tracks which cards (by their data-vidkey) have scrolled near the viewport, so
// we only fetch metadata for those. Accumulates across scroll; re-observes new
// cards when the list grows (`sig`/`count` change). Returns a Set of keys.
function useVisibleKeys(rootRef, sig, count) {
  const [keys, setKeys] = useState(() => new Set());
  const seen = useRef(new Set());
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        if (e.isIntersecting) {
          const k = e.target.dataset.vidkey;
          if (k && !seen.current.has(k)) { seen.current.add(k); changed = true; }
          io.unobserve(e.target);
        }
      }
      if (changed) setKeys(new Set(seen.current));
    }, { rootMargin: "600px 0px" });
    root.querySelectorAll("[data-vidkey]").forEach((n) => {
      if (!seen.current.has(n.dataset.vidkey)) io.observe(n);
    });
    return () => io.disconnect();
  }, [rootRef, sig, count]);
  return keys;
}

const HomeGrouped = () => {
  const { t } = useTranslation();
  const { authenticated, user, showNsfw, hideWatched, hideAi, interests } = useAppStore();
  const navigate = useNavigate();
  const homeCardSize = useCardSize(); // large only on mobile, see hooks/useCardSize
  // Who is looking, for feature gates that are keyed on a name. A warm-up user
  // has a handle and no Hive username, so `user` alone is null for them.
  const incubationHandle = useAppStore((st) => st.incubationHandle);
  const gateViewer = user || incubationHandle;
  const queryClient = useQueryClient();
  const hasInterests = Array.isArray(interests) && interests.length > 0;
  const interestsKey = hasInterests ? interests.join(',') : '';

  // Null = the first tab. A saved tab that is not on offer (Interests before they
  // have loaded, or after logging out) falls back to the first one without being
  // forgotten, so it comes back once it is there again.
  const [activeKey, setActiveKey] = useState(loadActiveTab);
  const selectTab = (key) => {
    setActiveKey(key);
    saveActiveTab(key);
  };

  // Persisted custom tab order + live drag state (pointer-based so it works on
  // both mouse and touch). `dragKey` = the tab being dragged, `overKey` = the tab
  // currently under the pointer (its drop position).
  const [tabOrder, setTabOrder] = useState(loadTabOrder);
  // Sections turned off in Customize Home, and whether that dialog is open.
  const [hiddenTabs, setHiddenTabs] = useState(loadHiddenTabs);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [drag, setDrag] = useState(null); // { key, overKey } | null
  const dragRef = useRef(null);           // { key, startX, startY, mode, moved }
  const tabBarRef = useRef(null);

  // Each content feed is an INFINITE query — pages load as the user reaches the
  // end of the active tab's grid (see the sentinel in renderPanel).
  const INF = { staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000, initialPageParam: 1 };

  const homeQ = useInfiniteQuery({
    queryKey: authenticated ? ["follow-feed", user, showNsfw, hideWatched] : ["home-grouped", showNsfw, hideWatched, user],
    queryFn: authenticated ? ({ pageParam }) => fetchFollowFeed(user, pageParam) : ({ pageParam }) => fetchHome(pageParam),
    getNextPageParam: nextPage(),
    ...INF,
  });
  const homeData = useMemo(() => deduplicateVideos(homeQ.data?.pages.flat() || []), [homeQ.data]);

  const discoverQ = useInfiniteQuery({
    queryKey: ["discover-grouped", showNsfw, hideWatched, user],
    queryFn: ({ pageParam }) => fetchDiscover(pageParam),
    getNextPageParam: nextPage(),
    ...INF,
  });
  // Same creator spread out (see spreadCreators); leftovers only once the last page is in
  const discoverComplete = discoverQ.hasNextPage === false;
  const discoverData = useMemo(
    () => spreadCreators(deduplicateVideos(discoverQ.data?.pages.flat() || []), discoverComplete),
    [discoverQ.data, discoverComplete],
  );

  const interestsQ = useInfiniteQuery({
    queryKey: ["interests-grouped", showNsfw, hideWatched, user, interestsKey],
    queryFn: ({ pageParam }) => fetchInterestsFeed(pageParam),
    getNextPageParam: nextPage(),
    enabled: authenticated && hasInterests,
    ...INF,
  });
  const interestsData = useMemo(() => deduplicateVideos(interestsQ.data?.pages.flat() || []), [interestsQ.data]);


  // "New Content" is never the tab that renders first, but its feed used to be
  // requested immediately alongside the one that IS on screen — ~860ms / 43KB of
  // pure contention against the feed the user is actually waiting for. Hold it
  // until the browser goes idle, so it still prefetches (tab switches stay
  // instant) but only once the visible feed has had the network to itself.
  const [prefetchReady, setPrefetchReady] = useState(false);
  useEffect(() => {
    let id;
    const ready = () => setPrefetchReady(true);
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      id = window.requestIdleCallback(ready, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    id = setTimeout(ready, 1500);
    return () => clearTimeout(id);
  }, []);

  const newQ = useInfiniteQuery({
    queryKey: ["newcontent-grouped", showNsfw, user],
    queryFn: ({ pageParam }) => fetchNewContent(pageParam),
    getNextPageParam: nextPage(),
    enabled: prefetchReady,
    ...INF,
  });
  const newContentData = useMemo(() => deduplicateVideos(newQ.data?.pages.flat() || []), [newQ.data]);

  const homeLoading = homeQ.isLoading;
  const discoverLoading = discoverQ.isLoading;
  const interestsLoading = interestsQ.isLoading;
  // While the query is still deferred (see prefetchReady) React Query reports
  // isLoading:false, which would render this tab as EMPTY rather than loading for
  // anyone who switches to it within the first moment. Treat "deferred and no data
  // yet" as loading so they get the skeleton they'd have got before.
  const newContentLoading = newQ.isLoading || (!prefetchReady && !newQ.data);

  // Promoted videos — prefixed onto EVERY feed below (no dedicated tab any more).
  const { data: promotedData } = useQuery({
    queryKey: ["promoted-grouped", showNsfw, user, hideWatched],
    queryFn: fetchPromoted,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Recent videos from warm-up users (on 3Speak, not on Hive yet). They go in as
  // ordinary cards: by date in the newest-first feeds (placeByDate), spread
  // through the ranked ones (spreadIn: after about two rows, then every ~6
  // cards; owner 2026-11-12, "not at the top"). They have no votes or views to
  // rank on, and Card3 marks them with a leaf so they read as new people rather
  // than as something the ranking picked.
  //
  // Gated to the warm-up testers while the feature is still being worked on:
  // everything else here has been through ranking and moderation, so giving
  // unvetted content a slot next to it is a call to make deliberately rather than
  // to inherit. Flip VITE_ENABLE_WARMUP_RAIL when it should be everyone's.
  //
  // A warm-up user is identified by their HANDLE, not a Hive username, which is
  // why the gate uses gateViewer: `user` alone would hide these from exactly the
  // people they are about.
  const warmupVideos = useWarmupVideos({
    enabled: warmupRailEnabledFor(gateViewer),
    ownHandle: incubationHandle,
  });

  // The Follow feed only carries warm-up users the viewer follows.
  const followedWarmupVideos = useFollowedWarmupVideos(warmupVideos, authenticated ? gateViewer : null);

  // Promoted videos LEAD EVERY FEED — they no longer get a tab of their own. Each
  // section is prefixed with them and deduped, so a promoted video that also
  // shows up organically further down that feed isn't rendered twice. The
  // warm-up videos are mixed in by the caller (placeByDate / mixWarmup).
  const leadWithPromoted = useCallback(
    (videos) => {
      const lead = promotedData || [];
      return lead.length ? deduplicateVideos([...lead, ...(videos || [])]) : (videos || []);
    },
    [promotedData],
  );
  // Warm-up videos spread through a ranked feed (lib/spreadIn.js), at spots
  // that stay put while the page is open (the feed's session seed).
  const warmupSeed = getFeedSeed();
  const mixWarmup = (videos, complete) => spreadIn(videos, warmupVideos, { seed: warmupSeed, complete });

  // The featured video (see fetchFeatured / orderFeatured): the Spotlight hero
  // at the top of Home (20a), on every width.
  const isWide = useMedia(WIDE_QUERY);
  const featuredCacheKey = JSON.stringify([showNsfw, gateViewer || null, hideAi]);
  const featuredCached = useMemo(() => readFeaturedCache(featuredCacheKey), [featuredCacheKey]);
  const { data: featuredPool, isLoading: featuredLoading } = useQuery({
    queryKey: ["featured", showNsfw, gateViewer || null, hideAi],
    queryFn: async () => {
      const pool = await fetchFeatured(gateViewer, hideAi);
      writeFeaturedCache(featuredCacheKey, pool);
      return pool;
    },
    placeholderData: featuredCached,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  // The seed is read at render, so pull-to-refresh (which draws a new one) reshuffles.
  const feedSeed = getFeedSeed();
  // The hero slides through all of them (owner 2026-11-12), in this order.
  // Minus anything the viewer dismissed during this visit (issue #565): the pool
  // is cached, so a "Not interested" here would otherwise come back as a slide.
  const dismissalsVersion = useDismissals(user);
  const spotlight = useMemo(
    () => orderFeatured((featuredPool || []).filter((v) => !isDismissed(v)), feedSeed),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissalsVersion: the shared list changed
    [featuredPool, feedSeed, dismissalsVersion],
  );
  // The hero's videos are not repeated in the grid below it.
  const spotlightKeys = useMemo(() => new Set(spotlight.map((v) => featuredKeyOf(v).toLowerCase())), [spotlight]);
  const withFeatured = (vids) => (spotlightKeys.size
    ? vids.filter((v) => !spotlightKeys.has(featuredKeyOf(v).toLowerCase()))
    : vids);

  // Live OpenPods streams, prepended into the grids as regular cards. "all"
  // for public feeds; "following" for the follow feed / personalised tabs.
  const liveAll = useLiveStreams();
  const liveFollowing = useLiveStreams({ following: true });
  // "Live now" switched off in Customize Home (34b) keeps live tiles out.
  const liveOff = hiddenTabs.includes('live');
  const withLive = (live, vids) => (!liveOff && live.length ? [...live, ...vids] : vids);

  // ── Build the section list (natural order), then apply the user's saved order ──
  const baseSections = [
    { key: 'discover', title: 'Discover', label: t('feeds.home.sections.discover'), tab: t('feeds.home.sections.discover'), videos: withFeatured(withLive(liveAll, leadWithPromoted(mixWarmup(discoverData, discoverQ.hasNextPage === false)))), isLoading: discoverLoading, priority: true },
    { key: 'home', title: authenticated ? 'Follow Feed' : 'Home Feed', label: authenticated ? t('feeds.home.sections.follow') : t('feeds.home.sections.home'), tab: authenticated ? t('feeds.home.tabFollowing') : t('common.nav.trending'), videos: withLive(authenticated ? liveFollowing : liveAll, authenticated ? leadWithPromoted(placeByDate(homeData, followedWarmupVideos, homeQ.hasNextPage === false)) : leadWithPromoted(mixWarmup(homeData, homeQ.hasNextPage === false))), linkTo: authenticated ? '/follow-feed' : '/home-feed', isLoading: homeLoading, priority: true },
    { key: 'new', title: 'New Content', label: t('feeds.home.sections.new'), tab: t('common.nav.new'), videos: withLive(liveAll, leadWithPromoted(placeByDate(newContentData, warmupVideos, newQ.hasNextPage === false))), linkTo: '/new', isLoading: newContentLoading },
  ];
  // Interests row (logged-in + has interests): between the follow feed and New.
  if (authenticated && hasInterests) {
    baseSections.splice(2, 0, { key: 'interests', title: 'Interests', label: t('feeds.home.sections.interests'), tab: t('feeds.home.sections.interests'), videos: withLive(liveFollowing, leadWithPromoted(mixWarmup(interestsData, interestsQ.hasNextPage === false))), isLoading: interestsLoading, priority: true });
  }
  // A saved tabOrder may still list the retired 'promoted' key — applyTabOrder skips
  // keys with no matching section, so old orders degrade cleanly.
  const naturalSections = baseSections;
  // Computed directly (NOT memoised on the key signature) — a section's `videos`
  // grow as pages load, and memoising on keys alone would freeze the feed at
  // page 1 (the sentinel then stays in view and loops). applyTabOrder is cheap.
  const tabSections = applyTabOrder(naturalSections, tabOrder);
  // What the tab bar offers: everything not turned off (never nothing at all).
  const shownSections = tabSections.filter((s) => !hiddenTabs.includes(s.key));
  const visibleSections = shownSections.length ? shownSections : tabSections;

  const activeSection = visibleSections.find((s) => s.key === activeKey) || visibleSections[0] || null;
  const activeVideos = activeSection?.videos || [];

  // ── Metadata (payout/votes/views/watch) is fetched only for cards near the
  // viewport, not every loaded page — otherwise infinite scroll would fetch
  // metadata for hundreds of off-screen cards. `visibleVideos` = the first few
  // (above the fold, seeded so they never flash empty) + everything the
  // IntersectionObserver has seen scroll near.
  const panelRef = useRef(null);
  const visibleKeys = useVisibleKeys(panelRef, activeSection?.key, activeVideos.length);
  const keyOf = (v) => `${v.author?.username || v.author || v.owner}/${v.permlink}`;
  const visibleVideos = useMemo(
    () => activeVideos.filter((v, i) => i < 8 || visibleKeys.has(keyOf(v))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeVideos, visibleKeys],
  );

  // Which shorts feed the active tab's rails draw from:
  //   discover / interests → the ranked shorts feed (same source for both)
  //   home (Follow Feed)   → only creators you follow  (?followedby=)
  //   new                  → newest-first, no retention (?chrono=1)
  // Logged-out has no follow list, so the Home Feed gets no rails.
  // null = no shorts rails in this section. That single value already gates the
  // query (`enabled`), the "wait for shorts before painting" check and the
  // interleave props — so the Settings toggle just feeds into it, and turning it off
  // skips the shorts request entirely rather than fetching and hiding.
  const inlineShorts = useAppStore((st) => st.inlineShorts);
  const shortsMode = useMemo(() => {
    if (inlineShorts === false) return null;
    const k = activeSection?.key;
    if (k === 'discover' || k === 'interests') return 'ranked';
    if (k === 'home' && authenticated && user) return 'follow';
    if (k === 'new') return 'chrono';
    return null;
  }, [inlineShorts, activeSection?.key, authenticated, user]);

  const shortsSectionKey = activeSection?.key || null;
  const shortsQ = useInfiniteQuery({
    // Keyed by SECTION, not just mode: discover and interests share the 'ranked'
    // source but must not share a cache entry, or they'd render the same shorts.
    queryKey: ["feed-shorts", shortsSectionKey, shortsMode, user || null, showNsfw],
    queryFn: ({ pageParam = 1 }) => fetchFeedShorts(shortsMode, shortsSectionKey, pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPage(),
    enabled: !!shortsMode,
    // The panel waits for this (see renderPanel), so don't let a failing shorts
    // request sit on retries and strand the whole feed on skeletons.
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  const rawFeedShorts = useMemo(() => (shortsQ.data?.pages || []).flat(), [shortsQ.data]);
  // "Hide AI-generated" drops flagged shorts from the POOL, before the rails slice
  // it, so each rail still fills its row. The supply check below then counts only
  // the shorts that will actually show and pages in more to replace them.
  const feedShorts = useAiFilteredShorts(rawFeedShorts);

  // Live column count of the card grid — drives "a shorts rail every 2 rows".
  const gridCols = useGridColumns(panelRef, `${activeSection?.key}:${activeVideos.length}`);
  // How many narrow creator tiles fit across the grid — the "follow these" rail uses
  // this to fill its row exactly on desktop (no horizontal scroll). Mobile ignores it
  // (that rail stays a scroller); it's only >0 once the grid is measured, which also
  // gates the interleave so an unmeasured/empty creators row can't open a gap.
  const creatorsPerRow = useTilesPerRow(panelRef, `cr:${activeSection?.key}:${activeVideos.length}`, { min: 198, minPhone: 162, gap: 10, gapPhone: 8, floor: 3 });
  // Shorts per rail = however many fit across right now.
  const shortsPerRow = useShortsPerRow(panelRef, `${activeSection?.key}:${activeVideos.length}`);

  // Keep the shorts supply ahead of the rails. As the Discover feed pages in, more
  // rails are needed; without this the rails would simply stop once the first batch
  // ran out. Fetch the next shorts page whenever we're short of what the current
  // card count will ask for.
  const railsNeeded = gridCols > 0 ? Math.floor(activeVideos.length / (gridCols * 2)) : 0;
  const shortsNeeded = railsNeeded * (shortsPerRow || 1);
  useEffect(() => {
    if (!shortsMode) return;
    if (feedShorts.length >= shortsNeeded) return;
    if (!shortsQ.hasNextPage || shortsQ.isFetchingNextPage) return;
    shortsQ.fetchNextPage();
  }, [shortsMode, shortsNeeded, feedShorts.length, shortsQ.hasNextPage, shortsQ.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Community posts interspersed in the feed (mirrors the shorts rails) ──────
  // Discover + New → any fresh community post; Interests + Follow → only from people
  // you follow. null = none for this section.
  const communityMode = useMemo(() => {
    // From 1280px up the activity panel beside the feed shows these instead.
    if (isWide) return null;
    const k = activeSection?.key;
    if (k === 'discover' || k === 'new') return 'all';
    if ((k === 'interests' || k === 'home') && authenticated && user) return 'following';
    return null;
  }, [activeSection?.key, authenticated, user, isWide]);

  // Discover is a browse surface, so it gets a TIGHTER freshness window than the
  // other sections: community posts from the last 3 days, playlist changes from
  // the last 24h. Other feeds keep the server default.
  const isDiscover = activeSection?.key === 'discover';
  const snapsMaxAgeHours = isDiscover ? 72 : undefined;
  const playlistsMaxAgeHours = isDiscover ? 24 : undefined;

  const communityQ = useInfiniteQuery({
    queryKey: ['feed-community', activeSection?.key, communityMode, user || null, snapsMaxAgeHours || 0],
    queryFn: async ({ pageParam = 1 }) => {
      const data = await fetchCommunityFeed({ scope: communityMode, currentuser: user, page: pageParam, maxAgeHours: snapsMaxAgeHours });
      return data?.snaps || [];
    },
    initialPageParam: 1,
    getNextPageParam: nextPage(),
    enabled: !!communityMode,
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  // Locally removed (hidden via the ⋮ menu) — the checker also records the hide, so
  // it won't come back on the next fetch; this drops it from the current view instantly.
  const [removedSnaps, setRemovedSnaps] = useState(() => new Set());
  const removeSnap = useCallback((snap) => {
    setRemovedSnaps((prev) => new Set(prev).add(`${snap.owner}/${snap.permlink}`));
  }, []);
  const feedCommunity = useMemo(() => {
    const visible = (communityQ.data?.pages || []).flat().filter(
      // Own snaps never show in your own feed (the checker also filters them
      // server-side — this covers pages cached before login/logout).
      (s) => s.owner !== user && !removedSnaps.has(`${s.owner}/${s.permlink}`),
    );
    if (!isDiscover) return visible;
    // Discover shows one snap per creator: the checker returns newest first, so
    // the first one seen for an owner is their most recent.
    const seen = new Set();
    return visible.filter((s) => !seen.has(s.owner) && seen.add(s.owner));
  }, [communityQ.data, removedSnaps, user, isDiscover]);

  // ── Recently-changed public playlists, MIXED INTO the community-snaps stream ──
  // Same scope model as the snaps feed (communityMode): Discover + New → any
  // public playlist changed in the last 7d; Interests + Follow → only from people
  // you follow. They ride the community interleave, so a row can show a couple of
  // snaps and a fresh playlist together instead of playlists getting their own row.
  const playlistsQ = useInfiniteQuery({
    queryKey: ['feed-playlists', activeSection?.key, communityMode, user || null, playlistsMaxAgeHours || 0],
    queryFn: async ({ pageParam = 1 }) => {
      const data = await fetchPlaylistsFeed({ scope: communityMode, currentuser: user, page: pageParam, maxAgeHours: playlistsMaxAgeHours });
      return data?.playlists || [];
    },
    initialPageParam: 1,
    getNextPageParam: nextPage(),
    enabled: !!communityMode,
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  const feedPlaylists = useMemo(
    // Your own playlists never show in your own feed (the checker also filters
    // them server-side — this covers pages cached before login/logout).
    () => (playlistsQ.data?.pages || []).flat().filter((p) => p.owner !== user && !HIDDEN_OWNERS.has(p.owner)),
    [playlistsQ.data, user],
  );

  // ── New audio, also MIXED INTO the community stream (Discover only) ──
  // One per creator, at most AUDIO_FEED_DAYS old, never your own.
  const audioQ = useInfiniteQuery({
    queryKey: ['feed-audio', showNsfw, user || null],
    queryFn: ({ pageParam = 1 }) => fetchFeedAudio(pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPage(),
    enabled: isDiscover,
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  const feedAudio = useMemo(() => {
    // Newest first, so the first one seen for an owner is their most recent.
    const seen = new Set();
    return (audioQ.data?.pages || []).flat().filter((a) => a.owner !== user
      && !HIDDEN_OWNERS.has(a.owner) && !seen.has(a.owner) && seen.add(a.owner));
  }, [audioQ.data, user]);

  // Blend the streams (snaps, playlists, audio) into ONE list so they genuinely
  // ALTERNATE rather than one tacking on at the end. At each step we emit from
  // whichever stream is furthest "behind" its share, which spreads them
  // proportionally at ANY ratio: 3 snaps + 4 playlists → p,s,p,s,p,s,p;
  // 20 snaps + 4 → a playlist roughly every 5th card. Ties go to the earlier
  // stream. One-sided lists pass through.
  const feedCommunityMixed = useMemo(() => {
    // Podcasters publish each episode into a playlist, so the new audio also
    // bumps that playlist into the feed. Show the episode, not the playlist too:
    // a creator with new audio here gets no playlist card.
    const audioOwners = new Set(feedAudio.map((a) => a.owner));
    const streams = [
      feedCommunity.map((s) => ({ kind: 'snap', data: s })),
      feedPlaylists.filter((p) => !audioOwners.has(p.owner)).map((p) => ({ kind: 'playlist', data: p })),
      feedAudio.map((a) => ({ kind: 'audio', data: a })),
    ].filter((l) => l.length);
    if (streams.length < 2) return streams[0] || [];
    const out = [];
    const at = streams.map(() => 0);
    for (;;) {
      let pick = -1;
      let best = Infinity;
      streams.forEach((l, k) => {
        if (at[k] >= l.length) return;
        // Fractional progress this list would reach by advancing (+1 avoids /0).
        const ahead = (at[k] + 1) / (l.length + 1);
        if (ahead < best) { best = ahead; pick = k; }
      });
      if (pick < 0) return out;
      out.push(streams[pick][at[pick]++]);
    }
  }, [feedCommunity, feedPlaylists, feedAudio]);

  // A mixed community row roughly every 3 rows (offset from the shorts' every-2).
  // Each slot packs up to a full grid-row of cards (snaps + playlists) that mirror
  // the video columns.
  const communityEvery = gridCols > 0 ? gridCols * 3 : 0;
  const communityPerRow = gridCols > 0 ? gridCols : 1;
  const communityNeeded = communityEvery ? Math.floor(activeVideos.length / communityEvery) : 0;
  // Keep BOTH source streams supplied so the mixed list can fill the needed rows.
  useEffect(() => {
    if (!communityMode) return;
    if (feedCommunityMixed.length >= communityNeeded * communityPerRow) return;
    if (communityQ.hasNextPage && !communityQ.isFetchingNextPage) communityQ.fetchNextPage();
    if (playlistsQ.hasNextPage && !playlistsQ.isFetchingNextPage) playlistsQ.fetchNextPage();
    if (isDiscover && audioQ.hasNextPage && !audioQ.isFetchingNextPage) audioQ.fetchNextPage();
  }, [communityMode, communityNeeded, communityPerRow, feedCommunityMixed.length, communityQ.hasNextPage, communityQ.isFetchingNextPage, playlistsQ.hasNextPage, playlistsQ.isFetchingNextPage, isDiscover, audioQ.hasNextPage, audioQ.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCommunityRow = useCallback((slot) => {
    const start = slot * communityPerRow;
    const group = feedCommunityMixed.slice(start, start + communityPerRow);
    if (!group.length) return null;
    // Wrap in .community-snaps so the SnapCards' (nested) styles apply; --row makes
    // it a full-width grid that mirrors the video columns. Playlist and audio cards
    // ride the same row (sized to match via .community-snaps--row .playlist-feed-card
    // / .audio-tile). The audio cover plays; its title opens the audio's page.
    return (
      <div className="community-snaps community-snaps--feed community-snaps--row">
        {group.map((el) => {
          if (el.kind === 'playlist') return <PlaylistFeedCard key={`pl-${el.data.id}`} playlist={el.data} />;
          if (el.kind === 'audio') {
            return (
              <AudioTile key={`au-${el.data._id}`} item={el.data} contextItems={feedAudio}
                onOpen={() => navigate(audioItemPath(el.data))} />
            );
          }
          return <SnapCard key={`${el.data.owner}/${el.data.permlink}`} snap={el.data} feedMode onRemove={removeSnap} />;
        })}
      </div>
    );
  }, [feedCommunityMixed, removeSnap, communityPerRow, feedAudio, navigate]);

  // "Follow these" rail, injected as a full-width grid row (like the community/snaps
  // rows). Shown ONCE — only slot 0 — so it's a single suggestion strip, not a
  // repeating band. The component fetches its own creators (per the active tab:
  // discover = seeded-random slice of the top 20, interests = the deterministic top)
  // and renders nothing if the viewer has no interests / no suggestions, in which
  // case the empty `.card-interleave` wrapper collapses to zero height.
  const renderCreatorsRow = useCallback((slot) => {
    if (slot !== 0) return null;
    return (
      <>
        <SuggestedCreators variant={activeSection?.key} perRow={creatorsPerRow} />
      </>
    );
  }, [activeSection?.key, creatorsPerRow]);

  const { getContentForVideo } = useContentBatch(visibleVideos);
  const { isWatched, version: watchedVersion } = useWatchHistory(visibleVideos);
  const { getViewCount } = useViewCounts(visibleVideos);

  const handleRefresh = useCallback(async () => {
    // Pull-to-refresh is an explicit "give me something new" gesture, so it DOES
    // reshuffle — same as hitting reload. Plain navigation never does. Shared with
    // the interests prompt's post-save refresh (single source of truth).
    await refreshHomeFeeds(queryClient, { authenticated, user });
  }, [queryClient, authenticated, user]);

  // ── Drag-to-reorder the tabs (pointer events → works for mouse + touch) ──
  // DESKTOP (mouse): only the grip handle drags — the tab body just selects, and
  // the grab cursor lives on the handle. TOUCH: no hover, so a drag anywhere on
  // the tab (after a few px) reorders. During the drag we PREVIEW the new order
  // live, hit-testing against the tabs' ORIGINAL midpoints (captured at drag
  // start) so the reordering DOM can't cause the pointer test to flicker.
  const rectsRef = useRef([]);
  const startDrag = (key) => {
    const bar = tabBarRef.current;
    rectsRef.current = bar
      ? [...bar.querySelectorAll('.home-tab')].map((b) => {
          const r = b.getBoundingClientRect();
          return { key: b.dataset.tabKey, mid: r.left + r.width / 2 };
        })
      : [];
    setDrag({ key, order: rectsRef.current.map((r) => r.key) });
  };

  const previewOrder = (draggedKey, clientX) => {
    const others = rectsRef.current.filter((r) => r.key !== draggedKey);
    let idx = others.length;
    for (let i = 0; i < others.length; i++) { if (clientX < others[i].mid) { idx = i; break; } }
    const order = others.map((r) => r.key);
    order.splice(idx, 0, draggedKey);
    return order;
  };

  const onTabPointerDown = (key) => (e) => {
    if (e.button != null && e.button !== 0) return;
    // No grip any more (20a draws plain text tabs): a drag of a few px on the
    // tab reorders, with a mouse or a finger; anything less is a select.
    const mode = 'threshold';
    dragRef.current = { key, startX: e.clientX, startY: e.clientY, mode, moved: false };
    if (mode === 'immediate') { startDrag(key); e.preventDefault(); }
  };
  const onTabPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.mode === 'select') return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8) return;
      d.moved = true;
      if (d.mode === 'threshold') startDrag(d.key);
    }
    const order = previewOrder(d.key, e.clientX);
    setDrag((s) => (s ? { ...s, order } : s));
  };
  const onTabPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (drag?.order && (d.moved || d.mode === 'immediate')) {
      // Sections turned off keep their place after the ones that were dragged.
      const order = [...drag.order, ...tabSections.map((s) => s.key).filter((k) => !drag.order.includes(k))];
      setTabOrder(order);
      saveTabOrder(order);
      // The active tab is held by key, so it stays selected wherever it moved to.
      setDrag(null);
      return;
    }
    setDrag(null);
    // No real drag → treat as a tab select.
    if (visibleSections.some((s) => s.key === d.key)) selectTab(d.key);
  };
  // Global listeners while a pointer is down on a tab.
  useEffect(() => {
    window.addEventListener('pointermove', onTabPointerMove);
    window.addEventListener('pointerup', onTabPointerUp);
    return () => {
      window.removeEventListener('pointermove', onTabPointerMove);
      window.removeEventListener('pointerup', onTabPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, tabSections, visibleSections, activeSection]);

  // Live-previewed tab order during a drag (falls back to the committed order).
  const displaySections = useMemo(() => {
    if (!drag?.order) return visibleSections;
    const byKey = new Map(visibleSections.map((s) => [s.key, s]));
    const out = drag.order.map((k) => byKey.get(k)).filter(Boolean);
    return out.length === visibleSections.length ? out : visibleSections;
  }, [visibleSections, drag]);

  const saveCustomLayout = (order, hidden) => {
    setTabOrder(order);
    saveTabOrder(order);
    setHiddenTabs(hidden);
    saveHiddenTabs(hidden);
    setCustomizeOpen(false);
  };

  // Infinite query backing each paginated section (promoted isn't paginated).
  const queryByKey = { home: homeQ, discover: discoverQ, interests: interestsQ, new: newQ };

  // Slot N gets shorts [N*SIZE, (N+1)*SIZE). Returns null once we run out, which
  // stops the interleaving rather than repeating the same shorts down the page.
  // The shorts feed is split into consecutive sections of `shortsPerRow`, and slot N
  // takes section N — so each rail is one exactly-full row and no short repeats down
  // the page.
  //
  // The LAST rail may be partial. Demanding an exactly-full row meant a pool smaller
  // than one row rendered NOTHING at all: the follow feed draws from just the people
  // you follow, so on a wide grid (`shortsPerRow` 9+) a pool of 8 failed the check at
  // slot 0 and the rails silently vanished — the wider your window, the fewer shorts
  // you saw. Keep the column count fixed so the cards stay the same size as a full
  // rail (the row just ends early) and only require enough to not look like a stray.
  const MIN_RAIL_SHORTS = 3;
  const renderShortsRail = useCallback((slot) => {
    if (!shortsPerRow) return null;
    const start = slot * shortsPerRow;
    const slice = feedShorts.slice(start, start + shortsPerRow);
    // Still filling: don't paint a partial rail we're about to have more shorts for.
    if (slice.length < shortsPerRow && (shortsQ.hasNextPage || shortsQ.isFetchingNextPage)) return null;
    if (slice.length < Math.min(shortsPerRow, MIN_RAIL_SHORTS)) return null;
    // No heading inside the grid (owner 2026-11-12); the watch page keeps its own.
    return <ShortsRow shorts={slice} columns={shortsPerRow} heading={false} />;
  }, [feedShorts, shortsPerRow, shortsQ.hasNextPage, shortsQ.isFetchingNextPage]);

  const renderPanel = (s) => {
    if (!s) return null;
    // Wait for the shorts too, not just the videos. Otherwise the grid paints first
    // and the rails drop in a beat later, shoving everything down. The shorts feed
    // is actually the FASTER of the two (~0.23s vs 0.3-0.8s), so this costs nothing
    // in practice — and `retry: 1` means a failing one can't hold the feed hostage.
    const waitingForShorts = !!shortsMode
      && s.key === activeSection?.key
      && shortsQ.isLoading;
    if (waitingForShorts || (s.isLoading && (!s.videos || s.videos.length === 0))) {
      // Skeleton cards in the real card grid (same columns as what follows)
      return (
        <div className="card-container">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      );
    }
    if (!s.videos || s.videos.length === 0) {
      return <EmptyState className="home-tab-empty" icon="video_library" title={t('feeds.home.empty')} />;
    }
    const q = queryByKey[s.key];
    // Only interest-having users get the "follow these" rail (it's interest-matched).
    // Gating here — not just inside the component — keeps an empty rail from ever
    // reserving an interleave slot (which would open a grid-gap where nothing renders).
    const creatorsMode = hasInterests && (s.key === 'discover' || s.key === 'interests');
    return (
      <>
        <Card3 windowed
          videos={s.videos}
          loading={false}
          getContentForVideo={getContentForVideo}
          isWatched={isWatched}
          hideWatched={hideWatched}
          watchedVersion={watchedVersion}
          getViewCount={getViewCount}
          priority={s.priority}
          /* A shorts rail after every 2 REAL rows of videos, on any feed that has a
             shorts source (see shortsMode). `gridCols` is measured from the live
             grid, so this lands on a row boundary at every breakpoint (2 cols on
             mobile, 4-5 on desktop). 0 until measured → no interleave, no jump. */
          interleaveEvery={shortsMode && s.key === activeSection?.key && gridCols > 0 ? gridCols * 2 : 0}
          renderInterleave={shortsMode && s.key === activeSection?.key ? renderShortsRail : null}
          /* Community posts + fresh playlists share this stream, ~every 3 rows
             (see communityMode / feedCommunityMixed). */
          communityEvery={communityMode && s.key === activeSection?.key && gridCols > 0 ? communityEvery : 0}
          renderCommunity={communityMode && s.key === activeSection?.key ? renderCommunityRow : null}
          /* "Follow these" creator rail, interleaved as a full-width row after the
             first row of videos (once), on the discover/interests tabs. Placed at
             gridCols*1 so it never lands on the same card as the shorts rail (×2). */
          creatorsEvery={creatorsMode && s.key === activeSection?.key && gridCols > 0 && creatorsPerRow > 0 ? gridCols : 0}
          renderCreators={creatorsMode && s.key === activeSection?.key ? renderCreatorsRow : null}
        />
        {q && (
          <InfiniteSentinel
            hasMore={!!q.hasNextPage}
            loading={q.isFetchingNextPage}
            onLoadMore={q.fetchNextPage}
          />
        )}
        {(!q || !q.hasNextPage) && s.linkTo && (
          <div className="home-tab-viewall">
            <Button as={Link} to={s.linkTo} variant="secondary" size={40} next className="view-all">{t('feeds.home.viewAll')}</Button>
          </div>
        )}
      </>
    );
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="home-grouped-container home-tabbed" data-card-size={homeCardSize || 'small'}>
      {/* Logged-out first visits only. */}
      <WelcomeBanner />
      {/* The Spotlight (20a): the featured videos, full width under the bar. */}
      <HomeHero videos={spotlight} pending={featuredLoading && !spotlight.length} />
      <ShortsStories tiles />
      {/* Logged-in only, and renders nothing when there's nothing unwatched. */}
      <NewFromFollowing />
      {/* A creator blocked from uploading: the banner sits here on Home, under
          the Spotlight and over the feed tabs (the app-level copy hides it). */}
      <UploadBlockNotice inline />

      {/* The feed and, from 1280px up, the activity panel beside it (20a:
          minmax(0,1fr) 340px, gap 32). */}
      <div className="home-layout">
        <div className="home-main">
          <div className="home-tabs-row">
            <div className={`home-tabs home-tabs--bar${drag ? ' is-dragging' : ''}`} role="tablist" ref={tabBarRef}>
              {displaySections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  data-tab-key={s.key}
                  aria-selected={s.key === activeSection?.key}
                  className={`home-tab${s.key === activeSection?.key ? ' active' : ''}${drag?.key === s.key ? ' dragging' : ''}`}
                  title={`${s.label} · ${t('feeds.home.dragToReorder')}`}
                  onPointerDown={onTabPointerDown(s.key)}
                >
                  <span className="home-tab-label">{s.tab || s.label}</span>
                </button>
              ))}
            </div>
            <div className="home-tabs-tools">
              {/* Channel Surfing lives here rather than in the top menu. A link, not a
                  tab: it leaves the page, and the reorder drag only hit-tests
                  `.home-tab`, so it can never be dragged in among the feeds. */}
              <Link to="/surf" className="home-tab-tool home-tab-surf" title={t('feeds.home.surfTitle')}>
                <Icon name="live_tv" size={18} /> <span>{t('feeds.home.zapping')}</span>
              </Link>
              <button type="button" className="home-tab-tool home-tab-customize" onClick={() => setCustomizeOpen(true)} title={t('feeds.home.customizeTitle')}>
                <Icon name="tune" size={18} /> <span>{t('feeds.home.customize')}</span>
              </button>
            </div>
          </div>

          {customizeOpen && (
            <CustomizeHomeDialog
              sections={tabSections}
              hidden={hiddenTabs}
              onClose={() => setCustomizeOpen(false)}
              onSave={saveCustomLayout}
            />
          )}

          <div className="home-tab-panel" role="tabpanel" ref={panelRef}>
            {renderPanel(activeSection)}
          </div>
        </div>
        {isWide && (
          <aside className="home-aside">
            <HomeActivity />
          </aside>
        )}
      </div>
    </div>
    </PullToRefresh>
  );
};


export default HomeGrouped;