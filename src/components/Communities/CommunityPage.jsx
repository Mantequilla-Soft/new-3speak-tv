import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Client } from "@hiveio/dhive";
import "./CommunityPage.scss";
import axios from "axios";
import { FEED_URL } from '../../utils/config'
import { useInfiniteQuery } from "@tanstack/react-query";
import Card3 from "../Cards/Card3";
import CardSkeleton from "../Cards/CardSkeleton";
import Com_PageSke_Loader from "./Com_PageSke_Loader";

// Hive client
const client = new Client(["https://api.hive.blog", "https://api.openhive.network"]);

function CommunityPage() {
  const { communityName: id } = useParams();
  const [dataMain, setDataMain] = useState(null);
  const [trend, setTrend] = useState(true); // true = trending, false = new

  // Fetch community info
  const fetchCommunityData = async (id) => {
    try {
      const communityData = await client.call("bridge", "get_community", {
        name: id,
        observer: "",
      });
      setDataMain(communityData);
    } catch (error) {
      console.error("Error fetching community data:", error);
    }
  };

  useEffect(() => {
    if (id) fetchCommunityData(id);
  }, [id]);

  // ---------------------------
  // FETCH COMMUNITY VIDEOS
  // ---------------------------
  const fetchVideos = async ({ pageParam = 0 }) => {
    const LIMIT = 200;
    let url;

    if (trend) {
      // 🔥 Trending feed
        url = `${FEED_URL}/apiv2/feeds/community/${id}/trending?limit=${LIMIT}`;
      
    } else {
      // 🆕 New feed
        url = `${FEED_URL}/apiv2/feeds/community/${id}/new?limit=${LIMIT}`;

    }

    const res = await axios.get(url);
    // /more returns { trends: [...] }, main endpoint returns array
    return res.data.trends || res.data;
  };

  const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isError,
} = useInfiniteQuery({
  queryKey: ["communityFeed", id, trend],
  queryFn: fetchVideos,
  getNextPageParam: (lastPage, allPages) => {
    // 🧠 Stop fetching if we already got one batch (no real pagination)
    if (!lastPage || lastPage.length === 0) return undefined;

    // If the server returns less than 200 (LIMIT), assume it's the end
    if (lastPage.length < 200) return undefined;

    // Otherwise, stop after first page since API doesn’t support skip
    if (allPages.length >= 1) return undefined;

    return 1; // optional — but we stop anyway
  },
});


  // Infinite scroll
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
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const videos = data?.pages.flat() || [];

  return (
    <div className="community-page-wrap">
      <div className="com-profile-img-wrap">
        <img src={`https://images.hive.blog/u/${id}/cover`} alt="" />
        <div className="wrap">
          <img src={`https://images.hive.blog/u/${id}/avatar`} alt="" />
          <span>{dataMain?.title || id}</span>
        </div>
      </div>

      <div className="title-wrap">
        <h3>{dataMain?.about}</h3>
        <p>{dataMain?.description}</p>
      </div>

      <hr />

      {/* Trend / New Switch */}
      <div className="search-tren-wrapper">
        {/* <div className="search-wrapper">
          <input type="text" placeholder="Search communities..." />
        </div> */}
        <div className="trend-btn-wrap">
          <span
            className={trend ? "active" : ""}
            onClick={() => setTrend(true)}
          >
            Trend
          </span>
          <span
            className={!trend ? "active" : ""}
            onClick={() => setTrend(false)}
          >
            New
          </span>
        </div>
      </div>

      {/* Feed Display */}
      {isLoading ? (
        <CardSkeleton />
      ) : isError ? (
        <p>Error fetching videos</p>
      ) : (
        <Card3 videos={videos} loading={isFetchingNextPage} />
      )}

      {isFetchingNextPage && <p style={{ textAlign: "center" }}>Loading more...</p>}
    </div>
  );
}

export default CommunityPage;
