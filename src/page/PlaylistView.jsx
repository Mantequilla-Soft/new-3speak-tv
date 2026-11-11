import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState, useMemo, useRef, useId } from 'react';
import PlaylistTypePicker from '../components/PlaylistTypePicker/PlaylistTypePicker';
import { resolvePlaylistType, playlistTypeFields } from '../lib/playlistType';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import BarLoader from '../components/Loader/BarLoader';
import { useAppStore } from '../lib/store';
import {
  executePlaylistChanges,
  deletePlaylist,
  updatePlaylist,
  PlaylistActionTypes
} from '../utils/playlistOperations';
import { toastIn } from '../utils/toast';
import { useTranslation, Trans } from 'react-i18next';
import './PlaylistView.scss';
import { HIVE_API_URL, PLAYLISTS_READ_URL } from '../utils/config';
import AudioTile from '../components/AudioTile/AudioTile';
import { audioItemPath } from '../components/AudioItem/AudioItemView';
import AddToPlaylistModal from '../components/AddToPlaylistModal/AddToPlaylistModal';
import PlaylistFollowButton from '../components/Podcasts/PlaylistFollowButton';
import PlaylistEpisodeTile from '../components/Podcasts/PlaylistEpisodeTile';
import PlaylistFeedsModal from '../components/Podcasts/PlaylistFeedsModal';
import PlaylistMergedList from '../components/Podcasts/PlaylistMergedList';
import { PODCAST_PLACEHOLDER, artUrl, episodeToTrack, podcastPath } from '../lib/podcasts';
import { playlistFeedsOf, usePlaylistBundle, mergeByDate } from '../lib/playlistFeeds';
import { fixVideoThumbnail, fallbackImg, squareCover } from '../utils/fixThumbnails';
import { fetchVideosForPlaylist } from '../utils/playlistVideos';
import useHoverPreview from '../hooks/useHoverPreview';
import { uploadThumbnail } from '../utils/uploadThumbnail';
import { DATE_FILTERS, getSinceTimestamp, formatRelativeDate } from '../utils/dateFilters';
import { Button, ConfirmBar, Dialog, EmptyState, Field, StatusPill } from '../components/v2/ui';
import { Icon } from '../components/v2/Icon';
import { cx } from '../components/v2/helpers';
import AccountImg from '../components/HiveAvatar/AccountImg';
import { ProfileTile } from '../components/Userprofilepage/ProfileActions';
import { openEmbedCode } from '../components/Embed/EmbedCodeModal';

// Every toast from this module is headed "Playlist"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Playlist');

dayjs.extend(relativeTime);

