import { useEffect, useState } from 'react';
import axios from 'axios';
import "./DraftStudio.scss";
import FilterBar from '../Draft/FilterBar';
import VideoCard from '../Draft/VideoCard';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { MY_VIDEOS_URL } from '../../utils/config';
import { useTranslation } from 'react-i18next';
import { fetchCreatorOverview, fmtDuration, fmtCount } from '../../lib/creatorStats';
import { Button, EmptyState } from '../v2/ui';

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
  const { user } = useAppStore();
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

  // Last 28 days at a glance (21d): the same overview the Analytics tab reads.
  // Shown as "-" until it answers (or when it can't), so the row never jumps.
  const { data: overview } = useQuery({
    queryKey: ['studio-overview', user],
    queryFn: () => fetchCreatorOverview(user, { days: 28 }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const totals = overview?.totals || null;
  const dash = '-';
  const tiles = [
    { key: 'views', label: t('stats.metrics.views'), value: totals ? fmtCount(totals.sessions || 0) : dash },
    { key: 'watch', label: t('stats.metrics.watchTime'), value: totals ? fmtDuration(totals.watchSeconds || 0) : dash },
    { key: 'votes', label: t('stats.metrics.votes'), value: totals ? fmtCount(totals.votes || 0) : dash },
    { key: 'comments', label: t('stats.metrics.comments'), value: totals ? fmtCount(totals.comments || 0) : dash },
  ];

  const openStats = () => navigate('/profile?tab=stats');
  const listLoading = loading || isLoading;

  return (
    <div className="studio">
      <header className="studio__head">
        <h1 className="studio__title">{t('studio.drafts.title')}</h1>
        <Button as={Link} to="/studio" variant="primary" size={56} trailing="add" className="studio__create">
          {t('studio.drafts.create')}
        </Button>
      </header>

      <div className="studio__tiles">
        {tiles.map((tile) => (
          <button type="button" key={tile.key} className="studio-tile" onClick={openStats}>
            <span className="studio-tile__label">{tile.label}</span>
            <b className="studio-tile__value num">{tile.value}</b>
            <span className="studio-tile__range num">{t('stats.ranges.d28')}</span>
          </button>
        ))}
      </div>

      <FilterBar
        onFilterChange={handleFilterChange}
        activeFilter={filter}
        counts={scheduledItems.length ? { scheduled: scheduledItems.length } : undefined}
      />

      {listLoading ? (
        <div className="studio__list" aria-busy="true">
          {[0, 1, 2, 3].map((k) => <div key={k} className="studio__ghost v2-skeleton" />)}
        </div>
      ) : videos.length === 0 ? (
        <EmptyState
          className="studio__empty"
          icon="video_library"
          title={t('studio.drafts.empty')}
          action={
            <Button as={Link} to="/studio" variant="secondary" icon="add">
              {t('studio.select.createNew')}
            </Button>
          }
        />
      ) : (
        <div className="studio__list">
          {videos.map(video => (
            <VideoCard
              key={video._id}
              video={video}
              onEdit={() => handleEdit(video)}
              onStats={openStats}
            />
          ))}
          {isFetchingNextPage && <div className="studio__ghost v2-skeleton" />}
        </div>
      )}
    </div>
  );
};

export default DraftStudio;
