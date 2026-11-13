import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import axios from "axios";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BADGES_URL, appendNsfw } from "../../utils/config";
import { feedParams } from "../../utils/feedParams";
import { useAppStore } from "../../lib/store";
import HiveAvatar from "../HiveAvatar/HiveAvatar";
import { cachedProfileImage } from "../../utils/avatarCache";
import Card3 from "../Cards/Card3";
import CardSkeleton from "../Cards/CardSkeleton";
import { useContentBatch } from "../../hooks/useContentBatch";
import { useWatchHistory } from "../../hooks/useWatchHistory";
import useViewCounts from "../../hooks/useViewCounts";
import { useTranslation, Trans } from "react-i18next";
import { formatNumber, formatDate } from "../../i18n";
import { toastIn } from "../../utils/toast";
import { Button, EmptyState, Segmented, StatTile } from "../v2/ui";
import { Icon } from "../v2/Icon";
import GroupHero from "../Groups/GroupHero";
import "./BadgePage.scss";

// Toasts from this page are headed "Badges"; see utils/toast.js.
const toast = toastIn('Badges');

const LIMIT = 30;

const fmtNum = (n) => (typeof n === 'number' ? formatNumber(n) : '—');

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
  const { t } = useTranslation();
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
  const badgeTitle = badge?.title || t('badges.page.fallbackTitle');

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
    return isNaN(d) ? '—' : formatDate(d, { month: 'short', year: 'numeric' });
  })();

  const kpis = badge ? [
    { key: 'recipients', label: t('badges.page.kpis.recipients'), value: fmtNum(badge.recipients) },
    { key: 'videos', label: t('badges.page.kpis.recentVideos'), value: fmtNum(videoTotal) },
    { key: 'since', label: t('badges.page.kpis.issued'), value: createdLabel },
  ] : [];

  // Design 41c: three KPI wells under the header.
  const kpiBlock = kpis.length ? (
    <div className="badge-kpis">
      {kpis.map((k) => <StatTile key={k.key} className="badge-kpi" label={k.label} value={k.value} />)}
    </div>
  ) : null;

  // Issuer + links, on the header's meta line. `creator` is the account that
  // created the badge account, which is the closest thing Hive records to "who
  // issues this badge".
  const metaBlock = badge && (badge.creator || badge.website || badge.location) ? (
    <>
      {badge.creator ? (
        <span className="badge-meta-row">
          <Trans
            i18nKey="badges.page.issuedBy"
            values={{ creator: badge.creator }}
            components={{ creatorLink: <Link to={`/@${badge.creator}`} /> }}
          />
        </span>
      ) : null}
      {badge.location ? (
        <span className="badge-meta-row"><Icon name="location_on" size={16} /> {badge.location}</span>
      ) : null}
      {badge.website ? (
        <span className="badge-meta-row">
          <Icon name="language" size={16} />
          <a href={badge.website} target="_blank" rel="noopener noreferrer nofollow">
            {String(badge.website).replace(/^https?:\/\//, '')}
          </a>
        </span>
      ) : null}
    </>
  ) : null;

  // Share tile: the system share sheet where there is one, else copy the link.
  const handleShare = async () => {
    const url = `${window.location.origin}/b/${account}`;
    try {
      if (navigator.share) { await navigator.share({ title: badgeTitle, url }); return; }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('common.actions.copied'));
    } catch { /* nothing to copy into */ }
  };

  if (loadError) {
    return (
      <div className="badge-page-wrap">
        <EmptyState
          className="badge-empty"
          icon="workspace_premium"
          title={t('badges.page.notFoundTitle')}
          action={<Button as={Link} to="/badges" variant="secondary" size={36} next>{t('badges.page.browseAll')}</Button>}
        >
          {t('badges.page.notFoundBody', { account })}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="badge-page-wrap">
      <Helmet>
        <title>{`3S | ${badgeTitle}`}</title>
      </Helmet>

      {/* No subscribe here. Subscribing to a badge is a plain Hive follow of
          the badge account, which does nothing: a badge is not a feed you join,
          it is an award someone gives you. */}
      <GroupHero
        // From the index, but through our /img/ cache rather than the raw
        // original on someone else's host (see cachedProfileImage).
        avatar={cachedProfileImage(account, badge?.image, 'large')}
        round
        coin
        eyebrow={t('badges.page.fallbackTitle')}
        title={badge?.title || account}
        meta={metaBlock}
        about={badge?.description}
        tiles={[{ icon: 'ios_share', label: t('common.actions.share'), onClick: handleShare }]}
      />

      {kpiBlock}

      <Segmented
        className="badge-tabs"
        options={[
          { value: 'videos', label: t('badges.page.tabs.videos') },
          {
            value: 'recipients',
            label: badge?.recipients
              ? t('badges.page.tabs.recipientsWithCount', { num: fmtNum(badge.recipients) })
              : t('badges.page.tabs.recipients'),
          },
        ]}
        value={tab}
        onChange={setTab}
        size={36}
        block={false}
        label={badgeTitle}
      />

      <div className="badge-feed">
        {tab === 'videos' ? (
          isLoading ? (
            <CardSkeleton />
          ) : isError ? (
            <div className="v2-failure"><b>{t('badges.page.errorVideos')}</b></div>
          ) : videos.length === 0 ? (
            // A badge with no recipients, or recipients who have not posted
            // here, gets this. It must never fall through to the global feed,
            // which is why the checker's badge feed has the fallback off.
            <EmptyState className="badge-empty" icon="video_library" title={t('badges.page.noVideosTitle')}>
              {feedType === 'empty' ? t('badges.page.noHolders') : t('badges.page.noHolderVideos')}
            </EmptyState>
          ) : (
            <Card3 windowed
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
          <p className="badge-loading-more v2-meta">
            <Icon name="progress_activity" size={16} className="v2-spin" /> {t('badges.page.loadingMore')}
          </p>
        )}
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
  const { t } = useTranslation();
  if (error) return <div className="v2-failure"><b>{t('badges.page.recipientsError')}</b></div>;
  if (!data) {
    return (
      <p className="badge-recipients-loading v2-meta">
        <Icon name="progress_activity" size={16} className="v2-spin" /> {t('badges.page.recipientsLoading')}
      </p>
    );
  }
  if (!data.recipients?.length) {
    return (
      <EmptyState className="badge-empty" icon="workspace_premium" title={t('badges.page.noRecipientsTitle')}>
        {t('badges.page.noRecipientsBody')}
      </EmptyState>
    );
  }

  return (
    <div className="badge-recipients-card">
      <p className="badge-recipients-summary">
        {data.withVideos > 0
          ? t('badges.page.recipientsSummaryWithVideos', { count: data.total, num: fmtNum(data.total), publishing: fmtNum(data.withVideos) })
          : t('badges.page.recipientsSummary', { count: data.total, num: fmtNum(data.total) })}
      </p>
      <div className="badge-recipients">
        {data.recipients.map(r => (
          <Link className="badge-recipient" to={`/@${r.account}`} key={r.account} title={`@${r.account}`}>
            <HiveAvatar username={r.account} size="small" className="badge-recipient-avatar" />
            <b className="badge-recipient-name">{r.displayName || r.account}</b>
            <span className="badge-recipient-count num">
              {r.videos > 0 ? t('badges.page.recipientVideos', { count: r.videos, num: fmtNum(r.videos) }) : t('badges.page.recipientNoVideos')}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default BadgePage;
