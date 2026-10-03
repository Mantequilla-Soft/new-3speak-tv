import { useCallback } from 'react'
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
import { FirstUploadIcon } from '../components/FeedIcons';
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
        <div className='feed-page-header'>
          <FirstUploadIcon />
          <h2>{t('feeds.firstUploads.title')}</h2>
        </div>
        {isLoading ? <CardSkeleton /> :  <Card3 videos={videos} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />}
    {isError && <p>{t('feeds.errors.fetchVideos')}</p>}
      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>{t('feeds.loadingMore')}</p>
      )}
    </div>
    </PullToRefresh>
  )
}

export default FirstUploads