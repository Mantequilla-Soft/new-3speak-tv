import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getHiveClient } from '../../utils/hiveNode';
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { toastIn } from '../../utils/toast';
import { Clock, TrendingUp, Trophy, MessagesSquare, Users, PenLine, FileText, Coins, CalendarDays, Check, Plus, Tv, Upload } from 'lucide-react';
import "./CommunityPage.scss";
import axios from "axios";
import { FEED_URL } from '../../utils/config'
import { feedParams } from '../../utils/feedParams'
import { useInfiniteQuery } from "@tanstack/react-query";
import Card3 from "../Cards/Card3";
import CardSkeleton from "../Cards/CardSkeleton";
import ProfileHeader from "../ProfileHeader/ProfileHeader";
import HiveMarkdown from "../HiveMarkdown/HiveMarkdown";
import { useContentBatch } from "../../hooks/useContentBatch";
import { useWatchHistory } from "../../hooks/useWatchHistory";
import useViewCounts from "../../hooks/useViewCounts";
import { useAppStore } from "../../lib/store";
import { customJsonWithAioha, isLoggedIn, KeyTypes } from "../../hive-api/aioha";
import CommunitySnaps from "../Userprofilepage/CommunitySnaps";
import { CommunityPinned, CommunityTopCreators, CommunityTeam, CommunityRules } from "./CommunityExtras";
import { findNextOnChannel, rememberCommunityChannel, surfUrl } from "../../utils/surf";

// Every toast from this module is headed "Community"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Community');

// Hive client
const client = getHiveClient();

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

// Checker caps a community feed page at 100.
const PAGE_LIMIT = 100;

const TABS = [
  { key: 'new', label: 'New', icon: <Clock size={16} /> },
  { key: 'trending', label: 'Trending', icon: <TrendingUp size={16} /> },
  { key: 'top', label: 'Top', icon: <Trophy size={16} /> },
  { key: 'discussion', label: 'Discussion', icon: <MessagesSquare size={16} /> },
];
const TOP_WINDOWS = [
  { key: '7d', label: 'This week' },
  { key: '30d', label: 'This month' },
  { key: '365d', label: 'This year' },
  { key: 'all', label: 'All time' },
];

// "New since your last visit". The baseline is when the viewer was last here; a
// return within VISIT_GAP (a reload, the back button, React's dev double-mount)
// is the SAME visit and keeps its baseline, so the badges do not vanish the moment
// the page re-renders. Per-browser convenience only, so localStorage is enough.
const VISIT_GAP_MS = 30 * 60 * 1000;
function useLastVisit(id) {
  const [since, setSince] = useState(null);
  useEffect(() => {
    if (!id) return;
    const key = `3speak_community_visit:${id}`;
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* unreadable: first visit */ }
    const now = Date.now();
    const base = rec && now - rec.seenAt < VISIT_GAP_MS ? rec.since : (rec?.seenAt ?? null);
    setSince(base);
    try { localStorage.setItem(key, JSON.stringify({ since: base, seenAt: now })); } catch { /* ignore */ }
  }, [id]);
  return since;
}
const createdMs = (v) => new Date(v?.created || v?.created_at || 0).getTime();

