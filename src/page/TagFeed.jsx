
import { useEffect, useState } from 'react';
import CardSkeleton from '../components/Cards/CardSkeleton';
import { useQuery } from '@apollo/client';
import { GET_TRENDING_TAGS } from '../graphql/queries';
import Cards from '../components/Cards/Cards'
import { useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { useInfiniteQuery } from '@tanstack/react-query';
import Card3 from '../components/Cards/Card3';
// import './App.css';

function TagFeed() {
    const { tag } = useParams(); 
    const {state} = useLocation()
    // const { loading, error, data } = useQuery(GET_TRENDING_TAGS, {
    //     variables: { tag },
    // });
    // const videos = data?.trendingFeed?.items || [];
    // console.log(videos)


    useEffect(()=>{
      fetchVideos()
    },[])

      // ---------------------------
  // FETCH COMMUNITY VIDEOS
  // ---------------------------
  const fetchVideos = async () => {
    const LIMIT = 200;
    let url;
    const trend = false

    if (trend) {
      // 🔥 Trending feed
        url = `https://3speak.tv/apiv2/feeds/community/${tag}/trending?limit=${LIMIT}`;
      
    } else {
      // 🆕 New feed
        url = `https://3speak.tv/apiv2/feeds/community/${tag}/new?limit=${LIMIT}`;

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
  isLoading : loading,
  isError,
} = useInfiniteQuery({
  queryKey: ["homeCommunityFeed"],
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
  console.log(videos)

  return (
    <div className='firstupload-container'>
            {/* <div className='headers'>{state.commuintyName}</div> */}
            { loading ? <CardSkeleton /> :<Card3 videos={videos}
             error={isError ? "Failed to load videos" : ""}
            loading={isFetchingNextPage}
    
          // error={isError} 
          className="custom-video-feed" />}
    
    
        </div>
  );
}

export default TagFeed;