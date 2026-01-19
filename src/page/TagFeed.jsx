import { useEffect, useState } from 'react';
import CardSkeleton from '../components/Cards/CardSkeleton';
import { useQuery } from '@apollo/client';
import { GET_TRENDING_TAGS } from '../graphql/queries';
import Cards from '../components/Cards/Cards';
import { useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { useInfiniteQuery } from '@tanstack/react-query';
import Card3 from '../components/Cards/Card3';
// import './App.css';

function TagFeed() {
  const { tag } = useParams(); 
  const { state } = useLocation();

  // ---------------------------
  // FETCH COMMUNITY VIDEOS
  // ---------------------------
  const fetchVideos = async ({ pageParam = 1 }) => {
    const LIMIT = 100;
    const trend = false;
    let url;

    if (trend) {
      // 🔥 Trending feed
      url = `http://144.48.107.2:5000/videos/tag/${tag}?page=${pageParam}&limit=${LIMIT}`;
    } else {
      // 🆕 New feed
      url = `http://144.48.107.2:5000/videos/tag/${tag}?page=${pageParam}&limit=${LIMIT}`;
    }

    const res = await axios.get(url);
    return res.data;
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: loading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['homeCommunityFeed', tag],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage) => {
      if (!lastPage) return undefined;
      if (lastPage.page >= lastPage.totalPages) return undefined;
      return lastPage.page + 1;
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

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const videos = data?.pages.flatMap(page => page.videos) || [];
  console.log(videos);

  return (
    <div className="firstupload-container">
      {/* <div className='headers'>{state.commuintyName}</div> */}

      {loading ? (
        <CardSkeleton />
      ) : (
        <Card3
          videos={videos}
          error={isError ? 'Failed to load videos' : ''}
          loading={isFetchingNextPage}
          className="custom-video-feed"
        />
      )}
    </div>
  );
}

export default TagFeed;
