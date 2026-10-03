import "./FirstUploads.scss";
import CardSkeleton from "../components/Cards/CardSkeleton";
import { useEffect, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Card3 from "../components/Cards/Card3";
import { useLiveStreams } from "../hooks/useLiveStreams";
import { NEW_CONTENT_URL, appendNsfw } from "../utils/config";
import { useAppStore } from "../lib/store";
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import { NewContentIcon } from "../components/FeedIcons";
import { useTranslation } from "react-i18next";

const LIMIT = 50;

const fetchVideos = async ({ pageParam = 1 }) => {
  const url = appendNsfw(`${NEW_CONTENT_URL}?page=${pageParam}&limit=${LIMIT}`, useAppStore.getState().showNsfw);
  const res = await axios.get(url);
  return res.data;
};

const NewVideos = () => {
  const { t } = useTranslation();
  const showNsfw = useAppStore(s => s.showNsfw);
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["newVideos", showNsfw],
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
  const liveStreams = useLiveStreams(); // live OpenPods streams as regular tiles

  // Batch fetch content data
  const { getContentForVideo } = useContentBatch(videos);

  // Batch check watch history
  const { isWatched } = useWatchHistory(videos);

  // Batch fetch view counts
  const { getViewCount } = useViewCounts(videos);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["newVideos"] });
  }, [queryClient]);

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="firstupload-container">
      <div className="feed-page-header">
        <NewContentIcon />
        <h2>{t('feeds.newVideos.title')}</h2>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <Card3 videos={[...liveStreams, ...videos]} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
      )}

      {isError && <p>{t('feeds.errors.fetchVideos')}</p>}

      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>{t('feeds.loadingMore')}</p>
      )}
    </div>
    </PullToRefresh>
  );
};

export default NewVideos;
