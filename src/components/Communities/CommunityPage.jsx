import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getHiveClient } from '../../utils/hiveNode';
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { formatNumber, formatDate } from "../../i18n";
import { toastIn } from '../../utils/toast';
import "./CommunityPage.scss";
import axios from "axios";
import { FEED_URL } from '../../utils/config'
import { feedParams } from '../../utils/feedParams'
import { useInfiniteQuery } from "@tanstack/react-query";
import Card3 from "../Cards/Card3";
import CardSkeleton from "../Cards/CardSkeleton";
import HiveMarkdown from "../HiveMarkdown/HiveMarkdown";
import { useContentBatch } from "../../hooks/useContentBatch";
import { useWatchHistory } from "../../hooks/useWatchHistory";
import useViewCounts from "../../hooks/useViewCounts";
import { useAppStore } from "../../lib/store";
import { useRewardDisplay } from "../../utils/hivePrice";
import { isLoggedIn } from "../../hive-api/aioha";
import { useAvatarUrl } from "../../utils/avatarCache";
import { Button, EmptyState, Segmented, StatTile } from "../v2/ui";
import { Icon } from "../v2/Icon";
import GroupHero, { GroupHeroJoin } from "../Groups/GroupHero";
import { canSubscribe, setCommunitySubscription } from "./communitySubscribe";
import CommunitySnaps from "../Userprofilepage/CommunitySnaps";
import { CommunityPinned, CommunityTopCreators, CommunityTeam, CommunityRules, useCommunityTopCreators } from "./CommunityExtras";
import { findNextOnChannel, rememberCommunityChannel, surfUrl } from "../../utils/surf";
import { creatorKey, isUploadBlocked, useCreatorSettings } from "../../utils/creatorSettings";

// Every toast from this module is headed "Community"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Community');

// Hive client
const client = getHiveClient();

const fmtNum = (n) => (typeof n === 'number' ? formatNumber(n) : '—');

// Checker caps a community feed page at 100.
const PAGE_LIMIT = 100;

