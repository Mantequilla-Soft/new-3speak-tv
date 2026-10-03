import React, { useEffect, useState } from 'react';
import axios from 'axios';
import "./DraftStudio.scss";
import FilterBar from '../Draft/FilterBar';
import VideoCard from '../Draft/VideoCard';
import { useNavigate } from 'react-router-dom';
import BarLoader from '../Loader/BarLoader';
import { useAppStore } from '../../lib/store';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { MY_VIDEOS_URL } from '../../utils/config';
import { useTranslation } from 'react-i18next';

const CHECKER_BASE =
  import.meta.env.VITE_SCHEDULED_POSTS_API_URL || 'https://prod-checker.okinoko.io';

// Map a scheduled-posts doc (from the checker) into the shape VideoCard expects.
// VideoCard already has built-in handling for status='scheduled' + publish_data.
function normalizeScheduledDoc(doc, untitledLabel) {
  return {
    _id: `scheduled:${doc.id}`,         // unique React key, distinct from my-videos _ids
    id: doc.id,
    permlink: doc.permlink,
    owner: doc.owner,
    title: doc.title || untitledLabel,
    description: doc.description || '',
    thumbnail: doc.thumbnail || null,
    status: 'scheduled',
    publish_data: doc.scheduledOn,       // VideoCard reads this for "Publishes …"
    created_at: doc.createdAt,
    _scheduled: true,                    // local marker so handleEdit can branch
  };
}

const DraftStudio = () => {
  const { t } = useTranslation();
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
      const res = await axios.get(`${MY_VIDEOS_URL}/api/my-videos`, {
        params: {
          username: user,
          limit: pageSize,
          offset: pageParam * pageSize,
          status,
          sort: 'newest',
          include_unlisted: 1, // owner's manage view: include unlisted so they can be edited/re-listed
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

  /* ===============================
       SCHEDULED-POSTS FEED
       (separate source: prod-checker /scheduled-posts)
    =============================== */
  const { data: scheduledData } = useQuery({
    queryKey: ['scheduled-posts', user],
    queryFn: async () => {
      const res = await axios.get(
        `${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/${encodeURIComponent(user)}`,
        { params: { status: 'scheduled', limit: 100 } },
      );
      return Array.isArray(res.data?.scheduled_posts) ? res.data.scheduled_posts : [];
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const scheduledItems = (scheduledData || []).map((doc) => normalizeScheduledDoc(doc, t('studio.drafts.untitled')));
  const publishedItems = data?.pages.flat() || [];

  // Filter visibility for scheduled items: show on "all" + "scheduled" tabs;
  // hide on "published" / "publish_manual" (failed). VideoCard's own check
  // already shows the publish-date label.
  const showScheduled = filter === 'all' || filter === 'scheduled';
  const filteredScheduled = showScheduled ? scheduledItems : [];

  // Render order: scheduled posts first (sorted by upcoming time), then the
  // regular published/failed list as the upstream API ordered it.
  const videos = [
    ...filteredScheduled.slice().sort((a, b) =>
      new Date(a.publish_data || 0) - new Date(b.publish_data || 0),
    ),
    ...publishedItems,
  ];

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
    // Scheduled posts go to a different editor (Mongo-backed) than published
    // ones (Hive comment-update).
    if (video._scheduled) {
      navigate(`/edit-scheduled/${encodeURIComponent(video.permlink)}`);
    } else {
      navigate(`/editvideo/${video._id}`, { state: { video } });
    }
  };

  if (loading || isLoading) return <div><BarLoader /></div>;

  return (
    <div>
      <FilterBar onFilterChange={handleFilterChange} activeFilter={filter} />

      {videos.length === 0 ? (
        <div className="no-videos fade-in">
          <p>{t('studio.drafts.empty')}</p>
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
