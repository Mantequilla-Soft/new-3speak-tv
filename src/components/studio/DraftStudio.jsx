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
import { fetchCreatorOverview, fetchCreatorFollows, fetchCreatorTimeseries, fmtDuration, fmtCount } from '../../lib/creatorStats';
import { Button, EmptyState } from '../v2/ui';
import mark from '../../assets/image/3S_mark.svg';

// Hive makes a block every 3 seconds: 28 days of blocks.
const BLOCKS_28D = 28 * 24 * 1200;

// "+12%" against the 28 days before; null when there is nothing to compare.
function pctDelta(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)}%`;
}

// How many of the studio's rows each filter tab holds (the my-videos API's own
// count, read with limit=1). Scheduled posts also come from the checker list.
async function fetchStatusCounts(user) {
  const one = (status) => axios.get(`${MY_VIDEOS_URL}/api/my-videos`, {
    params: { username: user, limit: 1, offset: 0, status, include_unlisted: 1 },
  }).then((r) => Number(r.data?.data?.total) || 0);
  const [all, uploaded, published, scheduled, failed] = await Promise.all(
    ['all', 'uploaded', 'published', 'scheduled', 'publish_manual'].map(one),
  );
  return { all: Math.max(0, all - uploaded), published, scheduled, publish_manual: failed };
}

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
      // my-videos rows carry `video_id`; older API shapes had `_id`.
      navigate(`/editvideo/${encodeURIComponent(video._id || video.video_id || video.permlink)}`, { state: { video } });
    }
  };

  // Last 28 days at a glance (21d): the same overview the Analytics tab reads,
  // plus the 28 days before it for the change chip. Shown as "–" until it
  // answers (or when it can't), so the row never jumps.
  const { data: overview } = useQuery({
    queryKey: ['studio-overview', user],
    queryFn: () => fetchCreatorOverview(user, { days: 28 }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // The daily series covers the 28 days before as well (the overview only
  // knows fixed windows), for the views and watch time change chips.
  const { data: series } = useQuery({
    queryKey: ['studio-series', user],
    queryFn: () => fetchCreatorTimeseries(user, { days: 90 }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: follows } = useQuery({
    queryKey: ['studio-follows', user],
    queryFn: () => fetchCreatorFollows(user, { days: 365 }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: counts } = useQuery({
    queryKey: ['studio-counts', user],
    queryFn: () => fetchStatusCounts(user),
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: false,
  });

  const totals = overview?.totals || null;
  const prev = (key) => {
    const days = Array.isArray(series?.series) ? series.series : [];
    if (days.length < 56) return NaN;
    return days.slice(-56, -28).reduce((sum, d) => sum + (Number(d[key]) || 0), 0);
  };
  const newFollowers = (() => {
    const head = Number(follows?.headBlock);
    if (!follows || !Number.isFinite(head)) return null;
    const list = Array.isArray(follows.followers) ? follows.followers : [];
    const cur = list.filter((f) => f.block > head - BLOCKS_28D).length;
    const before = list.filter((f) => f.block <= head - BLOCKS_28D && f.block > head - 2 * BLOCKS_28D).length;
    return { cur, before };
  })();
  const dash = '–';
  const tiles = [
    { key: 'views', label: t('studio.drafts.views28'), value: totals ? fmtCount(totals.sessions || 0) : dash, delta: totals ? pctDelta(totals.sessions || 0, prev('views')) : null },
    { key: 'followers', label: t('studio.drafts.newFollowers'), value: newFollowers ? `+${fmtCount(newFollowers.cur)}` : dash, delta: newFollowers ? pctDelta(newFollowers.cur, newFollowers.before) : null },
    { key: 'watch', label: t('stats.metrics.watchTime'), value: totals ? fmtDuration(totals.watchSeconds || 0) : dash, delta: totals ? pctDelta(totals.watchSeconds || 0, prev('watchSeconds')) : null },
    { key: 'comments', label: t('stats.metrics.comments'), value: totals ? fmtCount(totals.comments || 0) : dash, delta: null },
  ];
  // Views per video over the same 28 days (rows show "–" until this answers).
  const viewsByPermlink = (() => {
    if (!overview) return null;
    const m = new Map();
    for (const v of overview.videos || []) m.set(v.hivePermlink || v.permlink, v.sessions || 0);
    return m;
  })();
  const scheduledCount = (counts?.scheduled || 0) + scheduledItems.length;
  const filterCounts = counts
    ? { all: counts.all + scheduledItems.length, published: counts.published, scheduled: scheduledCount, publish_manual: counts.publish_manual }
    : (scheduledItems.length ? { scheduled: scheduledItems.length } : undefined);

  const openStats = () => navigate('/profile?tab=stats');
  const listLoading = loading || isLoading;

  return (
    <div className="studio">
      <header className="studio__head">
        <img className="studio__mark" src={mark} alt="" aria-hidden="true" />
        <h1 className="studio__title">{t('studio.drafts.title')}</h1>
        <Button as={Link} to="/studio" variant="primary" size={56} trailing="add" className="studio__create">
          {t('studio.drafts.create')}
        </Button>
      </header>

      <div className="studio__tiles">
        {tiles.map((tile) => (
          <button type="button" key={tile.key} className="studio-tile" onClick={openStats}>
            <span className="studio-tile__label">{tile.label}</span>
            <b className="studio-tile__value">{tile.value}</b>
            <span className={`studio-tile__delta${tile.delta ? '' : ' is-empty'}${tile.delta?.startsWith('−') ? ' is-down' : ''}`}>
              {tile.delta || t('stats.ranges.d28')}
            </span>
          </button>
        ))}
      </div>

      <FilterBar
        onFilterChange={handleFilterChange}
        activeFilter={filter}
        counts={filterCounts}
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
              views={viewsByPermlink ? (viewsByPermlink.get(video.permlink) || 0) : null}
            />
          ))}
          {isFetchingNextPage && <div className="studio__ghost v2-skeleton" />}
        </div>
      )}
    </div>
  );
};

export default DraftStudio;
