import { useParams, Link, useNavigate } from 'react-router-dom';
import { getHiveUrl } from '../utils/hiveNode';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState, useMemo, useRef } from 'react';
import { MdPlaylistPlay, MdClose, MdDragIndicator, MdEdit, MdLock, MdPublic, MdCloudUpload } from 'react-icons/md';
import { IoArrowBack, IoTrash, IoSave, IoReorderThree } from 'react-icons/io5';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import BarLoader from '../components/Loader/BarLoader';
import icon from '../../public/images/stack.png';
import { useAppStore } from '../lib/store';
import {
  executePlaylistChanges,
  deletePlaylist,
  updatePlaylist,
  PlaylistActionTypes
} from '../utils/playlistOperations';
import { toastIn } from '../utils/toast';
import './PlaylistView.scss';
import { HIVE_API_URL, PLAYLISTS_READ_URL, CHECKER_URL } from '../utils/config';
import { MdPlayArrow as MdPlayIcon } from 'react-icons/md';
import AudioTile from '../components/AudioTile/AudioTile';
import AddToPlaylistModal from '../components/AddToPlaylistModal/AddToPlaylistModal';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import useHoverPreview from '../hooks/useHoverPreview';
import { uploadThumbnail } from '../utils/uploadThumbnail';
import { DATE_FILTERS, getSinceTimestamp, formatRelativeDate } from '../utils/dateFilters';

// Every toast from this module is headed "Playlist"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Playlist');

dayjs.extend(relativeTime);

/**
 * Fetch video data from Hive for a list of playlist items
 */
async function fetchVideosForPlaylist(items) {
  if (!items?.length) return [];

  // Sort items by position
  const sortedItems = [...items].sort((a, b) => a.position - b.position);

  // Fetch all video data in parallel
  const videoPromises = sortedItems.map(async (item) => {
    try {
      const response = await axios.post(getHiveUrl(), {
        jsonrpc: '2.0',
        method: 'condenser_api.get_content',
        params: [item.author, item.permlink],
        id: 1,
      });

      const post = response.data?.result;
      if (!post || !post.author) return null;

      // Parse json_metadata for video info
      let metadata = {};
      try {
        metadata = typeof post.json_metadata === 'string'
          ? JSON.parse(post.json_metadata)
          : post.json_metadata || {};
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }

      // Extract thumbnail
      let thumbnail = null;
      if (metadata.image?.[0]) {
        thumbnail = metadata.image[0];
      }

      // Extract duration from video metadata
      const duration = metadata.video?.info?.duration || 0;

      // Detect audio: the body contains an audio.3speak.tv/play?a=<permlink> link
      // (the marker the checker's audioHiveSync also uses)
      const audioMatch = typeof post.body === 'string'
        ? post.body.match(/audio\.3speak\.tv\/play\?a=([^\s)]+)/)
        : null;
      const audioPermlink = audioMatch?.[1] || null;

      // For audio items, eagerly resolve the embed-audio doc so we can render
      // the same AudioTile used elsewhere and trigger playback via the global player.
      let audioDoc = null;
      if (audioPermlink) {
        try {
          const { data: ad } = await axios.get(
            `${CHECKER_URL}/audio?owner=${encodeURIComponent(post.author)}&permlink=${encodeURIComponent(audioPermlink)}&limit=1`
          );
          audioDoc = ad?.audio?.[0] || null;
        } catch {}
      }

      return {
        author: post.author,
        permlink: post.permlink,
        title: post.title,
        created_at: post.created,
        images: { thumbnail },
        duration,
        position: item.position,
        added_at: item.added_at,
        isAudio: !!audioDoc,
        audioPermlink,
        audioDoc,
      };
    } catch (error) {
      console.error(`Error fetching video ${item.author}/${item.permlink}:`, error);
      return null;
    }
  });

  const videos = await Promise.all(videoPromises);
  return videos.filter(Boolean);
}

