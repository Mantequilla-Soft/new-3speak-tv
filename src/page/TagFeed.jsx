import { useState, useMemo, useCallback } from 'react';
import CardSkeleton from '../components/Cards/CardSkeleton';
import { useParams } from 'react-router-dom';
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
import { useTranslation } from 'react-i18next';
import './TagFeed.scss';

const LIMIT = 20;

function TagFeed() {
  const { t } = useTranslation();
  const { tag } = useParams();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('videos');
  const [dateFilter, setDateFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const hideWatched = useAppStore(s => s.hideWatched);
  const feedUser = useAppStore(s => s.user);

  const since = useMemo(() => getSinceTimestamp(dateFilter), [dateFilter]);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
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
    <Card3
      videos={items}
      error={isError ? t('feeds.errors.loadVideos') : ''}
      loading={isFetching}
      getContentForVideo={getContentForVideo}
      isWatched={isWatched}
      getViewCount={getViewCount}
    />
  );

  const renderShorts = (items) => (
    <Card3
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
    <div className="firstupload-container">
      <FeedToolbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        dateFilter={dateFilter}
        onDateFilterChange={handleDateFilterChange}
        tabs={tabs}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

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