function PlaylistView() {
  const { t } = useTranslation();
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: authenticatedUser } = useAppStore();

  // Hover-to-play preview for the video cards in the grid.
  const { containerProps, getCardProps, overlay } = useHoverPreview();

  // State for edit mode
  const [editableVideos, setEditableVideos] = useState(null);
  const [pendingChanges, setPendingChanges] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [reorderMode, setReorderMode] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAccess, setEditAccess] = useState('public');
  const [editType, setEditType] = useState({ type: 'video', kind: null });
  const [editTags, setEditTags] = useState([]);
  // Album metadata + cover image
  const [editThumb, setEditThumb] = useState('');
  const [editThumbUploading, setEditThumbUploading] = useState(false);
  const [editMusicStyle, setEditMusicStyle] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editCredits, setEditCredits] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const editThumbInputRef = useRef(null);
  const [editTagInput, setEditTagInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState(null);
  const [episodeSearch, setEpisodeSearch] = useState('');
  const [showFeedsModal, setShowFeedsModal] = useState(false);
  const audioPlay = useAppStore((s) => s.audioPlay);

  // Fetch playlist data
  const { data: playlist, isLoading: playlistLoading, error: playlistError } = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: async () => {
      const response = await axios.get(`${PLAYLISTS_READ_URL}/playlists/${playlistId}`);
      return response.data;
    },
    enabled: !!playlistId,
  });

  // Check if user is the owner
  const isOwner = authenticatedUser && playlist?.owner?.toLowerCase() === authenticatedUser.toLowerCase();

  // Per-user visibility: a private playlist (this also covers Watch Later, which
  // is created private) is only viewable by its owner. Non-owners — logged in or
  // not — get a "not available" state instead of its contents. This is the
  // client-side filter the server API-token gate can't do (the token is shared,
  // not per-user); it's why opening someone else's private list by id must 404 here.
  const isPrivate = playlist?.access === 'private';
  const isHiddenFromViewer = !!playlist && isPrivate && !isOwner;

  // Fetch videos for the playlist
  const { data: videos = [], isLoading: videosLoading } = useQuery({
    queryKey: ['playlistVideos', playlistId, playlist?.items],
    queryFn: () => fetchVideosForPlaylist(playlist?.items),
    enabled: !!playlist?.items?.length,
    onSuccess: (data) => {
      // Initialize editable videos when data loads
      if (!editableVideos) {
        setEditableVideos(data);
      }
    },
  });

  // Initialize editable videos when videos change
  const allVideos = editableVideos || videos;

  const since = useMemo(() => getSinceTimestamp(dateFilter), [dateFilter]);

  // Album uploads used to add the album's own post to the playlist as well.
  // It carries no audio (its tracks are replies to it), so it showed up as an
  // empty video card. Hide any item whose replies are tracks in this playlist.
  // It stays in the reorder list, where the owner can still remove it.
  const listedVideos = useMemo(() => {
    const albumPosts = new Set(
      allVideos.filter(v => v.isAudio && v.parentAuthor).map(v => `${v.parentAuthor}/${v.parentPermlink}`)
    );
    if (albumPosts.size === 0) return allVideos;
    return allVideos.filter(v => v.isAudio || !albumPosts.has(`${v.author}/${v.permlink}`));
  }, [allVideos]);

  const displayVideos = useMemo(() => {
    if (!since) return listedVideos;
    return listedVideos.filter(v => {
      const addedAt = v.added_at;
      if (!addedAt) return true;
      let ts;
      if (typeof addedAt === 'number') {
        ts = addedAt < 1e12 ? addedAt : Math.floor(addedAt / 1000);
      } else {
        const ms = new Date(addedAt).getTime();
        ts = Number.isNaN(ms) ? null : Math.floor(ms / 1000);
      }
      return ts == null || ts >= since;
    });
  }, [listedVideos, since]);

  // Track numbers on audio tiles count the tracks only, in playlist order.
  const audioTracks = useMemo(() => displayVideos.filter(v => v.isAudio && v.audioDoc), [displayVideos]);

  // Check if there are unsaved changes
  const hasChanges = pendingChanges.length > 0;

  // The playlist's json_metadata as an object. It carries more than tags (an
  // album's `type: 'audio'`, for one), so an edit merges into it.
  const playlistJsonMeta = useMemo(() => {
    if (!playlist?.json_metadata) return {};
    try {
      const meta = typeof playlist.json_metadata === 'string'
        ? JSON.parse(playlist.json_metadata)
        : playlist.json_metadata;
      return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    } catch { return {}; }
  }, [playlist]);
  const playlistTags = useMemo(() => playlistJsonMeta.tags || [], [playlistJsonMeta]);

  // Outside podcast shows the owner added (lib/playlistFeeds.js): their episodes
  // are merged by date with the playlist's own items.
  const feedUrls = useMemo(
    () => (isHiddenFromViewer ? [] : playlistFeedsOf(playlistJsonMeta).map((f) => f.url)),
    [playlistJsonMeta, isHiddenFromViewer],
  );
  const hasFeeds = feedUrls.length > 0;
  const bundle = usePlaylistBundle(feedUrls);
  const bundlePages = bundle.data?.pages || [];
  const outsideFeeds = bundlePages[0]?.feeds || [];
  const outsideTotal = bundlePages[0]?.total || 0;
  const pendingFeeds = bundlePages[0]?.missing?.length || 0;
  const outsideEpisodes = useMemo(() => (bundle.data?.pages || []).flatMap((p) => p.episodes || []), [bundle.data]);

  // The playlist's type and audio kind (lib/playlistType.js): what the owner
  // chose, else worked out from the items. Until the items load only a stored
  // choice counts.
  const { type: playlistType, kind: playlistKind } = useMemo(() => resolvePlaylistType(
    playlist,
    videosLoading ? null : listedVideos.map((v) => ({ isAudio: !!(v.isAudio && v.audioDoc), category: v.audioDoc?.category })),
  ), [playlist, videosLoading, listedVideos]);
  // An audio playlist (an album, a 3Speak podcast) is drawn like an outside
  // podcast show (components/Podcasts): show header, episode tiles. That layout
  // only lists audio, so a video in it (nothing stops one being added) brings
  // back the plain list, where everything shows.
  // Outside shows are audio too: with some in it, an all-audio playlist is a show.
  const isAudioShow = listedVideos.length > 0
    ? (playlistType === 'audio' || hasFeeds) && listedVideos.every((v) => v.isAudio && v.audioDoc)
    : hasFeeds || (videosLoading && playlistType === 'audio');
  const showCover = playlist?.thumbnail || listedVideos.find((v) => v.audioDoc?.thumbnail_url)?.audioDoc.thumbnail_url || '';
  const outsideArt = outsideFeeds.find((f) => f.art)?.art;
  const headerCover = showCover ? squareCover(showCover) : outsideArt ? artUrl(outsideArt, 512) : PODCAST_PLACEHOLDER;
  // What a tile plays: the track with the playlist's cover, when it has one.
  const trackItem = (v) => (playlist?.thumbnail ? { ...v.audioDoc, thumbnail_url: playlist.thumbnail } : v.audioDoc);
  const episodeQuery = episodeSearch.trim().toLowerCase();
  const shownEpisodes = episodeQuery
    ? audioTracks.filter((v) => `${v.title || ''} ${v.audioDoc.title || ''} ${v.summary || ''}`.toLowerCase().includes(episodeQuery))
    : audioTracks;
  const episodeItems = shownEpisodes.map(trackItem);

  // With outside shows: one list, newest first, through the same date filter and search.
  const mergedText = (e) => (e.kind === 'episode'
    ? `${e.ep.title || ''} ${e.feed?.title || ''} ${e.ep.summary || ''}`
    : `${e.video.title || ''} ${e.video.audioDoc?.title || ''} ${e.video.summary || ''}`).toLowerCase();
  const merged = hasFeeds
    ? mergeByDate(listedVideos, outsideEpisodes, outsideFeeds, { complete: !bundle.hasNextPage })
      .filter((e) => (!since || e.at >= since * 1000) && (!episodeQuery || mergedText(e).includes(episodeQuery)))
    : [];
  const mergedTracks = merged.flatMap((e) => (e.kind === 'episode'
    ? [episodeToTrack(e.ep, e.feed)]
    : e.video.isAudio && e.video.audioDoc ? [trackItem(e.video)] : []));
  const itemCount = listedVideos.length + outsideTotal;
  const mergedList = (
    <PlaylistMergedList
      entries={merged}
      contextItems={mergedTracks}
      trackItem={trackItem}
      playlist={playlist}
      playlistId={playlistId}
      allVideos={allVideos}
      loading={videosLoading || bundle.isLoading}
      hasMore={!!bundle.hasNextPage}
      loadingMore={bundle.isFetchingNextPage}
      onLoadMore={() => bundle.fetchNextPage()}
      pending={pendingFeeds}
      emptyText={episodeQuery
        ? t('audio.podcasts.episodeSearch.none', { q: episodeSearch.trim() })
        : dateFilter !== 'all' ? t('playlists.view.emptyPeriod') : t('playlists.view.empty')}
      onAddToPlaylist={authenticatedUser ? (v) => setPlaylistTarget({
        author: v.audioDoc.owner,
        permlink: v.audioDoc.post_permlink || v.audioDoc.permlink,
        title: v.audioDoc.title,
        category: v.audioDoc.category || '',
      }) : undefined}
    />
  );

  // What the edit dialog opened with. Cover and album details are only sent when
  // they differ from it: an update that carries them REPLACES what is stored, so
  // sending the dialog's values unchanged would wipe a cover the page never
  // received (the playlists API on prod did not return covers until 2026-10).
  const editBaselineRef = useRef({ thumb: '', album: {} });

  // Open edit modal
  const handleOpenEdit = () => {
    setEditName(playlist.name);
    setEditAccess(playlist.access || 'public');
    // Opens on what the page shows, stored or worked out.
    setEditType({ type: playlistType || 'video', kind: playlistKind });
    setEditTags([...playlistTags]);
    setEditTagInput('');
    const album = playlist.metadata?.album || {};
    editBaselineRef.current = { thumb: playlist.thumbnail || album.thumbnail || '', album };
    setEditThumb(playlist.thumbnail || album.thumbnail || '');
    setEditMusicStyle(album.musicStyle || '');
    setEditYear(album.year ? String(album.year) : '');
    setEditLabel(album.label || '');
    setEditCredits(album.credits || '');
    setEditDescription(album.description || '');
    setShowEditModal(true);
  };

  const onEditThumbFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('playlists.view.pickImage')); return; }
    setEditThumbUploading(true);
    try {
      const url = await uploadThumbnail(file);
      setEditThumb(url);
    } catch (err) {
      toast.error(t('playlists.view.thumbFailed', { error: err?.message || t('playlists.view.unknown') }));
    } finally {
      setEditThumbUploading(false);
      if (editThumbInputRef.current) editThumbInputRef.current.value = '';
    }
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      toast.error(t('playlists.view.nameEmpty'));
      return;
    }
    setIsUpdating(true);
    try {
      // Build the album payload — only include fields with values
      // (mirrors the create flow in AudioUploadModal). Starts from what is
      // stored so fields this dialog does not edit survive the update.
      const baseline = editBaselineRef.current;
      const album = { ...baseline.album };
      const setOrDrop = (key, value) => { if (value) album[key] = value; else delete album[key]; };
      // Genre, year, label and credits are only shown for a music playlist;
      // otherwise whatever is stored stays as it is.
      if (editType.type === 'audio' && editType.kind === 'music') {
        setOrDrop('credits', editCredits.trim());
        setOrDrop('musicStyle', editMusicStyle.trim());
        const yearNum = parseInt(editYear, 10);
        setOrDrop('year', !isNaN(yearNum) && yearNum > 0 ? yearNum : null);
        setOrDrop('label', editLabel.trim());
      }
      setOrDrop('description', editDescription.trim());
      // The cover lives on the playlist; mirror it into the album only where the
      // album already carried one, or the viewer changed it.
      if (editThumb !== baseline.thumb || 'thumbnail' in baseline.album) setOrDrop('thumbnail', editThumb);

      const tf = playlistTypeFields(editType.type, editType.kind);
      const jsonMeta = { ...playlistJsonMeta, tags: editTags, ...tf.meta };
      if (tf.type !== 'audio') delete jsonMeta.audio_kind;
      const fields = {
        name: editName.trim(),
        access: editAccess,
        type: tf.type,
        audio_kind: tf.audio_kind,
        json_metadata: JSON.stringify(jsonMeta),
      };
      if (editThumb !== baseline.thumb) fields.thumbnail = editThumb || '';
      if (JSON.stringify(album) !== JSON.stringify(baseline.album)) {
        fields.metadata = { ...(playlist.metadata || {}), album };
      }
      await updatePlaylist(playlistId, fields);
      toast.success(t('playlists.view.updated'));
      setShowEditModal(false);
      setTimeout(() => {
        queryClient.invalidateQueries(['playlist', playlistId]);
      }, 3000);
    } catch (error) {
      toast.error(t('playlists.view.updateFailed', { error: error.message }));
    } finally {
      setIsUpdating(false);
    }
  };

  // Drag handlers for reorder mode
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const dragIndex = draggedIndex;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newVideos = [...allVideos];
    const [draggedItem] = newVideos.splice(dragIndex, 1);
    newVideos.splice(dropIndex, 0, draggedItem);

    const updatedVideos = newVideos.map((video, idx) => ({
      ...video,
      position: idx,
    }));

    setEditableVideos(updatedVideos);

    setPendingChanges(prev => [
      ...prev,
      {
        type: PlaylistActionTypes.REORDER,
        author: draggedItem.author,
        permlink: draggedItem.permlink,
        newPosition: dropIndex,
      },
    ]);

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Handle remove video
  const handleRemoveVideo = (video, index) => {
    const newVideos = allVideos.filter((_, idx) => idx !== index);

    // Update positions
    const updatedVideos = newVideos.map((v, idx) => ({
      ...v,
      position: idx,
    }));

    setEditableVideos(updatedVideos);

    // Track the remove change
    setPendingChanges(prev => [
      ...prev,
      {
        type: PlaylistActionTypes.REMOVE,
        author: video.author,
        permlink: video.permlink,
      },
    ]);
  };

  // Handle save changes
  const handleSaveChanges = async () => {
    if (pendingChanges.length === 0) return;

    setIsSaving(true);
    try {
      const results = await executePlaylistChanges(
        playlistId,
        pendingChanges,
        (current, total, change) => {
          toast.loading(t('playlists.view.processing', { current, total, type: change.type }), { id: 'save-progress' });
        }
      );

      toast.dismiss('save-progress');

      if (results.failed.length > 0) {
        toast.error(t('playlists.view.opsFailed', { count: results.failed.length }));
      } else {
        toast.success(t('playlists.view.allSaved'));
      }

      // Clear pending changes
      setPendingChanges([]);

      // Refetch after a delay
      setTimeout(() => {
        queryClient.invalidateQueries(['playlist', playlistId]);
        queryClient.invalidateQueries(['playlistVideos', playlistId]);
      }, 3000);
    } catch (error) {
      toast.error(t('playlists.view.saveFailed', { error: error.message }));
    } finally {
      setIsSaving(false);
    }
  };

  // Handle discard changes
  const handleDiscardChanges = () => {
    setEditableVideos(videos);
    setPendingChanges([]);
    setReorderMode(false);
  };

  // Handle delete playlist
  const handleDeletePlaylist = async () => {
    setIsDeleting(true);
    try {
      await deletePlaylist(playlistId);
      toast.success(t('playlists.view.deleted'));
      setShowDeleteConfirm(false);

      // Navigate back to profile after a short delay
      setTimeout(() => {
        navigate(`/@${playlist.owner}`);
      }, 1500);
    } catch (error) {
      toast.error(t('playlists.view.deleteFailed', { error: error.message }));
    } finally {
      setIsDeleting(false);
    }
  };

  // Ids for the edit window's labelled fields. (The v2 Dialog brings Escape,
  // focus trap and the bottom sheet; neither window closes mid-save.)
  const formId = useId();
  const fid = (name) => `${formId}-${name}`;

  const goHome = (
    <Button as={Link} to="/" variant="secondary" icon="arrow_back" className="back-link">
      {t('playlists.view.backHome')}
    </Button>
  );

  if (playlistLoading) {
    return (
      <div className="playlist-view-container">
        <BarLoader />
      </div>
    );
  }

  if (playlistError) {
    return (
      <div className="playlist-view-container">
        <div className="pv-state">
          <EmptyState icon="error" title={t('playlists.view.loadError', { error: playlistError.message })} action={goHome} />
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="playlist-view-container">
        <div className="pv-state">
          <EmptyState icon="playlist_remove" title={t('playlists.view.notFound')} action={goHome} />
        </div>
      </div>
    );
  }

  // A private playlist (incl. Watch Later) opened by anyone but its owner: don't
  // reveal its contents. Deliberately worded like "not found" so it doesn't even
  // confirm the playlist exists to a stranger who guessed/was handed the id.
  if (isHiddenFromViewer) {
    return (
      <div className="playlist-view-container">
        <div className="pv-state">
          <EmptyState icon="lock" title={t('playlists.view.private')} action={goHome} />
        </div>
      </div>
    );
  }

  const album = playlist.metadata?.album || {};
  const feedHref = `/rss/playlist/${encodeURIComponent(playlistId)}.xml`;
  const fmtDuration = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const totalSeconds = listedVideos.reduce((n, v) => n + (Number(v.duration) || 0), 0);
  const totalDuration = totalSeconds >= 3600
    ? `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`
    : totalSeconds > 0 ? fmtDuration(totalSeconds) : '';
  const firstVideo = listedVideos.find((v) => !v.isAudio);
  const heroCover = playlist.thumbnail
    ? squareCover(playlist.thumbnail)
    : firstVideo ? fixVideoThumbnail(firstVideo) : '';
  const sharePlaylist = async () => {
    const url = `${window.location.origin}/playlist/${encodeURIComponent(playlistId)}`;
    try {
      if (navigator.share && navigator.canShare?.({ url })) await navigator.share({ title: playlist.name, url });
      else await navigator.clipboard.writeText(url);
    } catch { /* cancelled or blocked: nothing to do */ }
  };
  const ownerButtons = isOwner && (
    <>
      <Button variant="secondary" size={36} icon="edit" className="pod-btn" onClick={handleOpenEdit} disabled={isSaving}>
        {t('common.actions.edit')}
      </Button>
      <Button variant="secondary" size={36} icon="podcasts" className="pod-btn" onClick={() => setShowFeedsModal(true)} disabled={isSaving}>
        {t('playlists.feeds.button')}
      </Button>
      <Button variant="secondary" size={36} icon="reorder" className={cx('pod-btn', reorderMode && 'is-on')} onClick={() => setReorderMode(!reorderMode)} disabled={isSaving} aria-pressed={reorderMode}>
        {reorderMode ? t('common.actions.done') : t('playlists.view.reorder')}
      </Button>
      <Button variant="danger" size={36} icon="delete" className="pod-btn" onClick={() => setShowDeleteConfirm(true)} disabled={isSaving}>
        {t('playlists.view.deletePlaylist')}
      </Button>
    </>
  );

  // The date filters as a segmented track. Toggle buttons (aria-pressed), not
  // tabs: they narrow one list rather than switch between panels.
  const dateFilters = (className) => (
    <div className={cx('v2-seg pv-filters', className)} role="group" aria-label={t('audio.podcasts.filters.dateLabel')}>
      {DATE_FILTERS.map((f) => (
        <button
          type="button"
          key={f.key}
          className={cx('v2-seg__opt h32 date-filter-btn', dateFilter === f.key && 'is-on active')}
          aria-pressed={dateFilter === f.key}
          onClick={() => setDateFilter(f.key)}
        >
          {t(f.labelKey)}
        </button>
      ))}
    </div>
  );

  const saveBar = isOwner && hasChanges && (
    <ConfirmBar
      actions={(
        <>
          <Button variant="ghost" size={36} className="btn-discard" onClick={handleDiscardChanges} disabled={isSaving}>
            {t('playlists.view.discard')}
          </Button>
          <Button variant="primary" size={36} className="btn-save" onClick={handleSaveChanges} disabled={isSaving} loading={isSaving} trailing={isSaving ? null : 'check'}>
            {isSaving ? t('playlists.view.saving') : t('playlists.view.saveChanges')}
          </Button>
        </>
      )}
    >
      <span>{t('playlists.view.unsaved', { count: pendingChanges.length })}</span>
    </ConfirmBar>
  );

  const videoList = (
    <div className="playlist-videos">
      {hasFeeds && !reorderMode ? mergedList : videosLoading ? (
        <BarLoader />
      ) : displayVideos.length === 0 ? (
        <EmptyState icon="playlist_play" title={dateFilter !== 'all' ? t('playlists.view.emptyPeriod') : t('playlists.view.empty')} className="pv-empty" />
      ) : reorderMode ? (
        /* Reorder: rows with a grip, dragged into place */
        <div className="video-list">
          {allVideos.map((video, index) => (
            <div
              key={`${video.author}-${video.permlink}`}
              className={cx('video-item pv-row', draggedIndex === index && 'dragging', dragOverIndex === index && 'drag-over')}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
            >
              <span className="drag-handle" aria-hidden="true"><Icon name="drag_indicator" size={20} /></span>
              <span className="video-position pv-num">{String(index + 1).padStart(2, '0')}</span>
              <Link
                to={`/@${video.author}/${video.permlink}?playlist=${playlistId}&pos=${index}`}
                state={{ playlist, videos: allVideos, currentIndex: index }}
                className="video-link"
              >
                <div className="video-thumbnail pv-thumb">
                  <img
                    src={fixVideoThumbnail(video)}
                    alt={video.title}
                    onError={(e) => (e.currentTarget.src = fallbackImg)}
                  />
                  {video.duration > 0 && <span className="duration v2-media-pill is-br">{fmtDuration(video.duration)}</span>}
                  {video.isAudio && (
                    <span className="audio-badge v2-media-pill is-tl"><Icon name="graphic_eq" size={12} /> {t('playlists.view.audio')}</span>
                  )}
                </div>
                <div className="video-info pv-info">
                  <h3>{video.title}</h3>
                  <p className="video-author">@{video.author}</p>
                </div>
              </Link>
              <button
                type="button"
                className="btn-remove-video pv-remove"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRemoveVideo(video, index);
                }}
                title={t('playlists.view.removeFromPlaylist')}
                aria-label={t('playlists.view.removeFromPlaylist')}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        /* Rows (28d): number, thumbnail, title and who, and the owner's remove */
        <div className={cx('playlist-videos-grid pv-rows', audioTracks.length && audioTracks.length === displayVideos.length && 'playlist-videos-grid--audio')} {...containerProps}>
          {displayVideos.map((video) => video.isAudio && video.audioDoc ? (
            <AudioTile
              key={`${video.author}-${video.permlink}`}
              /* Override the per-track thumbnail with the album cover when this
                 playlist has one — so all tracks share the album art. */
              item={playlist?.thumbnail
                ? { ...video.audioDoc, thumbnail_url: playlist.thumbnail }
                : video.audioDoc}
              contextItems={displayVideos.filter(v => v.isAudio && v.audioDoc).map(v => (
                playlist?.thumbnail
                  ? { ...v.audioDoc, thumbnail_url: playlist.thumbnail }
                  : v.audioDoc
              ))}
              loggedIn={!!authenticatedUser}
              trackNumber={audioTracks.indexOf(video) + 1}
              hideAlbum
              /* The page header already names the owner: no Follow on each of their tracks. */
              hideFollow={video.audioDoc.owner === playlist?.owner}
              onOpen={() => navigate(audioItemPath(video.audioDoc))}
              onAddToPlaylist={() => setPlaylistTarget({
                author: video.audioDoc.owner,
                permlink: video.audioDoc.post_permlink || video.audioDoc.permlink,
                title: video.audioDoc.title,
                category: video.audioDoc.category || '',
              })}
            />
          ) : (
            <Link
              key={`${video.author}-${video.permlink}`}
              to={`/@${video.author}/${video.permlink}?playlist=${playlistId}&pos=${video.position}`}
              state={{ playlist, videos: allVideos, currentIndex: video.position }}
              className="playlist-video-card pv-row"
              {...getCardProps(`${video.author}/${video.permlink}`, video.author, video.permlink, fixVideoThumbnail(video), video.status)}
            >
              <span className="pv-num">{String((Number.isFinite(video.position) ? video.position : allVideos.indexOf(video)) + 1).padStart(2, '0')}</span>
              <div className="video-thumbnail pv-thumb">
                <img
                  src={fixVideoThumbnail(video)}
                  alt={video.title}
                  onError={(e) => (e.currentTarget.src = fallbackImg)}
                />
                {video.duration > 0 && <span className="duration v2-media-pill is-br">{fmtDuration(video.duration)}</span>}
              </div>
              <div className="video-meta pv-info">
                <h3>{video.title}</h3>
                <p className="video-author">
                  @{video.author}
                  <span className="added-date"> · {t('playlists.view.added', { when: formatRelativeDate(video.added_at) })}</span>
                </p>
              </div>
              {isOwner && (
                <button
                  type="button"
                  className="delete-btn pv-remove"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveVideo(video, allVideos.indexOf(video));
                  }}
                  title={t('playlists.view.removeFromPlaylist')}
                  aria-label={t('playlists.view.removeFromPlaylist')}
                >
                  <Icon name="close" size={20} />
                </button>
              )}
            </Link>
          ))}
          {overlay}
        </div>
      )}
    </div>
  );

  return (
    <div className="playlist-view-container">
      {isAudioShow ? (
        <>
        <header className="pod-show-head playlist-pod-head">
          <img
            className="pod-art pod-show-cover"
            src={headerCover}
            alt=""
            onError={(e) => { e.currentTarget.src = PODCAST_PLACEHOLDER; }}
          />
          <div className="pod-show-info">
            <span className="pod-show-kicker">
              <Icon
                size={14}
                name={playlistKind === 'music' ? 'library_music'
                  : playlistKind === 'voice' ? 'keyboard_voice'
                  : playlistKind === 'sounds' ? 'graphic_eq'
                  : 'podcasts'}
              />
              {playlistKind === 'music' ? t('audio.categories.music')
                : playlistKind === 'voice' || playlistKind === 'sounds' ? t(`playlists.type.kinds.${playlistKind}`)
                : t('audio.podcasts.kicker')}
              {isPrivate && <span className="pod-badge pod-badge--lock"><Icon name="lock" size={12} />{t('playlists.private')}</span>}
            </span>
            <h1 className="pod-show-title">{playlist.name}</h1>
            <Link to={`/@${playlist.owner}`} className="pod-show-author">@{playlist.owner}</Link>
            <div className="pod-show-meta">
              {album.musicStyle && <span className="pod-chip">{album.musicStyle}</span>}
              {playlistTags
                .filter((tag) => tag.toLowerCase() !== String(album.musicStyle || '').toLowerCase())
                .map((tag) => <span key={tag} className="pod-chip">{tag}</span>)}
              <span>{t('audio.podcasts.episodes', { count: itemCount })}</span>
              {album.year && <span>{album.year}</span>}
              <span>{t('playlists.view.created', { when: dayjs.unix(playlist.created_at).fromNow() })}</span>
            </div>
            {(album.label || album.credits) && (
              <div className="pod-show-meta">
                {album.label && <span><Trans i18nKey="playlists.view.album.label" values={{ value: album.label }} components={{ strong: <strong /> }} /></span>}
                {album.credits && <span><Trans i18nKey="playlists.view.album.credits" values={{ value: album.credits }} components={{ strong: <strong /> }} /></span>}
              </div>
            )}
            {outsideFeeds.length > 0 && (
              <div className="pod-show-meta">
                <span>{t('playlists.feeds.fromShows')}</span>
                {outsideFeeds.map((f) => <Link key={f.id} to={podcastPath(f.id)} className="pod-chip">{f.title || f.url}</Link>)}
              </div>
            )}
            {album.description && <p className="pod-show-desc">{album.description}</p>}
            <div className="pod-show-actions">
              {hasFeeds ? mergedTracks.length > 0 && (
                <Button variant="inverse" size={40} icon={<Icon name="play_arrow" size={20} fill />} className="pod-btn pod-btn--solid" onClick={() => audioPlay(mergedTracks[0], mergedTracks)}>
                  {t('common.actions.play')}
                </Button>
              ) : audioTracks.length > 0 && (
                <Button variant="inverse" size={40} icon={<Icon name="play_arrow" size={20} fill />} className="pod-btn pod-btn--solid" onClick={() => audioPlay(trackItem(audioTracks[0]), audioTracks.map(trackItem))}>
                  {t('common.actions.play')}
                </Button>
              )}
              {!isPrivate && (listedVideos.length > 0 || hasFeeds) && (
                <PlaylistFollowButton playlistId={playlistId} name={playlist.name} user={authenticatedUser} />
              )}
              {!isPrivate && (
                <>
                  <link rel="alternate" type="application/rss+xml" title={playlist.name} href={`${window.location.origin}${feedHref}`} />
                  <Button as="a" variant="secondary" size={36} icon="rss_feed" className="pod-btn" href={feedHref} target="_blank" rel="noreferrer" title={t('playlists.view.podcastFeedTitle', { name: playlist.name })}>
                    RSS
                  </Button>
                  {/* Every audio track of the playlist in one player on another site */}
                  {audioTracks.length > 0 && (
                    <Button
                      variant="secondary"
                      size={36}
                      icon="code"
                      className="pod-btn"
                      onClick={() => openEmbedCode({ kind: 'playlist', id: playlistId, title: playlist.name })}
                      title={t('chat.share.embedOnWebsite')}
                    >
                      {t('misc.embed.embed')}
                    </Button>
                  )}
                </>
              )}
              {ownerButtons}
            </div>
          </div>
        </header>
        {saveBar}
        </>
      ) : null}

      {isAudioShow && !reorderMode ? (
        <section className="pod-section playlist-pod-episodes">
          <div className="pod-section-head pod-section-head--filters">
            <h2 className="pod-section-title">
              {t('audio.podcasts.episodesTitle')}
              {itemCount > 0 && <span className="audio-section-count">{itemCount}</span>}
            </h2>
            <div className="pod-filters">
              {dateFilters('pod-filter-dates')}
            </div>
          </div>
          {itemCount > 5 && (
            <div className="pod-show-tools">
              <label className="pod-field-row pod-episode-search">
                <Icon name="search" size={18} className="pod-field-icon" />
                <input
                  type="search"
                  value={episodeSearch}
                  onChange={(e) => setEpisodeSearch(e.target.value)}
                  placeholder={t('audio.podcasts.episodeSearch.placeholder')}
                  aria-label={t('audio.podcasts.episodeSearch.label')}
                  autoComplete="off"
                />
              </label>
            </div>
          )}
          {hasFeeds ? mergedList : videosLoading ? (
            <BarLoader />
          ) : shownEpisodes.length > 0 ? (
            <ul className="pod-tile-grid">
              {shownEpisodes.map((video, i) => (
                <PlaylistEpisodeTile
                  key={`${video.author}-${video.permlink}`}
                  video={video}
                  item={episodeItems[i]}
                  contextItems={episodeItems}
                  number={listedVideos.indexOf(video) + 1}
                  music={playlistKind === 'music'}
                  onOpen={() => navigate(audioItemPath(video.audioDoc))}
                  onAddToPlaylist={authenticatedUser ? () => setPlaylistTarget({
                    author: video.audioDoc.owner,
                    permlink: video.audioDoc.post_permlink || video.audioDoc.permlink,
                    title: video.audioDoc.title,
                    category: video.audioDoc.category || '',
                  }) : undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="pod-empty">
              {episodeQuery
                ? t('audio.podcasts.episodeSearch.none', { q: episodeSearch.trim() })
                : dateFilter !== 'all' ? t('playlists.view.emptyPeriod') : t('playlists.view.empty')}
            </p>
          )}
        </section>
      ) : isAudioShow ? (
        <section className="pv-main pv-main--reorder">{videoList}</section>
      ) : (
      <div className="pv-layout">
        {/* 28d: the hero on the left, on a cyan wash: cover, kind, title, who,
            then Play all and the action tiles. */}
        <aside className="pv-hero">
          <div className="pv-cover">
            {heroCover ? (
              <img src={heroCover} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : null}
            <Icon name="playlist_play" size={48} className="pv-cover-icon" />
            <span className="v2-media-pill is-br pv-cover-count">
              <span>{t('playlists.view.items', { count: listedVideos.length })}</span>
              {totalDuration ? <span> · {totalDuration}</span> : null}
            </span>
          </div>
          <StatusPill tone="cyan" icon={isPrivate ? 'lock' : 'public'} className="pv-kind">
            {t('profile.layout.types.playlist')} · {isPrivate ? t('playlists.private') : t('playlists.public')}
          </StatusPill>
          <h1 className="pv-title">{playlist.name}</h1>
          <div className="pv-owner">
            <AccountImg account={playlist.owner} alt="" className="pv-owner-avatar" />
            <Link to={`/@${playlist.owner}`} className="owner">@{playlist.owner}</Link>
            <span className="pv-owner-meta">· {t('playlists.view.created', { when: dayjs.unix(playlist.created_at).fromNow() })}</span>
          </div>

          {playlist.metadata?.album && (
            <div className="playlist-album-meta">
              {album.musicStyle && <span><Trans i18nKey="playlists.view.album.genre" values={{ value: album.musicStyle }} components={{ strong: <strong /> }} /></span>}
              {album.year && <span><Trans i18nKey="playlists.view.album.year" values={{ value: album.year }} components={{ strong: <strong /> }} /></span>}
              {album.label && <span><Trans i18nKey="playlists.view.album.label" values={{ value: album.label }} components={{ strong: <strong /> }} /></span>}
              {album.credits && <span><Trans i18nKey="playlists.view.album.credits" values={{ value: album.credits }} components={{ strong: <strong /> }} /></span>}
              {album.description && <p className="playlist-album-desc">{album.description}</p>}
            </div>
          )}

          {playlistTags.length > 0 && (
            <div className="playlist-tags">
              {playlistTags.map(tag => (
                <span key={tag} className="playlist-tag">{tag}</span>
              ))}
            </div>
          )}

          {outsideFeeds.length > 0 && (
            <div className="playlist-tags">
              <span className="pv-tags-label">{t('playlists.feeds.fromShows')}</span>
              {outsideFeeds.map((f) => <Link key={f.id} to={podcastPath(f.id)} className="playlist-tag">{f.title || f.url}</Link>)}
            </div>
          )}

          <div className="pv-actions">
            {firstVideo ? (
              <Button
                as={Link}
                variant="inverse"
                size={64}
                className="pv-play"
                to={`/@${firstVideo.author}/${firstVideo.permlink}?playlist=${playlistId}&pos=${allVideos.indexOf(firstVideo)}`}
                state={{ playlist, videos: allVideos, currentIndex: allVideos.indexOf(firstVideo) }}
                trailing={<Icon name="play_arrow" size={28} fill />}
              >
                {t('playlists.view.playAll')}
              </Button>
            ) : null}
            <ProfileTile icon="ios_share" label={t('common.actions.share')} onClick={sharePlaylist} />
            {/* Podcast / RSS feed for this playlist (checker routes/rss.js), so
                people can follow one series in a podcast app. The <link> is
                hoisted into <head> for feed readers, as on profiles. */}
            {!isPrivate && (
              <>
                <link
                  rel="alternate"
                  type="application/rss+xml"
                  title={playlist.name}
                  href={`${window.location.origin}${feedHref}`}
                />
                <ProfileTile
                  as="a"
                  icon="rss_feed"
                  label={t('playlists.view.podcastFeed')}
                  className="playlist-feed-link"
                  href={feedHref}
                  target="_blank"
                  rel="noreferrer"
                  title={t('playlists.view.podcastFeedTitle', { name: playlist.name })}
                />
              </>
            )}
          </div>
        </aside>

        <section className="pv-main">
          <div className="playlist-toolbar">
            {dateFilters()}
            {dateFilter !== 'all' && (
              <span className="filter-count">{hasFeeds
                ? t('playlists.view.filterCount', { shown: merged.length, count: itemCount })
                : t('playlists.view.filterCount', { shown: displayVideos.length, count: listedVideos.length })}</span>
            )}
            {isOwner ? <div className="owner-actions">{ownerButtons}</div> : null}
          </div>
          {saveBar}
          {videoList}
        </section>
      </div>
      )}

      {/* Delete confirmation: the shared v2 dialog (a bottom sheet on phones). */}
      <Dialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        dismissible={!isDeleting}
        title={t('playlists.view.deleteConfirmTitle')}
        closeLabel={t('common.actions.close')}
        footer={(
          <>
            <Button variant="secondary" className="btn-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="danger" icon="delete" className="btn-confirm-delete" onClick={handleDeletePlaylist} disabled={isDeleting} loading={isDeleting}>
              {isDeleting ? t('playlists.view.deleting') : t('playlists.view.deletePlaylist')}
            </Button>
          </>
        )}
      >
        <p className="pv-dialog-text">{t('playlists.view.deleteConfirmText', { name: playlist.name })}</p>
      </Dialog>

      {/* Edit playlist */}
      <Dialog
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        dismissible={!isUpdating}
        width={520}
        title={t('playlists.view.editTitle')}
        closeLabel={t('common.actions.close')}
        className="edit-playlist-modal"
        footer={(
          <>
            <Button variant="secondary" className="btn-cancel" onClick={() => setShowEditModal(false)} disabled={isUpdating}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="primary" className="btn-save-edit" onClick={handleSaveEdit} disabled={isUpdating || !editName.trim()} loading={isUpdating} trailing={isUpdating ? null : 'check'}>
              {isUpdating ? t('playlists.view.saving') : t('playlists.view.saveChanges')}
            </Button>
          </>
        )}
      >
        <Field
          id={fid('name')}
          label={t('playlists.modal.name')}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder={t('playlists.view.namePlaceholder')}
          autoFocus
        />
        <div className="v2-field">
          <span className="v2-eyebrow" id={fid('visibility')}>{t('playlists.view.visibility')}</span>
          <div className="v2-seg is-block" role="group" aria-labelledby={fid('visibility')}>
            {[['public', 'public', t('playlists.public')], ['private', 'lock', t('playlists.private')]].map(([value, iconName, label]) => (
              <button
                key={value}
                type="button"
                className={cx('v2-seg__opt h32 privacy-btn', editAccess === value && 'is-on active')}
                aria-pressed={editAccess === value}
                onClick={() => setEditAccess(value)}
              >
                <Icon name={iconName} size={16} /> {label}
              </button>
            ))}
          </div>
        </div>
        <PlaylistTypePicker type={editType.type} kind={editType.kind} onChange={setEditType} disabled={isUpdating} />
        <Field id={fid('tags')} label={t('playlists.modal.tags')}>
          <div className="pv-tags v2-input">
            {editTags.map((tag) => (
              <span key={tag} className="v2-chip h28 pv-tags__chip">
                {tag}
                <button type="button" className="pv-tags__x" aria-label={t('audio.upload.mainPost.removeTag', { tag })} onClick={() => setEditTags(prev => prev.filter(x => x !== tag))}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
            <input
              id={fid('tags')}
              type="text"
              value={editTagInput}
              onChange={(e) => setEditTagInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && editTagInput.trim()) {
                  e.preventDefault();
                  const tag = editTagInput.trim().toLowerCase().replace(/,/g, '');
                  if (tag && !editTags.includes(tag)) {
                    setEditTags(prev => [...prev, tag]);
                  }
                  setEditTagInput('');
                } else if (e.key === 'Backspace' && !editTagInput && editTags.length > 0) {
                  setEditTags(prev => prev.slice(0, -1));
                }
              }}
              placeholder={editTags.length === 0 ? t('playlists.modal.tagPlaceholder') : t('playlists.modal.tagMorePlaceholder')}
            />
          </div>
        </Field>
        <div className="v2-field">
          <span className="v2-eyebrow">{t('playlists.view.coverImage')}</span>
          <div
            className={cx('playlist-edit-thumb', editThumb && 'has-image')}
            role="button"
            tabIndex={0}
            onClick={() => !editThumbUploading && editThumbInputRef.current?.click()}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !editThumbUploading) { e.preventDefault(); editThumbInputRef.current?.click(); } }}
          >
            {editThumb ? (
              <>
                <img src={editThumb} alt={t('playlists.view.coverAlt')} />
                <button
                  type="button"
                  className="playlist-edit-thumb-remove"
                  onClick={(e) => { e.stopPropagation(); setEditThumb(''); }}
                  aria-label={t('playlists.view.removeCover')}
                ><Icon name="close" size={16} /></button>
              </>
            ) : (
              <>
                <Icon name={editThumbUploading ? 'progress_activity' : 'add_photo_alternate'} size={28} className={editThumbUploading ? 'v2-spin' : undefined} />
                <span>{editThumbUploading ? t('playlists.view.uploading') : t('playlists.view.addCover')}</span>
                <small>JPG / PNG / WebP</small>
              </>
            )}
            <input
              ref={editThumbInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onEditThumbFile}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        {editType.type === 'audio' && editType.kind === 'music' && (
          <>
            <Field id={fid('genre')} label={t('playlists.view.genre')} value={editMusicStyle} onChange={(e) => setEditMusicStyle(e.target.value)} placeholder={t('playlists.view.genrePlaceholder')} />
            <div className="pv-form-row">
              <Field id={fid('year')} type="number" label={t('playlists.view.year')} value={editYear} onChange={(e) => setEditYear(e.target.value)} placeholder="1996" />
              <Field id={fid('label')} label={t('playlists.view.label')} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder={t('playlists.view.labelPlaceholder')} />
            </div>
            <Field id={fid('credits')} label={t('playlists.view.credits')} value={editCredits} onChange={(e) => setEditCredits(e.target.value)} placeholder={t('playlists.view.creditsPlaceholder')} />
          </>
        )}
        <Field
          as="textarea"
          id={fid('description')}
          label={t('playlists.view.description')}
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder={t('playlists.view.descriptionPlaceholder')}
          rows={3}
          maxLength={1000}
        />
      </Dialog>

      {showFeedsModal && (
        <PlaylistFeedsModal
          playlistId={playlistId}
          user={authenticatedUser}
          jsonMeta={playlistJsonMeta}
          cards={outsideFeeds}
          onClose={() => setShowFeedsModal(false)}
          onSaved={(json) => {
            // Show the new list right away (an edit opened before the refetch must
            // not write the old one back), then read what the indexer stored.
            queryClient.setQueryData(['playlist', playlistId], (old) => (old ? { ...old, json_metadata: json } : old));
            setTimeout(() => queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] }), 3000);
          }}
        />
      )}

      {playlistTarget && (
        <AddToPlaylistModal
          isOpen={!!playlistTarget}
          onClose={() => setPlaylistTarget(null)}
          author={playlistTarget.author}
          permlink={playlistTarget.permlink}
          videoTitle={playlistTarget.title}
          audioCategory={playlistTarget.category}
        />
      )}
    </div>
  );
}

export default PlaylistView;
