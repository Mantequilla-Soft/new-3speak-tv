import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Link } from "react-router-dom";
import "./HomeGrouped.scss";
import CardSkeleton from "../components/Cards/CardSkeleton";
import Card3 from "../components/Cards/Card3";
import { FEED_URL, TRENDING_SORTED_URL, FOLLOW_FEED_URL, DISCOVER_FEED_URL, INTERESTS_FEED_URL, NEW_CONTENT_URL, CHECKER_URL, appendNsfw } from "../utils/config";
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import { useAppStore } from "../lib/store";
import { getFeedSeed, refreshHomeFeeds } from "../utils/feedSeed";
import ShortsStories from "../components/ShortsStories/ShortsStories";
import NewFromFollowing from "../components/NewFromFollowing/NewFromFollowing";
import SuggestedCreators from "../components/SuggestedCreators/SuggestedCreators";
import { useLiveStreams } from "../hooks/useLiveStreams";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import ShortsRow from "../components/ShortsRow/ShortsRow";
import { useGridColumns, useShortsPerRow, useTilesPerRow } from "../hooks/useGridMetrics";
import { fetchCommunityFeed } from "../lib/snaps";
import { SnapCard } from "../components/Userprofilepage/CommunitySnaps";
import { fetchPlaylistsFeed } from "../lib/playlistsFeed";
import PlaylistFeedCard from "../components/Cards/PlaylistFeedCard";
import { SHORTS_API_URL } from "../utils/config";
import { Rocket, Compass, Users, Tags, Clock, GripVertical } from "lucide-react";

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
  if (st.simpleFeed) p += '&chrono=1'; // algo off → newest-first
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
  if (mode === 'chrono' || st.simpleFeed) p += '&chrono=1';
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

