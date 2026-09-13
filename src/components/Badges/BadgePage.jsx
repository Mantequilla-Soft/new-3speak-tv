import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import axios from "axios";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Users, Video, CalendarDays, Award, Check, Plus, Globe, MapPin } from "lucide-react";
import { BADGES_URL, appendNsfw } from "../../utils/config";
import { feedParams } from "../../utils/feedParams";
import { useAppStore } from "../../lib/store";
import ProfileHeader from "../ProfileHeader/ProfileHeader";
import HiveAvatar from "../HiveAvatar/HiveAvatar";
import Card3 from "../Cards/Card3";
import CardSkeleton from "../Cards/CardSkeleton";
import { useContentBatch } from "../../hooks/useContentBatch";
import { useWatchHistory } from "../../hooks/useWatchHistory";
import useViewCounts from "../../hooks/useViewCounts";
import "./BadgePage.scss";

const LIMIT = 30;

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

/**
 * A badge account's page: who holds the badge, and what they publish here.
 *
 * A Hive "badge" is an account whose profile IS the badge (name, description,
 * image) and whose FOLLOWING list is the people who earned it. Nothing on chain
 * marks an account as a badge, so this page works for any account and simply
 * reads better for one shaped like a badge.
 *
 * The shape mirrors CommunityPage deliberately: same header, same tab bar, same
 * card grid. What changes is the question the feed answers. A community feed is
 * "videos filed here"; a badge feed is "videos by the people who hold this",
 * which the checker builds with the same ranking as the follow feed
 * (utils/followFeed.js there).
 */
function BadgePage() {
  const { account: routeAccount } = useParams();
  const account = String(routeAccount || '').toLowerCase();
  // Keyed remount rather than an effect that clears state on the way in: every
  // piece of state below belongs to ONE badge, and navigating between two badge
  // pages should start the second one clean.
  return <BadgeView key={account} account={account} />;
}

