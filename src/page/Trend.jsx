import "./FirstUploads.scss";
import CardSkeleton from "../components/Cards/CardSkeleton";
import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import axios from "axios";
import Card3 from "../components/Cards/Card3";
import { FEED_URL } from '../utils/config';

const LIMIT = 500;

const fetchVideos = async ({ pageParam = 0 }) => {
  let url;

  // On first load, use /feeds/trending
  if (pageParam === 0) {
    url = `${FEED_URL}/apiv2/feeds/trending?limit=${LIMIT}`;
  } 
  // On later loads, use /feeds/trending/more with skip
  else {
    url = `${FEED_URL}/apiv2/feeds/trending/more?skip=${pageParam}`;
  }

  const res = await axios.get(url);
  // Notice: trending returns an array, while /more returns { trends: [...] }
  return res.data.trends || res.data;
};

const Trend = () => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["trending"],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage, allPages) => {
      // If lastPage returned data, calculate new skip
      const currentTotal = allPages.flat().length;
      if (lastPage && lastPage.length > 0) return currentTotal;
      return undefined; // Stop when no more data
    },
  });

  console.log(data)

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
  const videos = data?.pages.flat() || [];
  console.log(videos)

  return (
    <div className="firstupload-container">
      <div className="headers">TRENDING</div>

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <Card3 videos={videos} loading={isFetchingNextPage} />
      )}

      {isError && <p>Error fetching videos</p>}

      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>Loading more...</p>
      )}
    </div>
  );
};

export default Trend;
