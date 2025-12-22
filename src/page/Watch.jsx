import React, { useState, useMemo } from 'react';
import './Watch.scss';
import PlayVideo from '../components/playVideo/PlayVideo';
import Recommended from '../components/recommended/Recommended';
import { useSearchParams } from 'react-router-dom';
import { GET_RELATED, GET_VIDEO_DETAILS, TRENDING_FEED } from '../graphql/queries';
import { useQuery } from '@apollo/client';
import BarLoader from '../components/Loader/BarLoader';

// Filter out videos older than December 2023 (old videos may not exist on CDN)
const MIN_VIDEO_DATE = new Date('2023-12-01T00:00:00.000Z');

function filterValidVideos(videos) {
  if (!videos || !Array.isArray(videos)) return [];
  return videos.filter(video => {
    // Must have created_at date
    if (!video?.created_at) return false;
    
    // Filter out old videos
    const videoDate = new Date(video.created_at);
    if (videoDate < MIN_VIDEO_DATE) return false;
    
    // Filter out videos without a valid play_url (likely deleted)
    if (!video?.spkvideo?.play_url) return false;
    
    return true;
  });
}

function Watch() {
  const [searchParams] = useSearchParams();
  const v = searchParams.get('v'); // Extract the "v" query parameter
  const [author, permlink] = (v ?? 'unknown/unknown').split('/');

  const { data: videoData, loading: videoLoading, error: videoError } = useQuery(GET_VIDEO_DETAILS, {
    variables: { author, permlink },
  });

  const videoDetails = videoData?.socialPost;

  // Fetch related videos
  const { data: suggestionsData, loading: suggestionsLoading } = useQuery(GET_RELATED, {
    variables: { author, permlink },
  });

  // Fetch trending as fallback
  const { data: trendingData, loading: trendingLoading } = useQuery(TRENDING_FEED);

  // Smart recommendation logic:
  // 1. Filter out old/deleted videos from related feed
  // 2. If no valid related videos, use trending feed (also filtered)
  // 3. Exclude the current video from recommendations
  const suggestedVideos = useMemo(() => {
    const relatedItems = suggestionsData?.relatedFeed?.items || [];
    const trendingItems = trendingData?.trendingFeed?.items || [];
    
    // Filter valid videos from related feed
    let recommendations = filterValidVideos(relatedItems);
    
    // If related feed has less than 5 valid videos, supplement with trending
    if (recommendations.length < 5) {
      const validTrending = filterValidVideos(trendingItems);
      const existingPermlinks = new Set(recommendations.map(v => v.permlink));
      
      for (const video of validTrending) {
        if (!existingPermlinks.has(video.permlink) && recommendations.length < 20) {
          recommendations.push(video);
          existingPermlinks.add(video.permlink);
        }
      }
    }
    
    // Exclude the current video
    recommendations = recommendations.filter(
      v => !(v.author?.username === author && v.permlink === permlink)
    );
    
    return recommendations;
  }, [suggestionsData, trendingData, author, permlink]);
  
  const isNetworkError = videoError && videoError.networkError;
  const isLoading = videoLoading || (suggestionsLoading && trendingLoading);

  if (isLoading) {
    return <BarLoader />;
  }

  if (videoError) {
    return <div>Error loading data. Please try again.</div>;
  }

  if (isNetworkError) {
    return <div>network error</div>;
  }

  return (
    <div className="play-container">
      <PlayVideo videoDetails={videoDetails} author={author} permlink={permlink} />

      {suggestedVideos.length > 0 && (
        <Recommended suggestedVideos={suggestedVideos} />
      )}
    </div>
  );
}

export default Watch;