function BadgeView({ account }) {
  const [badge, setBadge] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState('videos');           // 'videos' | 'recipients'
  const [recipients, setRecipients] = useState(null); // null until the tab is opened
  const [recipientsError, setRecipientsError] = useState(false);

  const user = useAppStore(s => s.user);
  const hideWatched = useAppStore(s => s.hideWatched);
  const showNsfw = useAppStore(s => s.showNsfw);

  // The tab title is the badge's own name, never the account id: "badge-030021"
  // tells a reader nothing. This route is listed in RouteTitle's SELF_TITLED so
  // nothing competes for the tag.
  const badgeTitle = badge?.title || 'Badge';

  useEffect(() => {
    if (!account) return undefined;
    let alive = true;
    axios.get(`${BADGES_URL}/${account}`)
      .then(res => { if (alive) setBadge(res.data); })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [account]);

  // Recipients are fetched when the tab is first opened, not on page load: the
  // list is a second round trip and most visitors only ever look at the videos.
  useEffect(() => {
    if (tab !== 'recipients' || recipients || !account) return undefined;
    let alive = true;
    axios.get(`${BADGES_URL}/${account}/recipients?limit=100`)
      .then(res => { if (alive) setRecipients(res.data); })
      .catch(() => { if (alive) setRecipientsError(true); });
    return () => { alive = false; };
  }, [tab, recipients, account]);

  const fetchVideos = async ({ pageParam = 1 }) => {
    const url = appendNsfw(
      `${BADGES_URL}/${account}/feed?page=${pageParam}&limit=${LIMIT}${feedParams()}`,
      showNsfw
    );
    const res = await axios.get(url);
    return res.data;
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["badgeFeed", account, hideWatched, user, showNsfw],
    queryFn: fetchVideos,
    initialPageParam: 1,
    // The badge feed reports `totalPages` over a bounded candidate pool, so
    // unlike the community feed this can page for real instead of stopping
    // after the first batch.
    getNextPageParam: (last) =>
      last && last.page < last.totalPages ? last.page + 1 : undefined,
    enabled: !!account,
  });

  const videos = data?.pages.flatMap(p => p?.videos || []) || [];
  const feedType = data?.pages?.[0]?.feedType;
  // The feed's own count. "Recent" because the checker ranks over a bounded pool
  // of the newest candidates rather than the whole archive, so on a badge with
  // thousands of recipients this is the size of that window, not a lifetime total.
  const videoTotal = data?.pages?.[0]?.total;

  useEffect(() => {
    const onScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200 &&
        !isFetchingNextPage && hasNextPage
      ) {
        fetchNextPage();
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const { getContentForVideo } = useContentBatch(videos);
  const { isWatched } = useWatchHistory(videos);
  const { getViewCount } = useViewCounts(videos);

  const createdLabel = (() => {
    if (!badge?.created) return '—';
    const d = new Date(String(badge.created).replace(' ', 'T') + 'Z');
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  })();

  const kpis = badge ? [
    { key: 'recipients', icon: <Award size={16} />, label: 'Recipients', value: fmtNum(badge.recipients) },
    { key: 'videos', icon: <Video size={16} />, label: 'Recent videos', value: fmtNum(videoTotal) },
    { key: 'since', icon: <CalendarDays size={16} />, label: 'Issued', value: createdLabel },
  ] : [];

  const kpiBlock = kpis.length ? (
    <div className="badge-kpis">
      {kpis.map((k) => (
        <div className="badge-kpi" key={k.key}>
          <span className="badge-kpi-icon">{k.icon}</span>
          <span className="badge-kpi-text">
            <span className="badge-kpi-value">{k.value}</span>
            <span className="badge-kpi-label">{k.label}</span>
          </span>
        </div>
      ))}
    </div>
  ) : null;

  // Issuer + links, shown under the stats. `creator` is the account that created
  // the badge account, which is the closest thing Hive records to "who issues
  // this badge".
  const metaBlock = badge && (badge.creator || badge.website || badge.location) ? (
    <div className="badge-meta">
      {badge.creator ? (
        <span className="badge-meta-row">
          <Award size={14} /> Issued by <Link to={`/p/${badge.creator}`}>@{badge.creator}</Link>
        </span>
      ) : null}
      {badge.location ? (
        <span className="badge-meta-row"><MapPin size={14} /> {badge.location}</span>
      ) : null}
      {badge.website ? (
        <span className="badge-meta-row">
          <Globe size={14} />
          <a href={badge.website} target="_blank" rel="noopener noreferrer nofollow">
            {String(badge.website).replace(/^https?:\/\//, '')}
          </a>
        </span>
      ) : null}
    </div>
  ) : null;

  if (loadError) {
    return (
      <div className="badge-page-wrap">
        <div className="badge-empty">
          <h2>Badge not found</h2>
          <p>No Hive account named @{account} could be read right now.</p>
          <Link className="badge-empty-link" to="/badges">Browse all badges</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="badge-page-wrap">
      <Helmet>
        <title>{`3S | ${badgeTitle}`}</title>
      </Helmet>

      <ProfileHeader
        username={account}
        name={badge?.title || account}
        bio={badge?.description}
        // Straight from the index. A badge's art is usually uploaded here, and
        // images.hive.blog cannot serve it back to us.
        avatarUrl={badge?.image}
        coverUrl={badge?.cover}
        // No subscribe here. Subscribing to a badge is a plain Hive follow of
        // the badge account, which does nothing: a badge is not a feed you join,
        // it is an award someone gives you. The count it produced was a
        // popularity number that read as if it meant membership.
      />

      {/* Mobile-only: stats sit above the tabs; the desktop sidebar carries them. */}
      {kpiBlock ? (
        <div className="badge-intro">
          <div className="badge-intro-stats">{kpiBlock}</div>
        </div>
      ) : null}

      <div className="badge-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'videos'}
          className={`badge-tab${tab === 'videos' ? ' active' : ''}`}
          onClick={() => setTab('videos')}
        >
          <span className="badge-tab-icon"><Video size={16} /></span>
          <span className="badge-tab-label">Videos</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recipients'}
          className={`badge-tab${tab === 'recipients' ? ' active' : ''}`}
          onClick={() => setTab('recipients')}
        >
          <span className="badge-tab-icon"><Award size={16} /></span>
          <span className="badge-tab-label">
            Recipients{badge?.recipients ? ` (${fmtNum(badge.recipients)})` : ''}
          </span>
        </button>
      </div>

      <div className="badge-body">
        <div className="badge-feed">
          {tab === 'videos' ? (
            isLoading ? (
              <CardSkeleton />
            ) : isError ? (
              <p>Error fetching videos</p>
            ) : videos.length === 0 ? (
              // A badge with no recipients, or recipients who have not posted
              // here, gets this. It must never fall through to the global feed,
              // which is why the checker's badge feed has the fallback off.
              <div className="badge-empty">
                <h2>No videos yet</h2>
                <p>
                  {feedType === 'empty'
                    ? 'Nobody holds this badge yet.'
                    : 'Nobody holding this badge has published a video on 3Speak yet.'}
                </p>
              </div>
            ) : (
              <Card3
                videos={videos}
                loading={isFetchingNextPage}
                getContentForVideo={getContentForVideo}
                isWatched={isWatched}
                getViewCount={getViewCount}
              />
            )
          ) : (
            <RecipientList data={recipients} error={recipientsError} />
          )}

          {tab === 'videos' && isFetchingNextPage && (
            <p style={{ textAlign: "center" }}>Loading more...</p>
          )}
        </div>

        <aside className="badge-side">
          {kpiBlock}
          {metaBlock}
        </aside>
      </div>
    </div>
  );
}

/**
 * The holders. Ordered by how much they publish here (the checker does the
 * ordering), so the people a visitor can actually watch come first instead of
 * an alphabetical wall of avatars.
 */
function RecipientList({ data, error }) {
  if (error) return <p>Could not load recipients</p>;
  if (!data) return <p className="badge-recipients-loading">Loading recipients...</p>;
  if (!data.recipients?.length) {
    return (
      <div className="badge-empty">
        <h2>No recipients yet</h2>
        <p>Nobody has been awarded this badge so far.</p>
      </div>
    );
  }

  return (
    <>
      <p className="badge-recipients-summary">
        {fmtNum(data.total)} {data.total === 1 ? 'recipient' : 'recipients'}
        {data.withVideos > 0 ? `, ${fmtNum(data.withVideos)} publishing on 3Speak` : ''}
      </p>
      <div className="badge-recipients">
        {data.recipients.map(r => (
          <Link className="badge-recipient" to={`/p/${r.account}`} key={r.account}>
            <HiveAvatar username={r.account} size="small" className="badge-recipient-avatar" />
            <span className="badge-recipient-text">
              <span className="badge-recipient-name">{r.displayName || r.account}</span>
              <span className="badge-recipient-handle">@{r.account}</span>
            </span>
            <span className="badge-recipient-count">
              {r.videos > 0 ? `${fmtNum(r.videos)} ${r.videos === 1 ? 'video' : 'videos'}` : 'No videos'}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

export default BadgePage;