function CommunityPage() {
  const { communityName: id } = useParams();
  const [dataMain, setDataMain] = useState(null);

  // The tab title is the community's DISPLAY name, not the route param — that is
  // the raw Hive id (hive-181335), which tells a reader nothing. RouteTitle lists
  // this route as self-titled, so nothing competes for the tag. Until the bridge
  // call returns we say "Community" rather than showing the id we are avoiding.
  const communityTitle = dataMain?.title || 'Community';
  // ?tab= so a Discussion or Top link can be shared; New is the default.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'new';
  const topWindow = TOP_WINDOWS.some((w) => w.key === searchParams.get('window')) ? searchParams.get('window') : '30d';
  const setTab = (key, extra = {}) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'new') next.delete('tab'); else next.set('tab', key);
    if (key !== 'top') next.delete('window');
    Object.entries(extra).forEach(([k, v]) => next.set(k, v));
    setSearchParams(next, { replace: true });
  };
  const navigate = useNavigate();
  const lastVisit = useLastVisit(id);
  const [surfing, setSurfing] = useState(false);
  const hideWatched = useAppStore(s => s.hideWatched);
  const feedUser = useAppStore(s => s.user);
  const authenticated = useAppStore(s => s.authenticated);

  // Subscription state — mirrors Hive's community "subscribe" custom_json.
  const [subscribed, setSubscribed] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [subCount, setSubCount] = useState(null); // optimistic subscriber count
  const incubationHandle = useAppStore(s => s.incubationHandle);

  // Fetch community info. Passing the logged-in user as `observer` makes Hive
  // return `context.subscribed`, so we can show the correct button state.
  const fetchCommunityData = async (id) => {
    try {
      const communityData = await client.call("bridge", "get_community", {
        name: id,
        observer: feedUser || "",
      });
      setDataMain(communityData);
      rememberCommunityChannel(id, communityData?.title);
      setSubscribed(!!communityData?.context?.subscribed);
      setSubCount(
        typeof communityData?.subscribers === 'number' ? communityData.subscribers : null
      );
    } catch (error) {
      console.error("Error fetching community data:", error);
    }
  };

  useEffect(() => {
    if (id) fetchCommunityData(id);
  }, [id, feedUser]);

  // Hive answers `context.subscribed` for an observer it knows. An incubating
  // user is not one, so their subscriptions are read from where they are kept.
  useEffect(() => {
    if (!incubationHandle || !id) return undefined;
    let alive = true;
    import('../../lib/incubation')
      .then(m => m.fetchMyIncubationSubscriptions())
      .then(d => { if (alive) setSubscribed((d.items || []).some(i => i.community === id)); })
      .catch(() => { /* leave the button in its default state */ });
    return () => { alive = false; };
  }, [incubationHandle, id]);

  // Subscribe / unsubscribe via the on-chain `community` custom_json (posting auth).
  const handleSubscribe = async () => {
    if (subLoading) return;
    // isLoggedIn() is the wallet check, and an incubating user has no wallet.
    // Testing it alone told the one group who cannot subscribe on chain to log
    // in, while they were already logged in.
    if (!authenticated || (!incubationHandle && !isLoggedIn())) {
      toast.error('Log in to subscribe');
      return;
    }
    const next = !subscribed;
    setSubLoading(true);
    try {
      const label = dataMain?.title || id;
      if (incubationHandle) {
        const { subscribeIncubation } = await import('../../lib/incubation');
        await subscribeIncubation(id, next);
        setSubscribed(next);
        // The subscriber count is Hive's, and this subscription is not on Hive
        // yet, so it is left alone rather than shown a number that no other
        // client would agree with.
        toast.success(next ? `Subscribed to ${label}` : `Unsubscribed from ${label}`);
        setSubLoading(false);
        return;
      }
      const json = JSON.stringify([next ? 'subscribe' : 'unsubscribe', { community: id }]);
      await customJsonWithAioha(
        KeyTypes.Posting,
        'community',
        json,
        next ? `Subscribe to ${label}` : `Unsubscribe from ${label}`
      );
      setSubscribed(next);
      setSubCount((c) => (typeof c === 'number' ? Math.max(0, c + (next ? 1 : -1)) : c));
      toast.success(next ? `Subscribed to ${label}` : `Unsubscribed from ${label}`);
    } catch (err) {
      console.error('Community subscribe error:', err);
      toast.error('Subscription failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSubLoading(false);
    }
  };

  // ---------------------------
  // FETCH COMMUNITY VIDEOS
  // ---------------------------
  const videoTab = tab !== 'discussion';
  const fetchVideos = async ({ pageParam = 0 }) => {
    // checker's /feeds/community/:id/{new,trending,top} is 1-based; our infinite
    // query supplies 0-indexed pageParam.
    const page = (Number(pageParam) || 0) + 1;
    // "trending" re-ranks by interests + retention and can hide seen videos; "new"
    // stays purely chronological and "top" purely by views (no params).
    const url = tab === 'top'
      ? `${FEED_URL}/feeds/community/${id}/top?window=${topWindow}&page=${page}&limit=${PAGE_LIMIT}`
      : `${FEED_URL}/feeds/community/${id}/${tab}?page=${page}&limit=${PAGE_LIMIT}${tab === 'trending' ? feedParams() : ''}`;

    const res = await axios.get(url);
    // Checker returns {videos: [...]}; legacy /apiv2 returned {trends: [...]}
    // or a bare array. Support all three so a flip back never breaks the page.
    return res.data.videos || res.data.trends || res.data;
  };

  const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isError,
} = useInfiniteQuery({
  queryKey: ["communityFeed", id, tab, topWindow, hideWatched, feedUser],
  queryFn: fetchVideos,
  enabled: videoTab,
  // The checker pages these feeds (page=N), so a full page means there may be
  // more. This used to compare against 200 while asking for 100, and stopped
  // after one page regardless, so no community ever showed past its newest 100.
  getNextPageParam: (lastPage, allPages) =>
    (Array.isArray(lastPage) && lastPage.length >= PAGE_LIMIT ? allPages.length : undefined),
});


  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200 &&
        !isFetchingNextPage &&
        hasNextPage &&
        videoTab
      ) {
        fetchNextPage();
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage, videoTab]);

  // A page repeats nothing another already showed; the feeds page by skip, so a
  // video that moved between two fetches would otherwise render twice.
  const videos = useMemo(() => {
    const seen = new Set();
    return (data?.pages.flat() || []).filter((v) => {
      const k = `${v?.author?.username || v?.author || v?.owner}/${v?.permlink}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [data]);

  const isNew = useCallback((v) => !!lastVisit && createdMs(v) > lastVisit, [lastVisit]);
  const newCount = useMemo(
    () => (tab === 'new' && lastVisit ? videos.filter(isNew).length : 0),
    [tab, lastVisit, videos, isNew],
  );

  // "Surf this community": Channel Surfing with the community as the channel.
  const startSurf = async () => {
    if (surfing) return;
    setSurfing(true);
    try {
      const v = await findNextOnChannel(id);
      if (v) navigate(surfUrl(v, id));
      else toast('Nothing to surf here yet');
    } catch {
      toast.error('Could not start surfing');
    } finally {
      setSurfing(false);
    }
  };
  const canUpload = authenticated && (isLoggedIn() || !!incubationHandle);
  const uploadHref = `/embed-studio?community=${encodeURIComponent(id)}&communityTitle=${encodeURIComponent(dataMain?.title || id)}`;

  // Batch fetch content data
  const { getContentForVideo } = useContentBatch(videos);

  // Batch check watch history
  const { isWatched } = useWatchHistory(videos);

  // Batch fetch view counts
  const { getViewCount } = useViewCounts(videos);

  // KPIs Hive exposes for a community (bridge.get_community).
  const createdLabel = (() => {
    if (!dataMain?.created_at) return '—';
    const d = new Date(String(dataMain.created_at).replace(' ', 'T') + 'Z');
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  })();

  const kpis = dataMain ? [
    { key: 'subs', icon: <Users size={16} />, label: 'Subscribers', value: fmtNum(subCount ?? dataMain.subscribers) },
    { key: 'authors', icon: <PenLine size={16} />, label: 'Active posters', value: fmtNum(dataMain.num_authors) },
    // num_pending counts posts still inside Hive's 7-day payout window, not the
    // community's whole history.
    { key: 'posts', icon: <FileText size={16} />, label: 'Posts this week', value: fmtNum(dataMain.num_pending) },
    { key: 'rewards', icon: <Coins size={16} />, label: 'Pending rewards', value: typeof dataMain.sum_pending === 'number' ? `$${dataMain.sum_pending}` : '—' },
    { key: 'since', icon: <CalendarDays size={16} />, label: 'Created', value: createdLabel },
  ] : [];

  // Rendered in two spots: the desktop sidebar, and — on mobile — beside the
  // description box above the tabs. Same markup, so it stays row-styled in both.
  const kpiBlock = kpis.length ? (
    <div className="community-kpis">
      {kpis.map((k) => (
        <div className="community-kpi" key={k.key}>
          <span className="community-kpi-icon">{k.icon}</span>
          <span className="community-kpi-text">
            <span className="community-kpi-value">{k.value}</span>
            <span className="community-kpi-label">{k.label}</span>
          </span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="community-page-wrap">
      <Helmet>
        <title>{`3S | ${communityTitle}`}</title>
      </Helmet>
      <ProfileHeader
        username={id}
        name={dataMain?.title || id}
        bio={dataMain?.about}
        // nameActions, not actions: subscribing is the thing a visitor came to
        // this page to decide, and in the actions group it sat below the fold of
        // the header as one control among several. Beside the name is where a
        // profile puts Follow, and this is the same decision about a community.
        //
        // The profile's own hero classes, so the two read as one control in two
        // places rather than two that happen to look similar.
        nameActions={
          authenticated && (isLoggedIn() || incubationHandle) ? (
            <button
              className={`btn ${subscribed ? 'btn-hero-following' : 'btn-hero-follow'} community-sub-btn`}
              onClick={handleSubscribe}
              disabled={subLoading}
            >
              {subLoading
                ? 'Loading…'
                : subscribed
                  ? <><Check size={16} /> Subscribed</>
                  : <><Plus size={16} /> Subscribe</>}
            </button>
          ) : null
        }
      />

      {/* Mobile-only: description keeps its spot above the tabs, with the stats
          row sitting to its right (hidden on desktop — sidebar carries them). */}
      {(dataMain?.description || kpiBlock) ? (
        <div className="community-intro">
          {dataMain?.description ? (
            <div className="community-intro-desc">
              <HiveMarkdown
                body={dataMain.description}
                className="community-description community-description--mobile"
                collapsible
              />
            </div>
          ) : null}
          {kpiBlock ? <div className="community-intro-stats">{kpiBlock}</div> : null}
        </div>
      ) : null}

      {/* Mobile-only: top creators, team + rules (the desktop sidebar carries them). */}
      {dataMain ? (
        <div className="community-about--mobile">
          <CommunityTopCreators id={id} />
          <CommunityTeam id={id} team={dataMain.team} />
          <CommunityRules text={dataMain.flag_text} collapsible />
        </div>
      ) : null}

      <div className="community-actions">
        <button type="button" className="community-action" onClick={startSurf} disabled={surfing} title="Channel Surfing through this community's videos">
          <Tv size={16} /> {surfing ? 'Tuning…' : 'Surf this community'}
        </button>
        {canUpload && (
          <Link className="community-action" to={uploadHref}>
            <Upload size={16} /> Upload here
          </Link>
        )}
      </div>

      <CommunityPinned id={id} />

      {/* Real tabs, matching the home feed tab bar. */}
      <div className="community-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`community-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span className="community-tab-icon">{t.icon}</span>
            <span className="community-tab-label">{t.label}</span>
            {t.key === 'new' && newCount > 0 && (
              <span className="community-tab-count" title="New since your last visit">{newCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'top' && (
        <div className="community-windows" role="group" aria-label="Time range">
          {TOP_WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              className={`community-window${topWindow === w.key ? ' active' : ''}`}
              aria-pressed={topWindow === w.key}
              onClick={() => setTab('top', { window: w.key })}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}

      {/* Video grid + right sidebar (KPIs, team, rules, description on desktop). */}
      <div className="community-body">
        <div className="community-feed">
          {tab === 'discussion' ? (
            <CommunitySnaps
              community={id}
              // Anyone with a Hive account can start a discussion; the composer
              // itself returns nothing without one, so a visitor sees the list.
              canPost={authenticated && isLoggedIn()}
            />
          ) : isLoading ? (
            <CardSkeleton />
          ) : isError ? (
            <p>Error fetching videos</p>
          ) : videos.length === 0 ? (
            <p className="community-empty">
              {tab === 'top' ? 'No videos in this time range yet.' : 'No videos here yet.'}
            </p>
          ) : (
            <Card3
              videos={videos}
              loading={isFetchingNextPage}
              getContentForVideo={getContentForVideo}
              isWatched={isWatched}
              getViewCount={getViewCount}
              isNew={isNew}
            />
          )}

          {videoTab && isFetchingNextPage && <p style={{ textAlign: "center" }}>Loading more...</p>}
        </div>

        <aside className="community-side">
          {kpiBlock}

          <CommunityTopCreators id={id} side />
          {dataMain ? <CommunityTeam id={id} team={dataMain.team} /> : null}
          {dataMain ? <CommunityRules text={dataMain.flag_text} /> : null}

          {/* Desktop-only: the description moved off the top, beside the grid. */}
          {dataMain?.description ? (
            <HiveMarkdown
              body={dataMain.description}
              className="community-description community-description--side"
              collapsible
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export default CommunityPage;
