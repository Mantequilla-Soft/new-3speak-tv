import { useState, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import BarLoader from '../components/Loader/BarLoader';
import { Button, IconButton, EmptyState, Toggle } from '../components/v2/ui';
import { useAppStore } from '../lib/store';
import { deleteWatchHistoryEntry } from '../utils/watchHistory';
import { CHECKER_URL } from '../utils/config';
import { fetchIncubationPost } from '../lib/incubation';
import { toastIn } from '../utils/toast';
import { getSinceTimestamp, formatRelativeDate } from '../utils/dateFilters';
import { FeedToolbar, Pagination } from '../components/FeedToolbar/FeedToolbar';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { watchPath } from '../utils/urls';
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
    // Only audio entries in the Audio tab, whatever a checker that predates the
    // tab sends back for `type=audio`.
    videos: videos.filter((v) => v && (type === 'audio') === !!v._audio),
    counts: { videos: 0, shorts: 0, audio: 0, ...(data.counts || {}) },
    totalPages: data.totalPages || 1,
  };
}

const authorOf = (v) => String(v.author?.username || v.author || v.owner || '').replace(/^@/, '');

/**
 * One history row (45c, 24d): the thumbnail, the title, "@author · Watched 2h
 * ago", and (own history) remove. A video opens its watch page, a short the
 * shorts player; an audio row plays through the global player like the audio
 * page's tile.
 */
function WatchedRow({ item, kind, contextItems, canRemove, onRemove }) {
  const { t } = useTranslation();
  const audioPlay = useAppStore((s) => s.audioPlay);
  const author = authorOf(item);
  const title = item.title || item.hive_title || item.permlink;
  const thumb = kind === 'audio'
    ? (item.thumbnail_url ? fixVideoThumbnail({ thumbnail_url: item.thumbnail_url }) : fallbackImg)
    : fixVideoThumbnail(item, kind === 'shorts');
  const when = t(item._audio ? 'misc.watched.listenedAt' : 'misc.watched.watchedAt', { when: formatRelativeDate(item.watched_at) });

  const body = (
    <>
      <span className={`watched-row__thumb${kind === 'shorts' ? ' is-short' : ''}`}>
        <img src={thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
      </span>
      <span className="watched-row__text">
        <b>{title}</b>
        <span>@{author} · {when}</span>
      </span>
    </>
  );

  const play = () => {
    // While something else plays, a click lines it up at the end of the queue.
    if (useAppStore.getState().audioQueueIfPlaying?.(item)) return;
    audioPlay(item, contextItems);
  };

  return (
    <li className="watched-row">
      {kind === 'audio' ? (
        <button type="button" className="watched-row__main" onClick={play}>{body}</button>
      ) : (
        <Link className="watched-row__main" to={kind === 'shorts' ? `/shorts?v=${author}/${item.permlink}` : watchPath(author, item.permlink)}>
          {body}
        </Link>
      )}
      {canRemove && (
        <IconButton
          className="watched-remove-btn"
          icon="close"
          size={32}
          variant="ghost"
          label={t('misc.watched.removeTitle')}
          onClick={(e) => onRemove(e, item._historyKey)}
        />
      )}
    </li>
  );
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
  const [audioPage, setAudioPage] = useState(1);
  // Today first: a long history is slow to page through, and what someone
  // usually wants back is something they watched today.
  const [dateFilter, setDateFilter] = useState('today');

  const me = authenticatedUser || incubationHandle;
  const isOwner = me && username?.toLowerCase() === me.toLowerCase();

  const since = useMemo(() => getSinceTimestamp(dateFilter), [dateFilter]);

  const apiType = ['shorts', 'audio'].includes(activeTab) ? activeTab : 'videos';
  const pages = { videos: [videosPage, setVideosPage], shorts: [shortsPage, setShortsPage], audio: [audioPage, setAudioPage] };
  const [currentPage, setCurrentPage] = pages[apiType];

  const handleDateFilterChange = useCallback((key) => {
    setDateFilter(key);
    setVideosPage(1);
    setShortsPage(1);
    setAudioPage(1);
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['watchedFeed', username, apiType, currentPage, since],
    queryFn: () => fetchWatchedPage(username, apiType, since, currentPage),
    enabled: !!username,
    staleTime: 60 * 1000,
  });
  const videosCount = data?.counts.videos ?? 0;
  const shortsCount = data?.counts.shorts ?? 0;
  const audioCount = data?.counts.audio ?? 0;
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


  return (
    <div className="watched-view-container">
      {/* Header (45c): title and owner on the left; track history and back on the right */}
      <div className="watched-header">
        <div className="watched-info">
          <span className="watched-bar" aria-hidden="true" />
          <div className="watched-details">
            <h1>{t('misc.watched.title')}</h1>
            <div className="watched-meta">
              <Link to={`/@${username}`} className="owner">
                @{username}
              </Link>
              <span className="separator" aria-hidden="true">·</span>
              <span>{t('misc.watched.count', { count: videosCount + shortsCount + audioCount })}</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {isOwner && (
            <label className="tracking-toggle" htmlFor="watched-track-toggle">
              <span>{t('misc.watched.trackHistory')}</span>
              <Toggle
                id="watched-track-toggle"
                checked={watchHistoryEnabled}
                onChange={(on) => setWatchHistoryEnabled(on)}
                label={t('misc.watched.trackHistory')}
              />
            </label>
          )}
          <Button className="back-btn" icon="arrow_back" size={36} onClick={() => navigate(-1)}>
            {t('common.actions.back')}
          </Button>
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
          { key: 'audio', label: t('misc.watched.audioTab', { count: audioCount }) },
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
            <div className="v2-failure" role="alert"><b>{t('misc.watched.loadFailed')}</b></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-wrap">
            <EmptyState
              icon={activeTab === 'shorts' ? 'smart_display' : activeTab === 'audio' ? 'headphones' : 'history'}
              title={activeTab === 'shorts' ? t('misc.watched.emptyShorts') : activeTab === 'audio' ? t('misc.watched.emptyAudio') : t('misc.watched.emptyVideos')}
            />
          </div>
        ) : (
          <ul className={`watched-list is-${apiType}`}>
            {filtered.map((item) => (
              <WatchedRow
                key={item._historyKey}
                item={item}
                kind={apiType}
                contextItems={filtered}
                canRemove={isOwner}
                onRemove={handleDelete}
              />
            ))}
          </ul>
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
