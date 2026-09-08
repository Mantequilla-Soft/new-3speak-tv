import React, { useEffect, useState } from "react";
import { getHiveClient } from '../../utils/hiveNode';
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { toastIn } from '../../utils/toast';
import { Clock, TrendingUp, Users, PenLine, FileText, Coins, CalendarDays, Check, Plus } from 'lucide-react';
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

// Every toast from this module is headed "Community"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Community');

// Hive client
const client = getHiveClient();

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

function CommunityPage() {
  const { communityName: id } = useParams();
  const [dataMain, setDataMain] = useState(null);

  // The tab title is the community's DISPLAY name, not the route param — that is
  // the raw Hive id (hive-181335), which tells a reader nothing. RouteTitle lists
  // this route as self-titled, so nothing competes for the tag. Until the bridge
  // call returns we say "Community" rather than showing the id we are avoiding.
  const communityTitle = dataMain?.title || 'Community';
  const [trend, setTrend] = useState(false); // false = new (default), true = trending
  const hideWatched = useAppStore(s => s.hideWatched);
  const feedUser = useAppStore(s => s.user);
  const authenticated = useAppStore(s => s.authenticated);

  // Subscription state — mirrors Hive's community "subscribe" custom_json.
  const [subscribed, setSubscribed] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [subCount, setSubCount] = useState(null); // optimistic subscriber count

  // Fetch community info. Passing the logged-in user as `observer` makes Hive
  // return `context.subscribed`, so we can show the correct button state.
  const fetchCommunityData = async (id) => {
    try {
      const communityData = await client.call("bridge", "get_community", {
        name: id,
        observer: feedUser || "",
      });
      setDataMain(communityData);
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

  // Subscribe / unsubscribe via the on-chain `community` custom_json (posting auth).
  const handleSubscribe = async () => {
    if (subLoading) return;
    if (!authenticated || !isLoggedIn()) {
      toast.error('Log in to subscribe');
      return;
    }
    const next = !subscribed;
    setSubLoading(true);
    try {
      const label = dataMain?.title || id;
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
  const fetchVideos = async ({ pageParam = 0 }) => {
    const LIMIT = 100; // checker caps page size at 100
    // checker's /feeds/community/:id/{trending,new} is 1-based; our infinite
    // query supplies 0-indexed pageParam.
    const page = (Number(pageParam) || 0) + 1;
    const variant = trend ? 'trending' : 'new';
    // Community "trending" tab re-ranks by interests + retention and can hide seen
    // videos; the "new" tab stays purely chronological (no params).
    const url = `${FEED_URL}/feeds/community/${id}/${variant}?page=${page}&limit=${LIMIT}${trend ? feedParams() : ''}`;

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
  queryKey: ["communityFeed", id, trend, hideWatched, feedUser],
  queryFn: fetchVideos,
  getNextPageParam: (lastPage, allPages) => {
    // 🧠 Stop fetching if we already got one batch (no real pagination)
    if (!lastPage || lastPage.length === 0) return undefined;

    // If the server returns less than 200 (LIMIT), assume it's the end
    if (lastPage.length < 200) return undefined;

    // Otherwise, stop after first page since API doesn’t support skip
    if (allPages.length >= 1) return undefined;

    return 1; // optional — but we stop anyway
  },
});


  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200 &&
        !isFetchingNextPage &&
        hasNextPage
      ) {
        fetchNextPage();
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const videos = data?.pages.flat() || [];

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
    { key: 'posts', icon: <FileText size={16} />, label: 'Posts', value: fmtNum(dataMain.num_pending) },
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
        actions={
          authenticated && isLoggedIn() ? (
            <button
              className={`btn community-sub-btn${subscribed ? ' community-sub-btn--on' : ''}`}
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

      {/* New / Trending — real tabs, matching the home feed tab bar. */}
      <div className="community-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!trend}
          className={`community-tab${!trend ? ' active' : ''}`}
          onClick={() => setTrend(false)}
        >
          <span className="community-tab-icon"><Clock size={16} /></span>
          <span className="community-tab-label">New</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={trend}
          className={`community-tab${trend ? ' active' : ''}`}
          onClick={() => setTrend(true)}
        >
          <span className="community-tab-icon"><TrendingUp size={16} /></span>
          <span className="community-tab-label">Trending</span>
        </button>
      </div>

      {/* Video grid + right sidebar (KPIs on both, description on desktop). */}
      <div className="community-body">
        <div className="community-feed">
          {isLoading ? (
            <CardSkeleton />
          ) : isError ? (
            <p>Error fetching videos</p>
          ) : (
            <Card3
              videos={videos}
              loading={isFetchingNextPage}
              getContentForVideo={getContentForVideo}
              isWatched={isWatched}
              getViewCount={getViewCount}
            />
          )}

          {isFetchingNextPage && <p style={{ textAlign: "center" }}>Loading more...</p>}
        </div>

        <aside className="community-side">
          {kpiBlock}

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