function PlaylistView() {
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

  const displayVideos = useMemo(() => {
    if (!since) return allVideos;
    return allVideos.filter(v => {
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
  }, [allVideos, since]);

  // Check if there are unsaved changes
  const hasChanges = pendingChanges.length > 0;

  // Parse tags from playlist json_metadata
  const playlistTags = useMemo(() => {
    if (!playlist?.json_metadata) return [];
    try {
      const meta = typeof playlist.json_metadata === 'string'
        ? JSON.parse(playlist.json_metadata)
        : playlist.json_metadata;
      return meta?.tags || [];
    } catch { return []; }
  }, [playlist]);

  // Open edit modal
  const handleOpenEdit = () => {
    setEditName(playlist.name);
    setEditAccess(playlist.access || 'public');
    setEditTags([...playlistTags]);
    setEditTagInput('');
    const album = playlist.metadata?.album || {};
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
    if (!file.type.startsWith('image/')) { toast.error('Pick an image file'); return; }
    setEditThumbUploading(true);
    try {
      const url = await uploadThumbnail(file);
      setEditThumb(url);
    } catch (err) {
      toast.error(`Thumbnail upload failed: ${err?.message || 'unknown'}`);
    } finally {
      setEditThumbUploading(false);
      if (editThumbInputRef.current) editThumbInputRef.current.value = '';
    }
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      toast.error('Playlist name cannot be empty');
      return;
    }
    setIsUpdating(true);
    try {
      // Build the album payload — only include fields with values
      // (mirrors the create flow in AudioUploadModal).
      const album = {};
      if (editCredits.trim()) album.credits = editCredits.trim();
      if (editMusicStyle.trim()) album.musicStyle = editMusicStyle.trim();
      const yearNum = parseInt(editYear, 10);
      if (!isNaN(yearNum) && yearNum > 0) album.year = yearNum;
      if (editLabel.trim()) album.label = editLabel.trim();
      if (editDescription.trim()) album.description = editDescription.trim();
      if (editThumb) album.thumbnail = editThumb;

      await updatePlaylist(playlistId, {
        name: editName.trim(),
        access: editAccess,
        json_metadata: JSON.stringify({ tags: editTags }),
        thumbnail: editThumb || '',
        metadata: { album },
      });
      toast.success('Playlist updated! Changes may take a moment to appear.');
      setShowEditModal(false);
      setTimeout(() => {
        queryClient.invalidateQueries(['playlist', playlistId]);
      }, 3000);
    } catch (error) {
      toast.error('Failed to update: ' + error.message);
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
          toast.loading(`Processing ${current}/${total}: ${change.type}...`, { id: 'save-progress' });
        }
      );

      toast.dismiss('save-progress');

      if (results.failed.length > 0) {
        toast.error(`${results.failed.length} operation(s) failed`);
      } else {
        toast.success('All changes saved! They may take a moment to appear.');
      }

      // Clear pending changes
      setPendingChanges([]);

      // Refetch after a delay
      setTimeout(() => {
        queryClient.invalidateQueries(['playlist', playlistId]);
        queryClient.invalidateQueries(['playlistVideos', playlistId]);
      }, 3000);
    } catch (error) {
      toast.error('Failed to save changes: ' + error.message);
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
      toast.success('Playlist deleted! Redirecting...');
      setShowDeleteConfirm(false);

      // Navigate back to profile after a short delay
      setTimeout(() => {
        navigate(`/p/${playlist.owner}`);
      }, 1500);
    } catch (error) {
      toast.error('Failed to delete playlist: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

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
        <div className="error-wrap">
          <p>Error loading playlist: {playlistError.message}</p>
          <Link to="/" className="back-link">
            <IoArrowBack /> Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="playlist-view-container">
        <div className="empty-wrap">
          <img src={icon} alt="" />
          <span>Playlist not found</span>
          <Link to="/" className="back-link">
            <IoArrowBack /> Back to Home
          </Link>
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
        <div className="empty-wrap">
          <img src={icon} alt="" />
          <span>This playlist is private</span>
          <Link to="/" className="back-link">
            <IoArrowBack /> Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="playlist-view-container">
      {/* Playlist Header */}
      <div className="playlist-header">
        <div className="playlist-info">
          {playlist.thumbnail ? (
            <div className="playlist-cover-wrap">
              <img className="playlist-cover" src={playlist.thumbnail} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
          ) : (
            <div className="playlist-icon-wrap">
              <MdPlaylistPlay className="playlist-icon" />
            </div>
          )}
          <div className="playlist-details">
            <h1>{playlist.name}</h1>
            <div className="playlist-meta">
              <Link to={`/p/${playlist.owner}`} className="owner">
                @{playlist.owner}
              </Link>
              <span className="separator">•</span>
              <span>{allVideos.length} {allVideos.length === 1 ? 'item' : 'items'}</span>
              <span className="separator">•</span>
              <span>Created {dayjs.unix(playlist.created_at).fromNow()}</span>
            </div>
            {playlist.metadata?.album && (
              <div className="playlist-album-meta">
                {playlist.metadata.album.musicStyle && <span><strong>Genre:</strong> {playlist.metadata.album.musicStyle}</span>}
                {playlist.metadata.album.year && <span><strong>Year:</strong> {playlist.metadata.album.year}</span>}
                {playlist.metadata.album.label && <span><strong>Label:</strong> {playlist.metadata.album.label}</span>}
                {playlist.metadata.album.credits && <span><strong>Credits:</strong> {playlist.metadata.album.credits}</span>}
                {playlist.metadata.album.description && <p className="playlist-album-desc">{playlist.metadata.album.description}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        {playlistTags.length > 0 && (
          <div className="playlist-tags">
            {playlistTags.map(tag => (
              <span key={tag} className="playlist-tag">{tag}</span>
            ))}
          </div>
        )}

        {/* Owner Actions */}
        {isOwner && (
          <div className="owner-actions">
            <button
              type="button"
              className="btn-edit"
              onClick={handleOpenEdit}
              disabled={isSaving}
            >
              <MdEdit /> Edit
            </button>
            <button
              type="button"
              className={`btn-reorder ${reorderMode ? 'active' : ''}`}
              onClick={() => setReorderMode(!reorderMode)}
              disabled={isSaving}
            >
              <IoReorderThree /> {reorderMode ? 'Done' : 'Reorder'}
            </button>
            <button
              type="button"
              className="btn-delete-playlist"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSaving}
            >
              <IoTrash /> Delete Playlist
            </button>
          </div>
        )}
      </div>

      {/* Save Changes Bar */}
      {isOwner && hasChanges && (
        <div className="save-changes-bar">
          <div className="changes-info">
            <span>{pendingChanges.length} unsaved change{pendingChanges.length > 1 ? 's' : ''}</span>
          </div>
          <div className="changes-actions">
            <button type="button" className="btn-discard" onClick={handleDiscardChanges} disabled={isSaving}>
              Discard
            </button>
            <button type="button" className="btn-save" onClick={handleSaveChanges} disabled={isSaving}>
              {isSaving ? 'Saving...' : <><IoSave /> Save Changes</>}
            </button>
          </div>
        </div>
      )}

      {/* Date filter toolbar */}
      <div className="playlist-toolbar">
        <div className="date-filters">
          {DATE_FILTERS.map(f => (
            <button
              type="button"
              key={f.key}
              className={`date-filter-btn ${dateFilter === f.key ? 'active' : ''}`}
              onClick={() => setDateFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {dateFilter !== 'all' && (
          <span className="filter-count">{displayVideos.length} of {allVideos.length} items</span>
        )}
      </div>

      {/* Videos */}
      <div className="playlist-videos">
        {videosLoading ? (
          <BarLoader />
        ) : displayVideos.length === 0 ? (
          <div className="empty-wrap">
            <img src={icon} alt="" />
            <span>{dateFilter !== 'all' ? 'No videos added in this period' : 'No videos in this playlist'}</span>
          </div>
        ) : reorderMode ? (
          /* List view for reorder mode */
          <div className="video-list">
            {allVideos.map((video, index) => (
              <div
                key={`${video.author}-${video.permlink}`}
                className={`video-item ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={() => setDragOverIndex(null)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
              >
                <div className="drag-handle">
                  <MdDragIndicator />
                </div>
                <span className="video-position">{index + 1}</span>
                <Link
                  to={`/watch?v=${video.author}/${video.permlink}&playlist=${playlistId}&pos=${index}`}
                  state={{ playlist, videos: allVideos, currentIndex: index }}
                  className="video-link"
                >
                  <div className="video-thumbnail">
                    <img
                      src={fixVideoThumbnail(video)}
                      alt={video.title}
                      onError={(e) => (e.currentTarget.src = fallbackImg)}
                    />
                    {video.duration > 0 && (
                      <span className="duration">
                        {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
                      </span>
                    )}
                    {video.isAudio && (
                      <span className="audio-badge"><MdPlayIcon size={12} /> Audio</span>
                    )}
                  </div>
                  <div className="video-info">
                    <h3>{video.title}</h3>
                    <p className="video-author">@{video.author}</p>
                  </div>
                </Link>
                <button
                  type="button"
                  className="btn-remove-video"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveVideo(video, index);
                  }}
                  title="Remove from playlist"
                >
                  <MdClose />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Grid view (default) */
          <div className="playlist-videos-grid" {...containerProps}>
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
                onAddToPlaylist={() => setPlaylistTarget({
                  author: video.audioDoc.owner,
                  permlink: video.audioDoc.post_permlink || video.audioDoc.permlink,
                  title: video.audioDoc.title,
                })}
              />
            ) : (
              <Link
                key={`${video.author}-${video.permlink}`}
                to={`/watch?v=${video.author}/${video.permlink}&playlist=${playlistId}&pos=${video.position}`}
                state={{ playlist, videos: allVideos, currentIndex: video.position }}
                className="playlist-video-card"
                {...getCardProps(`${video.author}/${video.permlink}`, video.author, video.permlink, fixVideoThumbnail(video), video.status)}
              >
                <div className="video-thumbnail">
                  <img
                    src={fixVideoThumbnail(video)}
                    alt={video.title}
                    onError={(e) => (e.currentTarget.src = fallbackImg)}
                  />
                  {video.duration > 0 && (
                    <span className="duration">
                      {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
                    </span>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      className="delete-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveVideo(video, allVideos.indexOf(video));
                      }}
                      title="Remove from playlist"
                    >
                      <MdClose />
                    </button>
                  )}
                </div>
                <div className="video-meta">
                  <h3>{video.title}</h3>
                  <p className="video-author">@{video.author}</p>
                  <p className="added-date">Added {formatRelativeDate(video.added_at)}</p>
                </div>
              </Link>
            ))}
            {overlay}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Playlist?</h3>
            <p>Are you sure you want to delete "{playlist.name}"? This action cannot be undone.</p>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}>
                Cancel
              </button>
              <button type="button" className="btn-confirm-delete" onClick={handleDeletePlaylist} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete Playlist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Playlist Modal */}
      {showEditModal && (
        <div className="delete-confirm-overlay" onClick={() => setShowEditModal(false)}>
          <div className="edit-playlist-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Playlist</h3>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Playlist name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Visibility</label>
              <div className="privacy-buttons">
                <button
                  type="button"
                  className={`privacy-btn ${editAccess === 'public' ? 'active' : ''}`}
                  onClick={() => setEditAccess('public')}
                >
                  <MdPublic /> Public
                </button>
                <button
                  type="button"
                  className={`privacy-btn ${editAccess === 'private' ? 'active' : ''}`}
                  onClick={() => setEditAccess('private')}
                >
                  <MdLock /> Private
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Tags</label>
              <div className="tags-input-wrap">
                <div className="tags-list">
                  {editTags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                      <button type="button" onClick={() => setEditTags(prev => prev.filter(t => t !== tag))}>
                        <MdClose />
                      </button>
                    </span>
                  ))}
                </div>
                <input
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
                  placeholder={editTags.length === 0 ? 'Type a tag and press Enter' : 'Add more...'}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Cover image</label>
              <div
                className={`playlist-edit-thumb${editThumb ? ' has-image' : ''}`}
                onClick={() => !editThumbUploading && editThumbInputRef.current?.click()}
              >
                {editThumb ? (
                  <>
                    <img src={editThumb} alt="Cover" />
                    <button
                      type="button"
                      className="playlist-edit-thumb-remove"
                      onClick={(e) => { e.stopPropagation(); setEditThumb(''); }}
                      aria-label="Remove cover"
                    ><MdClose size={14} /></button>
                  </>
                ) : (
                  <>
                    <MdCloudUpload size={26} />
                    <span>{editThumbUploading ? 'Uploading…' : 'Add cover image'}</span>
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
            <div className="form-group">
              <label>Genre</label>
              <input type="text" value={editMusicStyle} onChange={(e) => setEditMusicStyle(e.target.value)} placeholder="e.g. Hip-Hop" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Year</label>
                <input type="number" value={editYear} onChange={(e) => setEditYear(e.target.value)} placeholder="1996" />
              </div>
              <div className="form-group">
                <label>Label</label>
                <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Record label" />
              </div>
            </div>
            <div className="form-group">
              <label>Credits</label>
              <input type="text" value={editCredits} onChange={(e) => setEditCredits(e.target.value)} placeholder="Produced by…" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="About this album (optional)" rows={3} maxLength={1000} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowEditModal(false)} disabled={isUpdating}>
                Cancel
              </button>
              <button type="button" className="btn-confirm-delete" style={{ background: 'var(--accent-primary, #e53935)', color: '#fff' }} onClick={handleSaveEdit} disabled={isUpdating || !editName.trim()}>
                {isUpdating ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {playlistTarget && (
        <AddToPlaylistModal
          isOpen={!!playlistTarget}
          onClose={() => setPlaylistTarget(null)}
          author={playlistTarget.author}
          permlink={playlistTarget.permlink}
          videoTitle={playlistTarget.title}
        />
      )}
    </div>
  );
}

export default PlaylistView;
