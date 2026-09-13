import "./FirstUploads.scss";
import CardSkeleton from "../components/Cards/CardSkeleton";
import { useEffect, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Card3 from "../components/Cards/Card3";
import { useLiveStreams } from "../hooks/useLiveStreams";
import { FOLLOW_FEED_URL, appendNsfw } from "../utils/config";
import { feedParams } from "../utils/feedParams";
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import { useAppStore } from "../lib/store";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import { TrendingIcon } from "../components/FeedIcons";

const LIMIT = 50;

const fetchVideos = async ({ pageParam = 1 }, username) => {
  const st = useAppStore.getState();
  // interests re-rank + hide-watched (when the setting is on) via the shared params.
  const url = appendNsfw(`${FOLLOW_FEED_URL}/${username}?page=${pageParam}&limit=${LIMIT}${feedParams()}`, st.showNsfw);
  const res = await axios.get(url);
  return res.data;
};

const FollowFeed = () => {
  const { user, showNsfw, hideWatched } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // Whose follows this feed is of. A handle is not a Hive account, but the
  // checker resolves it against the off-chain follows, so it answers the same
  // question. Without this the query never ran for them at all.
  const feedName = user || incubationHandle;
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["follow-feed-page", feedName, showNsfw, hideWatched],
    queryFn: (ctx) => fetchVideos(ctx, feedName),
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.page >= lastPage.totalPages) return undefined;
      return lastPage.page + 1;
    },
    initialPageParam: 1,
    enabled: !!feedName,
  });

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

  const videos = data?.pages.flatMap(page => page.videos || []) || [];
  const liveStreams = useLiveStreams({ following: true }); // live streams from followed creators

  const { getContentForVideo } = useContentBatch(videos);
  const { isWatched } = useWatchHistory(videos);
  const { getViewCount } = useViewCounts(videos);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["follow-feed-page", feedName] });
  }, [queryClient, feedName]);

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="firstupload-container">
      <div className="feed-page-header">
        <TrendingIcon />
        <h2>Follow Feed</h2>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <Card3 videos={[...liveStreams, ...videos]} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
      )}

      {isError && <p>Error fetching videos</p>}

      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>Loading more...</p>
      )}
    </div>
    </PullToRefresh>
  );
};

export default FollowFeed;
