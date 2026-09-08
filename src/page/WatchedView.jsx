import { useState, useCallback, useMemo } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { MdHistory, MdDelete } from 'react-icons/md';
import { IoArrowBack } from 'react-icons/io5';
import BarLoader from '../components/Loader/BarLoader';
import Card3 from '../components/Cards/Card3';
import icon from '../../public/images/stack.png';
import { useAppStore } from '../lib/store';
import { getWatchHistory, getWatchHistoryCount, deleteWatchHistoryEntry } from '../utils/watchHistory';
import { HIVE_API_URL, SHORTS_MAX_DURATION_SEC } from '../utils/config';
import { toastIn } from '../utils/toast';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { getSinceTimestamp, formatRelativeDate } from '../utils/dateFilters';
import { findShortByEmbedUrl } from '../hive-api/hiveApi';
import { FeedToolbar, Pagination } from '../components/FeedToolbar/FeedToolbar';
import './WatchedView.scss';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

async function fetchVideosFromHistory(items) {
  if (!items?.length) return [];

  const videoPromises = items.map(async (item) => {
    try {
      const response = await axios.post(getHiveUrl(), {
        jsonrpc: '2.0',
        method: 'condenser_api.get_content',
        params: [item.author, item.permlink],
        id: 1,
      });

      const post = response.data?.result;
      if (!post || !post.author) return null;

      let metadata = {};
      try {
        metadata = typeof post.json_metadata === 'string'
          ? JSON.parse(post.json_metadata)
          : post.json_metadata || {};
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }

      let thumbnail = null;
      if (metadata.image?.[0]) {
        thumbnail = metadata.image[0];
      }

      const duration = metadata.video?.info?.duration || 0;

      const isShort = item.short === true
        || (metadata.tags || []).includes('shorts')
        || (!!metadata.video?.platform && duration > 0 && duration <= SHORTS_MAX_DURATION_SEC);

      let embedPermlink = null;
      if (isShort) {
        try {
          const shortEntry = await findShortByEmbedUrl(post.author, post.permlink);
          if (shortEntry) {
            embedPermlink = shortEntry.permlink;
          }
        } catch (e) {
          console.error('Failed to look up short embed permlink:', e);
        }
      }

      return {
        author: post.author,
        permlink: embedPermlink || post.permlink,
        title: post.title,
        created_at: post.created,
        images: { thumbnail },
        duration,
        isShort,
        watched_at: item.last_watched_at || item.watched_at,
        watch_count: item.watch_count || 1,
      };
    } catch (error) {
      console.error(`Error fetching video ${item.author}/${item.permlink}:`, error);
      return null;
    }
  });

  const videos = await Promise.all(videoPromises);
  return videos.filter(Boolean);
}

const LIMIT = 20;



