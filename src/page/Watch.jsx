import React, { useState, useMemo, useEffect, useCallback } from 'react';
import './Watch.scss';
import PlayVideo from '../components/playVideo/PlayVideo';
import Recommended from '../components/recommended/Recommended';
import { useSearchParams } from 'react-router-dom';
import { GET_RELATED, GET_VIDEO_DETAILS, TRENDING_FEED, GET_AUTHOR_VIDEOS } from '../graphql/queries';
import { useQuery } from '@apollo/client';
import BarLoader from '../components/Loader/BarLoader';

// Number of author videos to show at the top of recommendations
const AUTHOR_VIDEOS_COUNT = 4;

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

  // Send command to the player iframe
  const sendPlayerCommand = useCallback((command) => {
    const iframe = document.querySelector('.video-iframe-wrapper iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: command }, '*');
    }
  }, []);

  const triggerPlay = useCallback(() => {
    sendPlayerCommand('play');
  }, [sendPlayerCommand]);

  // Listen for player ready message and auto-play
  useEffect(() => {
    const handleMessage = (event) => {
      // Handle player-ready for auto-play
      if (event.data && event.data.type === '3speak-player-ready') {
        // Small delay to ensure player is fully ready
        setTimeout(() => {
          triggerPlay();
        }, 100);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [triggerPlay]);

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

  // Fetch videos from the same author
  const { data: authorVideosData, loading: authorVideosLoading } = useQuery(GET_AUTHOR_VIDEOS, {
    variables: { id: author },
    skip: !author || author === 'unknown',
  });

  // Smart recommendation logic:
  // 1. Show up to 4 videos from the same author first
  // 2. Then show related/recommended videos
  // 3. Fall back to trending if not enough related videos
  // 4. Exclude the current video from all lists
  const suggestedVideos = useMemo(() => {
    const authorItems = authorVideosData?.socialFeed?.items || [];
    const relatedItems = suggestionsData?.relatedFeed?.items || [];
    const trendingItems = trendingData?.trendingFeed?.items || [];
    
    // Track permlinks to avoid duplicates
    const usedPermlinks = new Set();
    usedPermlinks.add(permlink); // Exclude current video
    
    // 1. Get up to AUTHOR_VIDEOS_COUNT valid videos from the same author
    const authorVideos = filterValidVideos(authorItems)
      .filter(v => {
        if (usedPermlinks.has(v.permlink)) return false;
        usedPermlinks.add(v.permlink);
        return true;
      })
      .slice(0, AUTHOR_VIDEOS_COUNT);
    
    // 2. Get related/recommended videos (excluding author's videos and current)
    let recommendations = filterValidVideos(relatedItems)
      .filter(v => {
        if (usedPermlinks.has(v.permlink)) return false;
        usedPermlinks.add(v.permlink);
        return true;
      });
    
    // 3. If not enough related videos, supplement with trending
    if (recommendations.length < 5) {
      const validTrending = filterValidVideos(trendingItems);
      for (const video of validTrending) {
        if (!usedPermlinks.has(video.permlink) && recommendations.length < 16) {
          recommendations.push(video);
          usedPermlinks.add(video.permlink);
        }
      }
    }
    
    // Combine: author videos first, then recommendations
    return [...authorVideos, ...recommendations];
  }, [authorVideosData, suggestionsData, trendingData, author, permlink]);
  
  const isNetworkError = videoError && videoError.networkError;
  const isLoading = videoLoading || (suggestionsLoading && trendingLoading && authorVideosLoading);

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
