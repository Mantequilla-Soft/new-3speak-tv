import { useState, useMemo, useCallback } from 'react';
import CardSkeleton from '../components/Cards/CardSkeleton';
import { useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Card3 from '../components/Cards/Card3';
import { TAG_FEED_URL } from '../utils/config';
import { feedParams } from '../utils/feedParams';
import { useAppStore } from '../lib/store';
import { useContentBatch } from '../hooks/useContentBatch';
import { useWatchHistory } from '../hooks/useWatchHistory';
import useViewCounts from '../hooks/useViewCounts';
import PullToRefresh from '../components/PullToRefresh/PullToRefresh';
import { getSinceTimestamp } from '../utils/dateFilters';
import { FeedToolbar, Pagination } from '../components/FeedToolbar/FeedToolbar';
import NewFromFollowing from '../components/NewFromFollowing/NewFromFollowing';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import './FirstUploads.scss';
import './TagFeed.scss';

const LIMIT = 20;

function TagFeed() {
  const { t } = useTranslation();
  const { tag } = useParams();
  // A community picked from the tag strip arrives with its display name.
  const location = useLocation();
  const communityName = location.state?.commuintyName || null;
  const queryClient = useQueryClient();

  // Videos, shorts or both, as last picked on any tag page.
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('3speak-tag-type');
      return ['all', 'videos', 'shorts'].includes(saved) ? saved : 'videos';
    } catch { return 'videos'; }
  });
  const [dateFilter, setDateFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const hideWatched = useAppStore(s => s.hideWatched);
  const feedUser = useAppStore(s => s.user);

  const since = useMemo(() => getSinceTimestamp(dateFilter), [dateFilter]);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    try { localStorage.setItem('3speak-tag-type', tab); } catch { /* storage off */ }
  }, []);

  const handleDateFilterChange = useCallback((key) => {
    setDateFilter(key);
    setCurrentPage(1);
  }, []);

  // Lightweight counts query — runs independently of the data query
  const { data: counts } = useQuery({
    queryKey: ['tagCounts', tag, since],
    queryFn: async () => {
      let url = `${TAG_FEED_URL}/videos/tag/${tag}/counts`;
      if (since) url += `?since=${since}`;
      const res = await axios.get(url);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  // What was tagged in the past 7 days, for the "· 312 this week" in the header
  // (19c). The same counts call with the week's start, so with the Week filter
  // on it is the query above, served once.
  const weekSince = useMemo(() => getSinceTimestamp('week'), []);
  const { data: weekCounts } = useQuery({
    queryKey: ['tagCounts', tag, weekSince],
    queryFn: async () => {
      const res = await axios.get(`${TAG_FEED_URL}/videos/tag/${tag}/counts?since=${weekSince}`);
      return res.data;
    },
    staleTime: 60 * 1000,
  });
  // And everything ever tagged, whatever the date filter says (with "all time"
  // picked this is the counts query above: same key, one request).
  const { data: allCounts } = useQuery({
    queryKey: ['tagCounts', tag, 0],
    queryFn: async () => {
      const res = await axios.get(`${TAG_FEED_URL}/videos/tag/${tag}/counts`);
      return res.data;
    },
    staleTime: 60 * 1000,
  });
  const sumOf = (c) => c.total ?? (c.videos || 0) + (c.shorts || 0);
  const allTimeTotal = allCounts ? sumOf(allCounts) : null;

  // Always pass type — avoids the expensive merged "all" path on the backend
  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['tagFeed', tag, activeTab, since, currentPage, hideWatched, feedUser],
    queryFn: async () => {
      let url = `${TAG_FEED_URL}/videos/tag/${tag}?page=${currentPage}&limit=${LIMIT}&type=${activeTab}${feedParams()}`;
      if (since) url += `&since=${since}`;
      const res = await axios.get(url);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const allItems = data?.videos || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const tabs = useMemo(() => [
    { key: 'videos', label: counts ? t('feeds.tabs.videosCount', { count: counts.videos }) : t('feeds.tabs.videos') },
    { key: 'shorts', label: counts ? t('feeds.tabs.shortsCount', { count: counts.shorts }) : t('feeds.tabs.shorts') },
  ], [counts, t]);

  const { getContentForVideo } = useContentBatch(allItems);
  const { isWatched } = useWatchHistory(allItems);
  const { getViewCount } = useViewCounts(allItems);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['tagFeed', tag] });
    await queryClient.invalidateQueries({ queryKey: ['tagCounts', tag] });
  }, [queryClient, tag]);

  const renderVideos = (items) => (
    <Card3 windowed
      variant="bare"
      videos={items}
      error={isError ? t('feeds.errors.loadVideos') : ''}
      loading={isFetching}
      getContentForVideo={getContentForVideo}
      isWatched={isWatched}
      getViewCount={getViewCount}
    />
  );

  const renderShorts = (items) => (
    <Card3 windowed
      variant="bare"
      videos={items}
      error={isError ? t('feeds.errors.loadShorts') : ''}
      loading={isFetching}
      getContentForVideo={getContentForVideo}
      isWatched={isWatched}
      getViewCount={getViewCount}
      linkPrefix="/shorts"
      shortsGrid
    />
  );

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="firstupload-container tag-feed">
      {/* The tag as the page title (19c): a cyan eyebrow, the big #tag, and
          how much is tagged with it. Not here: "Follow tag" and how many
          creators use it, which nothing on 3Speak tracks yet. */}
      <header className="tag-feed-head">
        <div className="tag-feed-head__text">
          <span className="tag-feed-eyebrow">{communityName ? t('feeds.discover.community') : t('feeds.discover.tag')}</span>
          <h1 className="tag-feed-title">{communityName || `#${tag}`}</h1>
          {(allTimeTotal != null || weekCounts) && (
            <p className="tag-feed-meta">
              {[
                allTimeTotal != null && t('feeds.tagMeta.videos', { count: allTimeTotal, num: formatNumber(allTimeTotal) }),
                weekCounts && t('feeds.tagMeta.thisWeek', { num: formatNumber(sumOf(weekCounts)) }),
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </header>

      <FeedToolbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        dateFilter={dateFilter}
        onDateFilterChange={handleDateFilterChange}
        tabs={tabs}
      />

      {/* Signed in with something unwatched from people you follow; nothing otherwise */}
      <NewFromFollowing />

      {isLoading ? (
        <CardSkeleton />
      ) : activeTab === 'shorts' ? (
        renderShorts(allItems)
      ) : (
        renderVideos(allItems)
      )}

      {totalPages > 1 && (
        <div className="tag-feed-pagination-bottom">
          <Pagination page={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}

export default TagFeed;