function WatchedView() {
  const { username } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: authenticatedUser, watchHistoryEnabled, setWatchHistoryEnabled } = useAppStore();
  const [deletedKeys, setDeletedKeys] = useState(new Set());
  const [activeTab, setActiveTab] = useState('videos');
  const [videosPage, setVideosPage] = useState(1);
  const [shortsPage, setShortsPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('all');

  const isOwner = authenticatedUser && username?.toLowerCase() === authenticatedUser.toLowerCase();

  const since = useMemo(() => getSinceTimestamp(dateFilter), [dateFilter]);

  const apiType = activeTab === 'shorts' ? 'shorts' : 'videos';
  const currentPage = activeTab === 'shorts' ? shortsPage : videosPage;
  const setCurrentPage = activeTab === 'shorts' ? setShortsPage : setVideosPage;

  const handleDateFilterChange = useCallback((key) => {
    setDateFilter(key);
    setVideosPage(1);
    setShortsPage(1);
  }, []);

  const { data: videosCount = 0 } = useQuery({
    queryKey: ['watchedVideosCount', username, 'videos', since],
    queryFn: () => getWatchHistoryCount(username, 'videos', since),
    enabled: !!username,
    staleTime: 60 * 1000,
  });

  const { data: shortsCount = 0 } = useQuery({
    queryKey: ['watchedVideosCount', username, 'shorts', since],
    queryFn: () => getWatchHistoryCount(username, 'shorts', since),
    enabled: !!username,
    staleTime: 60 * 1000,
  });

  const currentCount = activeTab === 'shorts' ? shortsCount : videosCount;
  const totalPages = Math.max(1, Math.ceil(currentCount / LIMIT));
  const offset = (currentPage - 1) * LIMIT;

  const { data: items = [], isLoading, isFetching, isError } = useQuery({
    queryKey: ['watchedVideos', username, apiType, currentPage, since],
    queryFn: async () => {
      const historyItems = await getWatchHistory(username, LIMIT, offset, apiType, since);
      return fetchVideosFromHistory(historyItems);
    },
    enabled: !!username,
    staleTime: 60 * 1000,
  });

  const filtered = items.filter(v => !deletedKeys.has(`${v.author}/${v.permlink}`));

  const handleDelete = useCallback(async (e, author, permlink) => {
    e.preventDefault();
    e.stopPropagation();

    const success = await deleteWatchHistoryEntry(username, author, permlink);
    if (success) {
      setDeletedKeys(prev => new Set(prev).add(`${author}/${permlink}`));
      queryClient.invalidateQueries({ queryKey: ['watchedVideosCount'] });
      toast.success('Removed from watch history');
    } else {
      toast.error('Failed to remove from watch history');
    }
  }, [username, queryClient]);

  return (
    <div className="watched-view-container">
      {/* Header */}
      <div className="watched-header">
        <div className="watched-info">
          <div className="watched-icon-wrap">
            <MdHistory className="watched-icon" />
          </div>
          <div className="watched-details">
            <h1>Watched</h1>
            <div className="watched-meta">
              <Link to={`/p/${username}`} className="owner">
                @{username}
              </Link>
              <span className="separator">-</span>
              <span>{videosCount + shortsCount} watched</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {isOwner && (
            <label className="tracking-toggle">
              <input
                type="checkbox"
                checked={watchHistoryEnabled}
                onChange={(e) => setWatchHistoryEnabled(e.target.checked)}
              />
              <span>Track history</span>
            </label>
          )}
          <button type="button" className="back-btn" onClick={() => navigate(-1)}>
            <IoArrowBack /> Back
          </button>
        </div>
      </div>

      {/* Tabs + Date filter + Pagination */}
      <FeedToolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        dateFilter={dateFilter}
        onDateFilterChange={handleDateFilterChange}
        tabs={[
          { key: 'videos', label: `Videos (${videosCount})` },
          { key: 'shorts', label: `Shorts (${shortsCount})` },
        ]}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      {/* Content */}
      <div className="watched-content">
        {(isLoading || isFetching) ? (
          <div className="loading-more"><BarLoader /></div>
        ) : isError ? (
          <div className="empty-wrap">
            <span>Failed to load watch history. Please try again.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-wrap">
            <img src={icon} alt="" />
            <span>No watched {activeTab === 'shorts' ? 'shorts' : 'videos'} yet</span>
          </div>
        ) : activeTab === 'shorts' ? (
          <div className="watched-shorts-grid">
            <Card3
              videos={filtered}
              linkPrefix="/shorts"
              shortsGrid
            />
          </div>
        ) : (
          <div className="watched-videos-grid">
            {filtered.map((video) => (
              <Link
                key={`${video.author}-${video.permlink}`}
                to={`/watch?v=${video.author}/${video.permlink}`}
                className="watched-video-card"
              >
                <div className="video-thumbnail">
                  <img src={fixVideoThumbnail(video)} alt={video.title} onError={(e) => (e.currentTarget.src = fallbackImg)} />
                  {video.duration > 0 && (
                    <span className="duration">
                      {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
                    </span>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      className="delete-btn"
                      onClick={(e) => handleDelete(e, video.author, video.permlink)}
                      title="Remove from watch history"
                    >
                      <MdDelete />
                    </button>
                  )}
                </div>
                <div className="video-meta">
                  <h3>{video.title}</h3>
                  <p className="video-author">@{video.author}</p>
                  <p className="watched-date">Watched {formatRelativeDate(video.watched_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="watched-pagination-bottom">
          <Pagination page={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      )}
    </div>
  );
}

export default WatchedView;
