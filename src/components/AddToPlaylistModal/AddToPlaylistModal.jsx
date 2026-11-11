import { useId, useState } from 'react';
import { usePortalDoc } from '../../utils/portalDocument';
import { toastIn } from '../../utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useMyPlaylists, isVideoInPlaylist } from '../../hooks/useMyPlaylists';
import { addToPlaylist, createPlaylistAndAdd } from '../../utils/playlistOperations';
import PlaylistTypePicker from '../PlaylistTypePicker/PlaylistTypePicker';
import { trackCategoryToKind } from '../../lib/playlistType';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import { formatDate as formatLocaleDate } from '../../i18n';
import DialogShell from '../modal/DialogShell';
import { Button, EmptyState, StatusPill } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import './AddToPlaylistModal.scss';

// Every toast from this module is headed "Playlist"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Playlist');

// Reserved playlist name for Watch Later
const WATCH_LATER_NAME = 'Watch Later';

// `audioCategory` is set (possibly '') when the item is an audio upload: a
// playlist created from it starts as audio of the matching kind.
function AddToPlaylistModal({ isOpen, onClose, author, permlink, videoTitle, audioCategory }) {
  const { t } = useTranslation();
  const doc = usePortalDoc();
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const { data: playlists = [], isLoading, refetch } = useMyPlaylists();

  const [isAdding, setIsAdding] = useState(null); // playlist id being added to
  const [isAddingWatchLater, setIsAddingWatchLater] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistAccess, setNewPlaylistAccess] = useState('public');
  const [newPlaylistTags, setNewPlaylistTags] = useState([]);
  const defaultType = () => (audioCategory != null
    ? { type: 'audio', kind: trackCategoryToKind(audioCategory) }
    : { type: 'video', kind: null });
  const [newPlaylistType, setNewPlaylistType] = useState(defaultType);
  const [tagInput, setTagInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Find the Watch Later playlist if it exists
  const watchLaterPlaylist = playlists.find(p => p.name === WATCH_LATER_NAME);
  const isInWatchLater = watchLaterPlaylist ? isVideoInPlaylist(watchLaterPlaylist, author, permlink) : false;

  const fieldId = useId();

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
      await createPlaylistAndAdd(playlistName, newPlaylistAccess, playlistId, author, permlink, newPlaylistTags, newPlaylistType);

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
      setNewPlaylistType(defaultType());
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

  const others = playlists.filter(p => p.name !== WATCH_LATER_NAME);
  const busy = isAddingWatchLater || isAdding !== null;
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };

  // Design 07a / 41d: Watch Later first, then your playlists as filled rows in
  // a fixed-height list that scrolls inside, "Added" in cyan; creating a new
  // playlist (name, privacy, type and audio kind, tags) opens below it with
  // its actions in the footer.
  // Portalled to the page's <body> (DialogShell): rendered in place it would sit
  // inside the hover-preview overlay (.card-hover-controls), a z-index:4
  // stacking context with pointer-events:none. `isolate` keeps clicks inside
  // from reaching the card that opened it.
  return (
    <DialogShell
      onClose={onClose}
      title={t('playlists.modal.title')}
      sub={videoTitle || undefined}
      width={480}
      zIndex={1100}
      doc={doc}
      isolate
      overlayClassName="add-to-playlist-overlay"
      className="add-to-playlist-modal"
      bodyClassName="atp-body"
      footer={showCreateForm ? (
        <>
          <Button variant="secondary" className="cancel-btn" onClick={stop(() => setShowCreateForm(false))} disabled={isCreating}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" className="create-btn" onClick={stop(handleCreateAndAdd)} disabled={isCreating || !newPlaylistName.trim()} loading={isCreating}>
            {isCreating ? t('playlists.modal.creating') : t('playlists.modal.createAndAdd')}
          </Button>
        </>
      ) : null}
    >
      {/* Watch Later - Always shown first */}
      <button
        type="button"
        className={cx('atp-row', 'watch-later-btn', isInWatchLater && 'added', isAddingWatchLater && 'loading')}
        onClick={stop(handleWatchLater)}
        disabled={busy}
      >
        <span className="atp-row__icon is-cyan"><Icon name="schedule" size={18} /></span>
        <span className="atp-row__info">
          <span className="name">{t('playlists.watchLater')}</span>
          <span className="meta">
            <Icon name="lock" size={14} /> {t('playlists.private')}
            {watchLaterPlaylist && ` · ${t('common.units.videos', { count: watchLaterPlaylist.items?.length || 0 })}`}
          </span>
        </span>
        {isInWatchLater && <StatusPill tone="cyan" className="added-badge">{t('playlists.modal.added')}</StatusPill>}
        {isAddingWatchLater && <Icon name="progress_activity" size={18} className="v2-spin atp-row__spin" />}
      </button>

      <div className="v2-eyebrow atp-eyebrow">{t('playlists.modal.yourPlaylists')}</div>

      {isLoading ? (
        <div className="atp-loading">
          <Icon name="progress_activity" size={18} className="v2-spin" />
          <span>{t('playlists.modal.loading')}</span>
        </div>
      ) : others.length === 0 && !showCreateForm ? (
        <EmptyState
          className="atp-empty"
          icon="playlist_add"
          title={t('playlists.modal.noOtherPlaylists')}
          action={(
            <Button variant="secondary" size={36} icon="add" className="create-first-btn" onClick={stop(() => setShowCreateForm(true))}>
              {t('playlists.modal.createFirst')}
            </Button>
          )}
        />
      ) : (
        <>
          {others.length > 0 && (
            <div className={cx('atp-list', showCreateForm && 'is-short')}>
              {others.map((playlist) => {
                const alreadyAdded = isVideoInPlaylist(playlist, author, permlink);
                return (
                  <button
                    type="button"
                    key={playlist.id}
                    className={cx('atp-row', 'playlist-item', alreadyAdded && 'added', isAdding === playlist.id && 'loading')}
                    onClick={stop(() => handleAddToPlaylist(playlist))}
                    disabled={isAdding !== null}
                  >
                    <span className="atp-row__icon"><Icon name={alreadyAdded ? 'playlist_add_check' : 'playlist_add'} size={18} /></span>
                    <span className="atp-row__info">
                      <span className="name">{playlist.name}</span>
                      <span className="meta">
                        <Icon name={playlist.access === 'private' ? 'lock' : 'public'} size={14} />
                        {t('common.units.videos', { count: playlist.items?.length || 0 })}
                        {playlist.updated_at && ` · ${formatDate(playlist.updated_at)}`}
                      </span>
                    </span>
                    {alreadyAdded && <StatusPill tone="cyan" className="added-badge">{t('playlists.modal.added')}</StatusPill>}
                    {isAdding === playlist.id && <Icon name="progress_activity" size={18} className="v2-spin atp-row__spin" />}
                  </button>
                );
              })}
            </div>
          )}

          {!showCreateForm && (
            <button type="button" className="atp-new create-new-btn" onClick={stop(() => setShowCreateForm(true))}>
              <Icon name="add" size={20} /> {t('playlists.modal.createNew')}
            </button>
          )}
        </>
      )}

      {showCreateForm && (
        <div className="atp-create create-form">
          <div className="v2-field">
            <label className="v2-eyebrow" htmlFor={`${fieldId}-name`}>{t('playlists.modal.name')}</label>
            <input
              id={`${fieldId}-name`}
              className="v2-input"
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={t('playlists.modal.namePlaceholder')}
              autoFocus
            />
          </div>
          <div className="form-group">
            <span className="form-label" id={`${fieldId}-privacy`}>{t('playlists.modal.privacy')}</span>
            <div className="privacy-options" role="group" aria-labelledby={`${fieldId}-privacy`}>
              <button
                className={`privacy-btn ${newPlaylistAccess === 'public' ? 'active' : ''}`}
                aria-pressed={newPlaylistAccess === 'public'}
                onClick={stop(() => setNewPlaylistAccess('public'))}
                type="button"
              >
                <Icon name="public" size={16} /> {t('playlists.public')}
              </button>
              <button
                className={`privacy-btn ${newPlaylistAccess === 'private' ? 'active' : ''}`}
                aria-pressed={newPlaylistAccess === 'private'}
                onClick={stop(() => setNewPlaylistAccess('private'))}
                type="button"
              >
                <Icon name="lock" size={16} /> {t('playlists.private')}
              </button>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <PlaylistTypePicker type={newPlaylistType.type} kind={newPlaylistType.kind} onChange={setNewPlaylistType} groupClass="privacy-options" disabled={isCreating} iconSize={16} />
          </div>
          <div className="v2-field">
            <label className="v2-eyebrow" htmlFor={`${fieldId}-tags`}>{t('playlists.modal.tags')}</label>
            <div className="tags-input-wrap">
              {newPlaylistTags.map((tag) => (
                <span key={tag} className="tag-chip">
                  <span>{tag}</span>
                  <button type="button" aria-label={t('audio.upload.mainPost.removeTag', { tag })} onClick={(e) => { e.stopPropagation(); setNewPlaylistTags(prev => prev.filter(x => x !== tag)); }}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ))}
              <input
                id={`${fieldId}-tags`}
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
        </div>
      )}
    </DialogShell>
  );
}

export default AddToPlaylistModal;
