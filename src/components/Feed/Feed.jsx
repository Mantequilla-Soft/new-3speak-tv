
import "./Feed.scss"
import CommunitiesTags from "../communities-tags/CommunitiesTags"
import { useEffect, useState } from "react"
import { has3SpeakPostAuth } from '../../utils/hiveUtils';
import { useAppStore } from '../../lib/store';
import CardSkeleton from "../Cards/CardSkeleton"
import axios from "axios"
import { FEED_URL, FOLLOW_FEED_URL, TRENDING_SORTED_URL, appendNsfw } from '../../utils/config'
import { feedParams } from '../../utils/feedParams'
import { useInfiniteQuery } from "@tanstack/react-query"
import Card3 from "../Cards/Card3"
import { useContentBatch } from "../../hooks/useContentBatch"
import { useWatchHistory } from "../../hooks/useWatchHistory"
import useViewCounts from "../../hooks/useViewCounts"
import { useTranslation } from "react-i18next"



const FOLLOW_LIMIT = 50;

const fetchFollowFeedVideos = async ({ pageParam = 1 }, username) => {
  const st = useAppStore.getState();
  // interests re-rank + hide-watched (when on) via the shared params.
  const url = appendNsfw(`${FOLLOW_FEED_URL}/${username}?page=${pageParam}&limit=${FOLLOW_LIMIT}${feedParams()}`, st.showNsfw);
  const res = await axios.get(url);
  return res.data;
};

const fetchHomeVideos = async ({ pageParam = 0 }) => {
  // Anonymous home: use the algo-aligned trendingSorted feed (retention + interests)
  // instead of the legacy `trending`-flag endpoint. 1-based paging, {…,videos:[…]}.
  const page = (Number(pageParam) || 0) + 1;
  const url = `${TRENDING_SORTED_URL}?page=${page}&limit=${FOLLOW_LIMIT}${feedParams()}`;
  const res = await axios.get(url);
  // Fall back through the older shapes in case FEED_URL is ever pointed back
  // at legacy.3speak.tv — keeps the consumer agnostic to either response.
  return res.data.videos || res.data.trends || res.data;
};

function Feed() {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const {authenticated, user, showNsfw, hideWatched} = useAppStore();

  useEffect(()=>{
    checkPostAuth(user);
  },[])

   const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isError,
} = useInfiniteQuery({
  queryKey: authenticated ? ["follow-feed", user, showNsfw, hideWatched] : ["home"],
  queryFn: authenticated
    ? (ctx) => fetchFollowFeedVideos(ctx, user)
    : fetchHomeVideos,
  getNextPageParam: authenticated
    ? (lastPage) => {
        if (!lastPage || lastPage.page >= lastPage.totalPages) return undefined;
        return lastPage.page + 1;
      }
    : (lastPage, allPages) => {
        const nextSkips = [64, 128];
        const next = nextSkips[allPages.length - 1];
        return next || undefined;
      },
  initialPageParam: authenticated ? 1 : 0,
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
  
    // Flatten all pages into a single array
    const videos = authenticated
      ? data?.pages.flatMap(page => page.videos || []) || []
      : data?.pages.flat() || [];

    // Batch fetch content data (payout, voters) for all videos
    const { getContentForVideo } = useContentBatch(videos);

    // Batch check watch history for all videos
    const { isWatched, version: watchedVersion } = useWatchHistory(videos);

    // Batch fetch view counts
    const { getViewCount } = useViewCounts(videos);

    async function checkPostAuth(username) {
      if(!authenticated){
        return
      }
      const hasAuth = await has3SpeakPostAuth(username);
      if (!hasAuth) {
        setIsOpen(true);
      }
    }

  return (
    <>
    <>
    <CommunitiesTags />

    {isLoading ? <CardSkeleton /> :  <Card3 videos={videos} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} hideWatched={hideWatched} watchedVersion={watchedVersion} getViewCount={getViewCount} />}
    {isError && <p>{t('feeds.errors.fetchVideos')}</p>}
      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>{t('feeds.loadingMore')}</p>
      )}
    </>
    {/* {isOpen && <Auth_modal  isOpen={isOpen} close={toggleUploadModal} />} */}
    </>
  );
}

export default Feed