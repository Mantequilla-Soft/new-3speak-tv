import React, { useEffect, useState } from 'react';
import axios from 'axios';
import "./DraftStudio.scss";
import FilterBar from '../Draft/FilterBar';
import VideoCard from '../Draft/VideoCard';
import { useNavigate } from 'react-router-dom';
import BarLoader from '../Loader/BarLoader';
import { useAppStore } from '../../lib/store';
import { useInfiniteQuery } from '@tanstack/react-query';

const DraftStudio = () => {
  const { user, authenticated } = useAppStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const pageSize = 20;

  /* ===============================
       VIDEO FEED (INFINITE SCROLL)
    =============================== */
  const fetchVideos = async ({ pageParam = 0, queryKey }) => {
    const [, user, filter] = queryKey;

    const status =
      filter === 'all'
        ? 'all'
        : filter === 'failed'
        ? 'publish_manual'
        : filter;

    try {
      const res = await axios.get('https://views.3speak.tv/api/my-videos', {
        params: {
          username: user,
          limit: pageSize,
          offset: pageParam * pageSize,
          status,
          sort: 'newest',
        },
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const videos = res.data?.data?.videos || [];
      return videos.filter(video => video.status !== 'uploaded');
    } catch (error) {
      console.error('Failed to fetch videos:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['ProfilePage', user, filter],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length,
    enabled: !!user,
  });

  const videos = data?.pages.flat() || [];

  /* ===============================
       SCROLL HANDLER
    =============================== */
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

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
  };

  const handleEdit = (video) => {
    navigate(`/editvideo/${video._id}`, { state: { video } });
  };

  if (loading || isLoading) return <div><BarLoader /></div>;

  return (
    <div>
      <FilterBar onFilterChange={handleFilterChange} activeFilter={filter} />

      {videos.length === 0 ? (
        <div className="no-videos fade-in">
          <p>No videos found with the selected filter.</p>
        </div>
      ) : (
        <div className="video-grid">
          {videos.map(video => (
            <VideoCard
              key={video._id}
              video={video}
              onEdit={() => handleEdit(video)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DraftStudio;
