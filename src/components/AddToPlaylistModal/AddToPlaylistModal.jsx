import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MdPlaylistAdd, MdPlaylistAddCheck, MdAdd, MdClose, MdLock, MdPublic, MdWatchLater } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useMyPlaylists, isVideoInPlaylist } from '../../hooks/useMyPlaylists';
import { addToPlaylist, createPlaylistAndAdd } from '../../utils/playlistOperations';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import { formatDate as formatLocaleDate } from '../../i18n';
import './AddToPlaylistModal.scss';

// Every toast from this module is headed "Playlist"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Playlist');

// Reserved playlist name for Watch Later
const WATCH_LATER_NAME = 'Watch Later';

function AddToPlaylistModal({ isOpen, onClose, author, permlink, videoTitle }) {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const { data: playlists = [], isLoading, refetch } = useMyPlaylists();

  const [isAdding, setIsAdding] = useState(null); // playlist id being added to
  const [isAddingWatchLater, setIsAddingWatchLater] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistAccess, setNewPlaylistAccess] = useState('public');
  const [newPlaylistTags, setNewPlaylistTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Find the Watch Later playlist if it exists
  const watchLaterPlaylist = playlists.find(p => p.name === WATCH_LATER_NAME);
  const isInWatchLater = watchLaterPlaylist ? isVideoInPlaylist(watchLaterPlaylist, author, permlink) : false;

  if (!isOpen) return null;

  const handleAddToPlaylist = async (playlist) => {
    if (isVideoInPlaylist(playlist, author, permlink)) {
      toast.info(t('playlists.modal.alreadyInPlaylist'));
      return;
    }

    setIsAdding(playlist.id);
    try {
      await addToPlaylist(playlist.id, author, permlink, 0);
      toast.success(t('playlists.modal.addedTo', { name: playlist.name }));
      // Refetch playlists after a short delay
      setTimeout(() => {
        refetch();
        queryClient.invalidateQueries(['myPlaylists', user]);
        queryClient.invalidateQueries(['userPlaylists', user]);
      }, 2000);
      onClose();
    } catch (error) {
      toast.error(t('playlists.modal.failedToAdd', { error: error.message }));
    } finally {
      setIsAdding(null);
    }
  };

  const handleWatchLater = async () => {
    if (isInWatchLater) {
      toast.info(t('playlists.modal.alreadyInWatchLater'));
      return;
    }

    setIsAddingWatchLater(true);
    try {
      if (watchLaterPlaylist) {
        // Add to existing Watch Later playlist
        await addToPlaylist(watchLaterPlaylist.id, author, permlink, 0);
        toast.success(t('playlists.modal.addedToWatchLater'));
      } else {
        // Create Watch Later playlist and add the video
        const playlistId = generatePlaylistId();
        await createPlaylistAndAdd(WATCH_LATER_NAME, 'private', playlistId, author, permlink);
        toast.success(t('playlists.modal.createdWatchLater'));
      }

      // Refetch playlists after a delay
      setTimeout(() => {
        refetch();
        queryClient.invalidateQueries(['myPlaylists', user]);
        queryClient.invalidateQueries(['userPlaylists', user]);
      }, 2000);
      onClose();
    } catch (error) {
      toast.error(t('playlists.modal.failed', { error: error.message }));
    } finally {
      setIsAddingWatchLater(false);
    }
  };

  // Generate a unique playlist ID
  const generatePlaylistId = () => {
    // Use crypto.randomUUID if available, otherwise fallback to timestamp + random
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim()) {
      toast.error(t('playlists.modal.enterName'));
      return;
    }

    setIsCreating(true);
    try {
      // Generate a playlist ID so we can use it in both operations
      const playlistId = generatePlaylistId();
      const playlistName = newPlaylistName.trim();

      // Single batched transaction: Create playlist + Add video
      toast.info(t('playlists.modal.creatingAndAdding'));
      await createPlaylistAndAdd(playlistName, newPlaylistAccess, playlistId, author, permlink, newPlaylistTags);

      toast.success(t('playlists.modal.createdAndAdded', { name: playlistName }));

      // Refetch playlists after a delay to allow blockchain indexing
      setTimeout(() => {
        refetch();
        queryClient.invalidateQueries(['myPlaylists', user]);
        queryClient.invalidateQueries(['userPlaylists', user]);
      }, 3000);

      setNewPlaylistName('');
      setNewPlaylistAccess('public');
      setNewPlaylistTags([]);
      setTagInput('');
      setShowCreateForm(false);
      onClose();
    } catch (error) {
      toast.error(t('playlists.modal.failed', { error: error.message }));
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return formatLocaleDate(date, { month: 'short', day: 'numeric' });
  };

  const handleOverlayClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  // Portalled to <body>: rendered in place it would sit inside the hover-preview
  // overlay (.card-hover-controls) — a z-index:4 stacking context AND
  // pointer-events:none. That trapped its z-index under the sticky tabs/nav, and let
  // the pointer fall through to the cards behind, which flipped the hover state and
  // tore the modal down after ~1s. At <body> its z-index and clicks work normally.
  return createPortal(
    <div className="add-to-playlist-overlay" onClick={handleOverlayClick} onMouseDown={(e) => e.stopPropagation()}>
      <div className="add-to-playlist-modal" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <div className="modal-header">
          <h3>
            <MdPlaylistAdd /> {t('playlists.modal.title')}
          </h3>
          <button className="close-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
            <MdClose />
          </button>
        </div>

        <div className="modal-content">
          {/* Watch Later - Always shown first */}
          <button
            className={`watch-later-btn ${isInWatchLater ? 'added' : ''} ${isAddingWatchLater ? 'loading' : ''}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleWatchLater(); }}
            disabled={isAddingWatchLater || isAdding !== null}
          >
            <div className="watch-later-icon">
              <MdWatchLater />
            </div>
            <div className="watch-later-info">
              <span className="name">{t('playlists.watchLater')}</span>
              <span className="meta">
                <MdLock /> {t('playlists.private')}
                {watchLaterPlaylist && ` · ${t('common.units.videos', { count: watchLaterPlaylist.items?.length || 0 })}`}
              </span>
            </div>
            {isInWatchLater && <span className="added-badge">{t('playlists.modal.added')}</span>}
            {isAddingWatchLater && <span className="loading-indicator">...</span>}
          </button>

          <div className="separator">
            <span>{t('playlists.modal.yourPlaylists')}</span>
          </div>

          {isLoading ? (
            <div className="loading">{t('playlists.modal.loading')}</div>
          ) : playlists.filter(p => p.name !== WATCH_LATER_NAME).length === 0 && !showCreateForm ? (
            <div className="empty-state">
              <p>{t('playlists.modal.noOtherPlaylists')}</p>
              <button className="create-first-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCreateForm(true); }}>
                <MdAdd /> {t('playlists.modal.createFirst')}
              </button>
            </div>
          ) : (
            <>
              <div className="playlists-list">
                {playlists.filter(p => p.name !== WATCH_LATER_NAME).map((playlist) => {
                  const alreadyAdded = isVideoInPlaylist(playlist, author, permlink);
                  return (
                    <button
                      key={playlist.id}
                      className={`playlist-item ${alreadyAdded ? 'added' : ''} ${isAdding === playlist.id ? 'loading' : ''}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAddToPlaylist(playlist); }}
                      disabled={isAdding !== null}
                    >
                      <div className="playlist-icon">
                        {alreadyAdded ? <MdPlaylistAddCheck /> : <MdPlaylistAdd />}
                      </div>
                      <div className="playlist-info">
                        <span className="name">{playlist.name}</span>
                        <span className="meta">
                          {playlist.access === 'private' ? <MdLock /> : <MdPublic />}
                          {t('common.units.videos', { count: playlist.items?.length || 0 })}
                          {playlist.updated_at && ` · ${formatDate(playlist.updated_at)}`}
                        </span>
                      </div>
                      {alreadyAdded && <span className="added-badge">{t('playlists.modal.added')}</span>}
                    </button>
                  );
                })}
              </div>

              {!showCreateForm && (
                <button className="create-new-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCreateForm(true); }}>
                  <MdAdd /> {t('playlists.modal.createNew')}
                </button>
              )}
            </>
          )}

          {showCreateForm && (
            <div className="create-form">
              <div className="form-group">
                <label>{t('playlists.modal.name')}</label>
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={t('playlists.modal.namePlaceholder')}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>{t('playlists.modal.privacy')}</label>
                <div className="privacy-options">
                  <button
                    className={`privacy-btn ${newPlaylistAccess === 'public' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNewPlaylistAccess('public'); }}
                    type="button"
                  >
                    <MdPublic /> {t('playlists.public')}
                  </button>
                  <button
                    className={`privacy-btn ${newPlaylistAccess === 'private' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNewPlaylistAccess('private'); }}
                    type="button"
                  >
                    <MdLock /> {t('playlists.private')}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>{t('playlists.modal.tags')}</label>
                <div className="tags-input-wrap">
                  <div className="tags-list">
                    {newPlaylistTags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                        <button type="button" onClick={(e) => { e.stopPropagation(); setNewPlaylistTags(prev => prev.filter(x => x !== tag)); }}>
                          <MdClose />
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && tagInput.trim()) {
                        e.preventDefault();
                        const tag = tagInput.trim().toLowerCase().replace(/,/g, '');
                        if (tag && !newPlaylistTags.includes(tag)) {
                          setNewPlaylistTags(prev => [...prev, tag]);
                        }
                        setTagInput('');
                      } else if (e.key === 'Backspace' && !tagInput && newPlaylistTags.length > 0) {
                        setNewPlaylistTags(prev => prev.slice(0, -1));
                      }
                    }}
                    placeholder={newPlaylistTags.length === 0 ? t('playlists.modal.tagPlaceholder') : t('playlists.modal.tagMorePlaceholder')}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  className="cancel-btn"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCreateForm(false); }}
                  disabled={isCreating}
                >
                  {t('common.actions.cancel')}
                </button>
                <button
                  className="create-btn"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateAndAdd(); }}
                  disabled={isCreating || !newPlaylistName.trim()}
                >
                  {isCreating ? t('playlists.modal.creating') : t('playlists.modal.createAndAdd')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AddToPlaylistModal;
