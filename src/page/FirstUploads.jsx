import { useCallback, useEffect } from 'react'
import "./FirstUploads.scss"
import CardSkeleton from "../components/Cards/CardSkeleton";
import axios from 'axios'
import Card3 from '../components/Cards/Card3';
import { FIRST_UPLOADS_URL } from '../utils/config';
import { feedParams } from '../utils/feedParams';
import { useAppStore } from '../lib/store';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useContentBatch } from '../hooks/useContentBatch';
import { useWatchHistory } from '../hooks/useWatchHistory';
import useViewCounts from '../hooks/useViewCounts';
import PullToRefresh from '../components/PullToRefresh/PullToRefresh';
import { FeedPageHeader, FirstUploadIcon } from '../components/FeedIcons';
import { useTranslation } from 'react-i18next';

const fetchVideos = async ({ pageParam = 1 }) => {
  // Checker /feeds/firstUploads is page-based (1,2,…) and returns
  // {success, feed, page, limit, total, totalPages, videos:[…]} — unwrap to
  // the array so the rest of this component keeps working as before.
  const res = await axios.get(`${FIRST_UPLOADS_URL}?page=${pageParam}&limit=50${feedParams()}`);
  return res.data.videos || [];
};

const FirstUploads = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const hideWatched = useAppStore(s => s.hideWatched);
  const user = useAppStore(s => s.user);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["firstupload", hideWatched, user],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 0 ? undefined : allPages.length + 1,
  });

    // Infinite scroll: the next page loads as the end of the grid comes near
    // (49c "Loading more…"), like the other feed pages.
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
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

    const videos = data?.pages.flat() || [];
    const { getContentForVideo } = useContentBatch(videos);
    const { isWatched } = useWatchHistory(videos);
    const { getViewCount } = useViewCounts(videos);

    const handleRefresh = useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey: ["firstupload"] });
    }, [queryClient]);

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className='firstupload-container'>
        <FeedPageHeader icon={<FirstUploadIcon />} title={t('feeds.firstUploads.title')} />
        {isLoading ? <CardSkeleton /> :  <Card3 windowed videos={videos} badgeLabel={t('cards.badges.first')} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />}
    {isError && <p className="feed-error" role="alert">{t('feeds.errors.fetchVideos')}</p>}
      {isFetchingNextPage && (
        <p className="feed-loading-more">{t('feeds.loadingMore')}</p>
      )}
    </div>
    </PullToRefresh>
  )
}

export default FirstUploads