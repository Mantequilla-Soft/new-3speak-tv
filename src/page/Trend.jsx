import "./FirstUploads.scss";
import CardSkeleton from "../components/Cards/CardSkeleton";
import { useEffect, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Card3 from "../components/Cards/Card3";
import { TRENDING_SORTED_URL, appendNsfw } from '../utils/config';
import { feedParams } from '../utils/feedParams';
import { useAppStore } from '../lib/store';
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import { TrendingIcon } from "../components/FeedIcons";
import { useTranslation } from "react-i18next";

const LIMIT = 50;

const fetchVideos = async ({ pageParam = 1 }) => {
  const url = appendNsfw(`${TRENDING_SORTED_URL}?page=${pageParam}&limit=${LIMIT}${feedParams()}`, useAppStore.getState().showNsfw);
  const res = await axios.get(url);
  return res.data;
};

const Trend = () => {
  const { t } = useTranslation();
  const showNsfw = useAppStore(s => s.showNsfw);
  const hideWatched = useAppStore(s => s.hideWatched);
  const user = useAppStore(s => s.user);
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["trending", showNsfw, hideWatched, user],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.page >= lastPage.totalPages) return undefined;
      return lastPage.page + 1;
    },
  });

  // Infinite scroll effect
  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
          document.body.offsetHeight - 200 &&
        !isFetchingNextPage &&
        hasNextPage
      ) {
        fetchNextPage();
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  // Flatten all pages into one list
  const videos = data?.pages.flatMap(page => page.videos || []) || [];

  // Batch fetch content data
  const { getContentForVideo } = useContentBatch(videos);

  // Batch check watch history
  const { isWatched } = useWatchHistory(videos);

  // Batch fetch view counts
  const { getViewCount } = useViewCounts(videos);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["trending"] });
  }, [queryClient]);

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="firstupload-container">
      <div className="feed-page-header">
        <TrendingIcon />
        <h2>{t('common.nav.trending')}</h2>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <Card3 videos={videos} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
      )}

      {isError && <p>{t('misc.followFeed.error')}</p>}

      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>{t('feeds.loadingMore')}</p>
      )}
    </div>
    </PullToRefresh>
  );
};

export default Trend;