const TABS = [
  { key: 'new', labelKey: 'communities.page.tabs.new', icon: 'schedule' },
  { key: 'trending', labelKey: 'communities.page.tabs.trending', icon: 'trending_up' },
  { key: 'top', labelKey: 'communities.page.tabs.top', icon: 'trophy' },
  { key: 'discussion', labelKey: 'communities.page.tabs.discussion', icon: 'forum' },
];
const TOP_WINDOWS = [
  { key: '7d', labelKey: 'communities.page.windows.week' },
  { key: '30d', labelKey: 'communities.page.windows.month' },
  { key: '365d', labelKey: 'communities.page.windows.year' },
  { key: 'all', labelKey: 'communities.page.windows.all' },
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
  const { t } = useTranslation();
  // Guests and warm-up accounts see the pending rewards in HIVE.
  const { label: rewardLabel } = useRewardDisplay();
  const { communityName: id } = useParams();
  const [dataMain, setDataMain] = useState(null);

  // The tab title is the community's DISPLAY name, not the route param — that is
  // the raw Hive id (hive-181335), which tells a reader nothing. RouteTitle lists
  // this route as self-titled, so nothing competes for the tag. Until the bridge
  // call returns we say "Community" rather than showing the id we are avoiding.
  const communityTitle = dataMain?.title || t('communities.page.fallbackTitle');
  // ?tab= so a Discussion or Top link can be shared; New is the default.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((x) => x.key === searchParams.get('tab')) ? searchParams.get('tab') : 'new';
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

  // Subscribe / unsubscribe via the on-chain `community` custom_json (posting
  // auth), or off-chain for an incubating user (see communitySubscribe.js).
  const handleSubscribe = async () => {
    if (subLoading) return;
    if (!canSubscribe({ authenticated, incubationHandle })) {
      toast.error(t('communities.page.loginToSubscribe'));
      return;
    }
    const next = !subscribed;
    setSubLoading(true);
    try {
      const label = dataMain?.title || id;
      const { onChain } = await setCommunitySubscription({
        id,
        next,
        incubationHandle,
        prompt: next ? t('communities.page.subscribeTo', { label }) : t('communities.page.unsubscribeFrom', { label }),
      });
      setSubscribed(next);
      // The subscriber count is Hive's. An off-chain (incubation) subscription
      // is not on Hive yet, so the count is left alone rather than shown a
      // number that no other client would agree with.
      if (onChain) setSubCount((c) => (typeof c === 'number' ? Math.max(0, c + (next ? 1 : -1)) : c));
      toast.success(next ? t('communities.page.subscribedTo', { label }) : t('communities.page.unsubscribedFrom', { label }));
    } catch (err) {
      console.error('Community subscribe error:', err);
      toast.error(t('communities.page.subscriptionFailed', { error: err.message || t('communities.page.unknownError') }));
    } finally {
      setSubLoading(false);
    }
  };

  // Share tile: the system share sheet where there is one, else copy the link.
  const handleShare = async () => {
    const url = `${window.location.origin}/community/${id}`;
    try {
      if (navigator.share) { await navigator.share({ title: communityTitle, url }); return; }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('common.actions.copied'));
    } catch { /* nothing to copy into */ }
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
      else toast(t('communities.page.nothingToSurf'));
    } catch {
      toast.error(t('communities.page.surfFailed'));
    } finally {
      setSurfing(false);
    }
  };
  // A warm-up user blocked from uploads (`~<handle>` row, canUpload: false)
  // loses the link, like the nav's Share. Fails open while loading or on error.
  const warmupKey = !isLoggedIn() && incubationHandle ? creatorKey(null, incubationHandle) : null;
  const warmupUploadBlocked = isUploadBlocked(useCreatorSettings(warmupKey));
  const canUpload = authenticated && (isLoggedIn() || !!incubationHandle) && !warmupUploadBlocked;
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
    return isNaN(d) ? '—' : formatDate(d, { month: 'short', year: 'numeric' });
  })();

  const kpis = dataMain ? [
    { key: 'subs', label: t('communities.page.kpis.subscribers'), value: fmtNum(subCount ?? dataMain.subscribers) },
    { key: 'authors', label: t('communities.page.kpis.authors'), value: fmtNum(dataMain.num_authors) },
    // num_pending counts posts still inside Hive's 7-day payout window, not the
    // community's whole history.
    { key: 'posts', label: t('communities.page.kpis.posts'), value: fmtNum(dataMain.num_pending) },
    { key: 'rewards', label: t('communities.page.kpis.rewards'), value: typeof dataMain.sum_pending === 'number' ? rewardLabel(dataMain.sum_pending) : '—', money: true },
    { key: 'since', label: t('communities.page.kpis.created'), value: createdLabel },
  ] : [];

  // Design 40b: five KPI tiles in a row under the header. On a phone the row
  // scrolls sideways instead of wrapping, so it stays one line tall.
  const kpiBlock = kpis.length ? (
    <div className="community-kpis">
      {kpis.map((k) => (
        <StatTile key={k.key} className="community-kpi" label={k.label} value={k.value} money={k.money} />
      ))}
    </div>
  ) : null;

  const communityAvatar = useAvatarUrl(id, 'large');
  const { data: topCreators = [] } = useCommunityTopCreators(id);
  const subscribers = subCount ?? dataMain?.subscribers;
  // 20c: one line under the name, "<b>N subscribers</b> · N posts this week".
  // num_pending is the posts still inside Hive's 7-day payout window.
  const heroMeta = dataMain ? (
    <span className="community-hero-meta">
      {typeof subscribers === 'number' && (
        <b>{t('communities.directory.subscribers', { count: subscribers, n: formatNumber(subscribers) })}</b>
      )}
      {typeof dataMain.num_pending === 'number' && (
        <>{typeof subscribers === 'number' ? ' · ' : ''}{t('communities.page.postsWeek', { count: dataMain.num_pending, n: formatNumber(dataMain.num_pending) })}</>
      )}
    </span>
  ) : null;
  // The faces in front of it: this month's top creators, else the team.
  const heroStack = (topCreators.length ? topCreators.map((c) => c.name) : (dataMain?.team || []).map(([n]) => n).filter((n) => n && n !== id)).slice(0, 5);

  // The About card: the one-line "about" and the longer description the mods
  // wrote (markdown, folded when long).
  const aboutCard = (dataMain?.about || dataMain?.description) ? (
    <div className="community-card community-about">
      <h3 className="community-card-title">{t('communities.picker.about')}</h3>
      {dataMain.about ? <p className="community-about-line">{dataMain.about}</p> : null}
      {dataMain.description ? (
        <HiveMarkdown body={dataMain.description} className="community-description" collapsible />
      ) : null}
    </div>
  ) : null;

  const tabOptions = TABS.map((tb) => ({
    value: tb.key,
    label: t(tb.labelKey),
    count: tb.key === 'new' && newCount > 0 ? newCount : undefined,
  }));

  return (
    <div className="community-page-wrap">
      <Helmet>
        <title>{`3S | ${communityTitle}`}</title>
      </Helmet>

      <GroupHero
        avatar={communityAvatar}
        eyebrow={t('communities.page.fallbackTitle')}
        title={dataMain?.title || id}
        meta={heroMeta}
        stack={heroStack}
        // Subscribing is the thing a visitor came to this page to decide, so it
        // is the one big button beside the name.
        action={canSubscribe({ authenticated, incubationHandle }) ? (
          <GroupHeroJoin
            joined={subscribed}
            busy={subLoading}
            onClick={handleSubscribe}
            label={t('common.actions.subscribe')}
            joinedLabel={t('communities.page.subscribed')}
            busyLabel={t('common.status.loading')}
          />
        ) : null}
        tiles={[{ icon: 'ios_share', label: t('common.actions.share'), onClick: handleShare }]}
      />

      {kpiBlock}

      {/* Phones have no sidebar: the about card, top creators, team and rules
          sit above the tabs instead, rules folded. */}
      {dataMain ? (
        <div className="community-about--mobile">
          {aboutCard}
          <CommunityTopCreators id={id} />
          <CommunityTeam id={id} team={dataMain.team} />
          <CommunityRules text={dataMain.flag_text} collapsible />
        </div>
      ) : null}

      <div className="community-toolbar">
        <Segmented
          className="community-tabs"
          options={tabOptions}
          value={tab}
          onChange={(key) => setTab(key)}
          size={36}
          block={false}
          scroll
          label={communityTitle}
        />
        {tab === 'top' && (
          <select
            className="v2-input is-select community-window"
            aria-label={t('communities.page.timeRange')}
            value={topWindow}
            onChange={(e) => setTab('top', { window: e.target.value })}
          >
            {TOP_WINDOWS.map((w) => <option key={w.key} value={w.key}>{t(w.labelKey)}</option>)}
          </select>
        )}
        <div className="community-toolbar-actions">
          <Button variant="secondary" icon="live_tv" onClick={startSurf} disabled={surfing} loading={surfing} title={t('communities.page.surfTitle')}>
            {surfing ? t('communities.page.tuning') : t('communities.page.surf')}
          </Button>
          {canUpload && (
            <Button as={Link} to={uploadHref} variant="primary" icon="upload">
              {t('communities.page.uploadHere')}
            </Button>
          )}
        </div>
      </div>

      {/* Video grid + right sidebar (about, rules, top creators, team). */}
      <div className="community-body">
        <div className="community-feed">
          <CommunityPinned id={id} />

          {tab === 'new' && newCount > 0 && (
            <div className="v2-eyebrow is-accent community-new-since">
              {t('communities.page.newSinceVisit')} · <span className="num">{newCount}</span>
            </div>
          )}

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
            <div className="v2-failure community-state"><b>{t('communities.page.errorVideos')}</b></div>
          ) : videos.length === 0 ? (
            <EmptyState
              className="community-state"
              icon="video_library"
              title={tab === 'top' ? t('communities.page.emptyRange') : t('communities.page.empty')}
              action={canUpload ? (
                <Button as={Link} to={uploadHref} variant="secondary" size={36} icon="upload">{t('communities.page.uploadHere')}</Button>
              ) : null}
            />
          ) : (
            <Card3 windowed
              videos={videos}
              loading={isFetchingNextPage}
              getContentForVideo={getContentForVideo}
              isWatched={isWatched}
              getViewCount={getViewCount}
              isNew={isNew}
            />
          )}

          {videoTab && isFetchingNextPage && (
            <p className="community-loading-more v2-meta">
              <Icon name="progress_activity" size={16} className="v2-spin" /> {t('communities.page.loadingMore')}
            </p>
          )}
        </div>

        <aside className="community-side">
          {aboutCard}
          {dataMain ? <CommunityRules text={dataMain.flag_text} /> : null}
          <CommunityTopCreators id={id} side />
          {dataMain ? <CommunityTeam id={id} team={dataMain.team} /> : null}
        </aside>
      </div>
    </div>
  );
}

export default CommunityPage;
