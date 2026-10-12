import { useState, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MdHistory, MdDelete } from 'react-icons/md';
import { IoArrowBack } from 'react-icons/io5';
import BarLoader from '../components/Loader/BarLoader';
import Card3 from '../components/Cards/Card3';
import icon from '../../public/images/stack.png';
import { useAppStore } from '../lib/store';
import { deleteWatchHistoryEntry } from '../utils/watchHistory';
import { CHECKER_URL } from '../utils/config';
import { fetchIncubationPost } from '../lib/incubation';
import { toastIn } from '../utils/toast';
import { getSinceTimestamp, formatRelativeDate } from '../utils/dateFilters';
import { FeedToolbar, Pagination } from '../components/FeedToolbar/FeedToolbar';
import { useTranslation } from 'react-i18next';
import './WatchedView.scss';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

const LIMIT = 20;

/**
 * One page of the history as main-feed cards, with both tab counts.
 *
 * The checker resolves the whole page against our own video collections in one
 * request. This page used to resolve each entry against Hive itself (one
 * get_content per card, plus a lookup per short), which is why it took so long,
 * and the history API it read ignored the date and type filters.
 *
 * A regular video with no Hive post comes back `_unlinked` and without a title:
 * those are warm-up users' videos, whose post lives off-chain. Looked up here and
 * badged like they are on the main feed; one that is not found there either is
 * dropped, as such entries always were.
 */
async function fetchWatchedPage(username, type, since, page) {
  const params = new URLSearchParams({ type, page: String(page), limit: String(LIMIT) });
  if (since) params.set('since', String(since));
  const res = await fetch(`${CHECKER_URL}/feeds/watched/${encodeURIComponent(username)}?${params}`);
  if (!res.ok) throw new Error(`watched feed ${res.status}`);
  const data = await res.json();
  const videos = await Promise.all((data.videos || []).map(async (v) => {
    if (!v._unlinked) return v;
    try {
      const post = (await fetchIncubationPost(v.author, v.permlink))?.post;
      return post?.title ? { ...v, title: post.title, _incubation: true } : null;
    } catch {
      return null;
    }
  }));
  return {
    videos: videos.filter(Boolean),
    counts: data.counts || { videos: 0, shorts: 0 },
    totalPages: data.totalPages || 1,
  };
}

function WatchedView() {
  const { t } = useTranslation();
  const { username } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: authenticatedUser, watchHistoryEnabled, setWatchHistoryEnabled } = useAppStore();
  // History is keyed by name, and an incubating viewer's name is their handle.
  // Without this they could open their own history but not own it: no delete,
  // no toggle, because isOwner compared against a Hive username they lack.
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [deletedKeys, setDeletedKeys] = useState(new Set());
  const [activeTab, setActiveTab] = useState('videos');
  const [videosPage, setVideosPage] = useState(1);
  const [shortsPage, setShortsPage] = useState(1);
  // Today first: a long history is slow to page through, and what someone
  // usually wants back is something they watched today.
  const [dateFilter, setDateFilter] = useState('today');

  const me = authenticatedUser || incubationHandle;
  const isOwner = me && username?.toLowerCase() === me.toLowerCase();

  const since = useMemo(() => getSinceTimestamp(dateFilter), [dateFilter]);

  const apiType = activeTab === 'shorts' ? 'shorts' : 'videos';
  const currentPage = activeTab === 'shorts' ? shortsPage : videosPage;
  const setCurrentPage = activeTab === 'shorts' ? setShortsPage : setVideosPage;

  const handleDateFilterChange = useCallback((key) => {
    setDateFilter(key);
    setVideosPage(1);
    setShortsPage(1);
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['watchedFeed', username, apiType, currentPage, since],
    queryFn: () => fetchWatchedPage(username, apiType, since, currentPage),
    enabled: !!username,
    staleTime: 60 * 1000,
  });
  const videosCount = data?.counts.videos ?? 0;
  const shortsCount = data?.counts.shorts ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const filtered = useMemo(
    () => (data?.videos || []).filter((v) => !deletedKeys.has(v._historyKey)),
    [data, deletedKeys],
  );

  // History rows are keyed by what the player recorded, which is not always the
  // card's own author/permlink (Hive permlink vs asset id), so delete by that key.
  const handleDelete = useCallback(async (e, historyKey) => {
    e.preventDefault();
    e.stopPropagation();

    const [author, permlink] = historyKey.split('/');
    const success = await deleteWatchHistoryEntry(username, author, permlink);
    if (success) {
      setDeletedKeys(prev => new Set(prev).add(historyKey));
      queryClient.invalidateQueries({ queryKey: ['watchedFeed', username] });
      toast.success(t('misc.watched.removed'));
    } else {
      toast.error(t('misc.watched.removeFailed'));
    }
  }, [username, queryClient, t]);

  const renderFooter = useCallback((video) => (
    <div className="watched-card-footer">
      <span className="watched-date">{t('misc.watched.watchedAt', { when: formatRelativeDate(video.watched_at) })}</span>
      {isOwner && (
        <button
          type="button"
          className="watched-remove-btn"
          onClick={(e) => handleDelete(e, video._historyKey)}
          title={t('misc.watched.removeTitle')}
          aria-label={t('misc.watched.removeTitle')}
        >
          <MdDelete />
        </button>
      )}
    </div>
  ), [isOwner, handleDelete, t]);

  return (
    <div className="watched-view-container">
      {/* Header */}
      <div className="watched-header">
        <div className="watched-info">
          <div className="watched-icon-wrap">
            <MdHistory className="watched-icon" />
          </div>
          <div className="watched-details">
            <h1>{t('misc.watched.title')}</h1>
            <div className="watched-meta">
              <Link to={`/p/${username}`} className="owner">
                @{username}
              </Link>
              <span className="separator">-</span>
              <span>{t('misc.watched.count', { count: videosCount + shortsCount })}</span>
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
              <span>{t('misc.watched.trackHistory')}</span>
            </label>
          )}
          <button type="button" className="back-btn" onClick={() => navigate(-1)}>
            <IoArrowBack /> {t('common.actions.back')}
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
          { key: 'videos', label: t('misc.watched.videosTab', { count: videosCount }) },
          { key: 'shorts', label: t('misc.watched.shortsTab', { count: shortsCount }) },
        ]}
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      {/* Content */}
      <div className="watched-content">
        {isLoading ? (
          <div className="loading-more"><BarLoader /></div>
        ) : isError ? (
          <div className="empty-wrap">
            <span>{t('misc.watched.loadFailed')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-wrap">
            <img src={icon} alt="" />
            <span>{activeTab === 'shorts' ? t('misc.watched.emptyShorts') : t('misc.watched.emptyVideos')}</span>
          </div>
        ) : activeTab === 'shorts' ? (
          <div className="watched-shorts-grid">
            <Card3
              videos={filtered}
              linkPrefix="/shorts"
              shortsGrid
              renderFooter={renderFooter}
            />
          </div>
        ) : (
          <div className="watched-videos-grid">
            {/* The main feed's card, so history looks and behaves like every feed. */}
            <Card3 videos={filtered} renderFooter={renderFooter} />
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