const fetchPromoted = async () => {
  const res = await axios.get(appendNsfw(`${CHECKER_URL}/feeds/promoted?limit=20`, useAppStore.getState().showNsfw));
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

// getNextPageParam: keep paging as long as the last page returned ANYTHING. This
// is more robust than requiring an exactly-full page (server-side filtering can
// trim a page below `limit` even when more pages exist); the feed stops on the
// first empty page. One extra (empty) request at the very end is fine.
const nextPage = () => (lastPage, allPages) =>
  (lastPage?.length || 0) > 0 ? allPages.length + 1 : undefined;

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

// Section icons shown in the tab bar.
const iconsByTitle = {
  "Home Feed": <Users size={16} />,
  "Follow Feed": <Users size={16} />,
  "New Content": <Clock size={16} />,
  "Promoted": <Rocket size={16} />,
  "Discover": <Compass size={16} />,
  "Interests": <Tags size={16} />,
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
// Reorder sections by the saved order; new/unknown keys keep their natural spot.
const applyTabOrder = (sections, order) => {
  if (!order || !order.length) return sections;
  const bySection = new Map(sections.map((s) => [s.key, s]));
  const out = [];
  for (const key of order) if (bySection.has(key)) { out.push(bySection.get(key)); bySection.delete(key); }
  for (const s of sections) if (bySection.has(s.key)) out.push(s);
  return out;
};

// Bottom-of-list sentinel — fires onLoadMore when it scrolls into view (600px
// early) so the next page is fetched before the user hits the actual end.
function InfiniteSentinel({ hasMore, loading, onLoadMore }) {
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
  return <div ref={ref} className="home-tab-sentinel">{loading && <span className="home-tab-loading">Loading more…</span>}</div>;
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
  const { authenticated, user, showNsfw, homeCardSize, hideWatched, interests, simpleFeed } = useAppStore();
  const queryClient = useQueryClient();
  const hasInterests = Array.isArray(interests) && interests.length > 0;
  const interestsKey = hasInterests ? interests.join(',') : '';

  // On mobile/tablet the stacked section rows become tabs (one section at a time).
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [activeTab, setActiveTab] = useState(0);

  // Persisted custom tab order + live drag state (pointer-based so it works on
  // both mouse and touch). `dragKey` = the tab being dragged, `overKey` = the tab
  // currently under the pointer (its drop position).
  const [tabOrder, setTabOrder] = useState(loadTabOrder);
  const [drag, setDrag] = useState(null); // { key, overKey } | null
  const dragRef = useRef(null);           // { key, startX, startY, mode, moved }
  const tabBarRef = useRef(null);

  // Each content feed is an INFINITE query — pages load as the user reaches the
  // end of the active tab's grid (see the sentinel in renderPanel).
  const INF = { staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000, initialPageParam: 1 };

  const homeQ = useInfiniteQuery({
    queryKey: authenticated ? ["follow-feed", user, showNsfw, hideWatched, simpleFeed] : ["home-grouped", showNsfw, hideWatched, user, simpleFeed],
    queryFn: authenticated ? ({ pageParam }) => fetchFollowFeed(user, pageParam) : ({ pageParam }) => fetchHome(pageParam),
    getNextPageParam: nextPage(),
    ...INF,
  });
  const homeData = useMemo(() => deduplicateVideos(homeQ.data?.pages.flat() || []), [homeQ.data]);

  const discoverQ = useInfiniteQuery({
    queryKey: ["discover-grouped", showNsfw, hideWatched, user, simpleFeed],
    queryFn: ({ pageParam }) => fetchDiscover(pageParam),
    getNextPageParam: nextPage(),
    ...INF,
  });
  const discoverData = useMemo(() => deduplicateVideos(discoverQ.data?.pages.flat() || []), [discoverQ.data]);

  const interestsQ = useInfiniteQuery({
    queryKey: ["interests-grouped", showNsfw, hideWatched, user, interestsKey, simpleFeed],
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
    queryKey: ["promoted-grouped", showNsfw],
    queryFn: fetchPromoted,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Promoted videos LEAD EVERY FEED — they no longer get a tab of their own. Each
  // section is prefixed with them and deduped, so a promoted video that also shows
  // up organically further down that feed isn't rendered twice.
  const leadWithPromoted = useCallback(
    (videos) => (promotedData?.length
      ? deduplicateVideos([...promotedData, ...(videos || [])])
      : (videos || [])),
    [promotedData],
  );

  // Live OpenPods streams, prepended into the grids as regular cards. "all"
  // for public feeds; "following" for the follow feed / personalised tabs.
  const liveAll = useLiveStreams();
  const liveFollowing = useLiveStreams({ following: true });
  const withLive = (live, vids) => (live.length ? [...live, ...vids] : vids);

  // ── Build the section list (natural order), then apply the user's saved order ──
  const baseSections = [
    { key: 'discover', title: 'Discover', videos: withLive(liveAll, leadWithPromoted(discoverData)), isLoading: discoverLoading, priority: true },
    { key: 'home', title: authenticated ? 'Follow Feed' : 'Home Feed', videos: withLive(authenticated ? liveFollowing : liveAll, leadWithPromoted(homeData)), linkTo: authenticated ? '/follow-feed' : '/home-feed', isLoading: homeLoading, priority: true },
    { key: 'new', title: 'New Content', videos: withLive(liveAll, leadWithPromoted(deduplicateVideos(newContentData || []))), linkTo: '/new', isLoading: newContentLoading },
  ];
  // Interests row (logged-in + has interests): between the follow feed and New.
  if (authenticated && hasInterests) {
    baseSections.splice(2, 0, { key: 'interests', title: 'Interests', videos: withLive(liveFollowing, leadWithPromoted(interestsData)), isLoading: interestsLoading, priority: true });
  }
  if (authenticated) {
  }
  // A saved tabOrder may still list the retired 'promoted' key — applyTabOrder skips
  // keys with no matching section, so old orders degrade cleanly.
  const naturalSections = baseSections;
  // Computed directly (NOT memoised on the key signature) — a section's `videos`
  // grow as pages load, and memoising on keys alone would freeze the feed at
  // page 1 (the sentinel then stays in view and loops). applyTabOrder is cheap.
  const tabSections = applyTabOrder(naturalSections, tabOrder);

  const safeTab = Math.min(Math.max(activeTab, 0), Math.max(tabSections.length - 1, 0));
  const activeSection = tabSections[safeTab] || null;
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
  const feedShorts = useMemo(() => (shortsQ.data?.pages || []).flat(), [shortsQ.data]);

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
    const k = activeSection?.key;
    if (k === 'discover' || k === 'new') return 'all';
    if ((k === 'interests' || k === 'home') && authenticated && user) return 'following';
    return null;
  }, [activeSection?.key, authenticated, user]);

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
  const feedCommunity = useMemo(
    () => (communityQ.data?.pages || []).flat().filter(
      // Own snaps never show in your own feed (the checker also filters them
      // server-side — this covers pages cached before login/logout).
      (s) => s.owner !== user && !removedSnaps.has(`${s.owner}/${s.permlink}`),
    ),
    [communityQ.data, removedSnaps, user],
  );

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
    () => (playlistsQ.data?.pages || []).flat().filter((p) => p.owner !== user),
    [playlistsQ.data, user],
  );

  // Blend the two streams into ONE list so playlists and snaps genuinely
  // ALTERNATE rather than playlists tacking on at the end. At each step we emit
  // from whichever stream is furthest "behind" its share, which spreads them
  // proportionally at ANY ratio: 3 snaps + 4 playlists → p,s,p,s,p,s,p;
  // 20 snaps + 4 → a playlist roughly every 5th card. One-sided lists pass through.
  const feedCommunityMixed = useMemo(() => {
    const snaps = feedCommunity.map((s) => ({ kind: 'snap', data: s }));
    const pls = feedPlaylists.map((p) => ({ kind: 'playlist', data: p }));
    if (!snaps.length) return pls;
    if (!pls.length) return snaps;
    const out = [];
    let si = 0;
    let pi = 0;
    const S = snaps.length;
    const P = pls.length;
    while (si < S || pi < P) {
      // Fractional progress each list would reach by advancing (+1 avoids /0).
      const snapAhead = (si + 1) / (S + 1);
      const plAhead = (pi + 1) / (P + 1);
      if (pi >= P || (si < S && snapAhead <= plAhead)) out.push(snaps[si++]);
      else out.push(pls[pi++]);
    }
    return out;
  }, [feedCommunity, feedPlaylists]);

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
  }, [communityMode, communityNeeded, communityPerRow, feedCommunityMixed.length, communityQ.hasNextPage, communityQ.isFetchingNextPage, playlistsQ.hasNextPage, playlistsQ.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCommunityRow = useCallback((slot) => {
    const start = slot * communityPerRow;
    const group = feedCommunityMixed.slice(start, start + communityPerRow);
    if (!group.length) return null;
    // Wrap in .community-snaps so the SnapCards' (nested) styles apply; --row makes
    // it a full-width grid that mirrors the video columns. Playlist cards ride the
    // same row (sized to match via .community-snaps--row .playlist-feed-card).
    return (
      <div className="community-snaps community-snaps--feed community-snaps--row">
        {group.map((el) => (el.kind === 'playlist'
          ? <PlaylistFeedCard key={`pl-${el.data.id}`} playlist={el.data} />
          : <SnapCard key={`${el.data.owner}/${el.data.permlink}`} snap={el.data} feedMode onRemove={removeSnap} />
        ))}
      </div>
    );
  }, [feedCommunityMixed, removeSnap, communityPerRow]);

  // "Follow these" rail, injected as a full-width grid row (like the community/snaps
  // rows). Shown ONCE — only slot 0 — so it's a single suggestion strip, not a
  // repeating band. The component fetches its own creators (per the active tab:
  // discover = seeded-random slice of the top 20, interests = the deterministic top)
  // and renders nothing if the viewer has no interests / no suggestions, in which
  // case the empty `.card-interleave` wrapper collapses to zero height.
  const renderCreatorsRow = useCallback((slot) => {
    if (slot !== 0) return null;
    return <SuggestedCreators variant={activeSection?.key} perRow={creatorsPerRow} />;
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
    const onHandle = !!e.target.closest?.('.home-tab-handle');
    const isTouch = e.pointerType === 'touch';
    // handle → drag now; touch body → drag after a small move; mouse body → select only.
    const mode = onHandle ? 'immediate' : (isTouch ? 'threshold' : 'select');
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
      const order = drag.order;
      setTabOrder(order);
      saveTabOrder(order);
      const activeKey = activeSection?.key;
      const ni = activeKey ? order.indexOf(activeKey) : -1;
      setDrag(null);
      if (ni >= 0) setActiveTab(ni);
      return;
    }
    setDrag(null);
    // No real drag → treat as a tab select.
    const i = tabSections.findIndex((s) => s.key === d.key);
    if (i >= 0) setActiveTab(i);
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
  }, [drag, tabSections, activeSection]);

  // Live-previewed tab order during a drag (falls back to the committed order).
  const displaySections = useMemo(() => {
    if (!drag?.order) return tabSections;
    const byKey = new Map(tabSections.map((s) => [s.key, s]));
    const out = drag.order.map((k) => byKey.get(k)).filter(Boolean);
    return out.length === tabSections.length ? out : tabSections;
  }, [tabSections, drag]);

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
    return <ShortsRow shorts={slice} columns={shortsPerRow} />;
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
      return <div className="home-tab-skeletons">{Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)}</div>;
    }
    if (!s.videos || s.videos.length === 0) {
      return <div className="home-tab-empty">Nothing to show here yet.</div>;
    }
    const q = queryByKey[s.key];
    // Only interest-having users get the "follow these" rail (it's interest-matched).
    // Gating here — not just inside the component — keeps an empty rail from ever
    // reserving an interleave slot (which would open a grid-gap where nothing renders).
    const creatorsMode = hasInterests && (s.key === 'discover' || s.key === 'interests');
    return (
      <>
        <Card3
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
          <div className="home-tab-viewall"><Link to={s.linkTo} className="view-all">View all</Link></div>
        )}
      </>
    );
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="home-grouped-container home-tabbed" data-card-size={homeCardSize || 'small'}>
      <ShortsStories />
      {/* Logged-in only, and renders nothing when there's nothing unwatched. */}
      <NewFromFollowing />

      <div className={`home-tabs home-tabs--bar${drag ? ' is-dragging' : ''}`} role="tablist" ref={tabBarRef}>
        {displaySections.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            data-tab-key={s.key}
            aria-selected={s.key === activeSection?.key}
            className={`home-tab${s.key === activeSection?.key ? ' active' : ''}${drag?.key === s.key ? ' dragging' : ''}`}
            onPointerDown={onTabPointerDown(s.key)}
          >
            <span className="home-tab-handle" aria-hidden="true" title="Drag to reorder"><GripVertical size={14} /></span>
            <span className="home-tab-icon">{iconsByTitle[s.title]}</span>
            <span className="home-tab-label">{s.title}</span>
          </button>
        ))}
      </div>

      <div className="home-tab-panel" role="tabpanel" ref={panelRef}>
        {renderPanel(activeSection)}
      </div>
    </div>
    </PullToRefresh>
  );
};


export default HomeGrouped;