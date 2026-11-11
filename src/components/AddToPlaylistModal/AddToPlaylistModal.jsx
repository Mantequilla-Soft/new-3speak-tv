import { useId, useState } from 'react';
import { usePortalDoc } from '../../utils/portalDocument';
import { toastIn } from '../../utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import usePostThumb from '../modal/usePostThumb';
import { useMyPlaylists, isVideoInPlaylist } from '../../hooks/useMyPlaylists';
import { addToPlaylist, createPlaylistAndAdd } from '../../utils/playlistOperations';
import { AUDIO_KINDS, storedPlaylistType, trackCategoryToKind } from '../../lib/playlistType';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import DialogShell, { SheetContext } from '../modal/DialogShell';
import { Button, Chip, IconButton } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import './AddToPlaylistModal.scss';

// Every toast from this module is headed "Playlist"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Playlist');

// Reserved playlist name for Watch Later
const WATCH_LATER_NAME = 'Watch Later';
// Marks Watch Later in the saved-this-time list before the indexer has it.
const WATCH_LATER_ID = '__watch-later__';
// Material Symbols per audio kind (as PlaylistTypePicker).
const KIND_ICONS = { podcast: 'podcasts', music: 'library_music', voice: 'keyboard_voice', sounds: 'graphic_eq' };

// `audioCategory` is set (possibly '') when the item is an audio upload: a
// playlist created from it starts as audio of the matching kind.
function AddToPlaylistModal({ isOpen, onClose, author, permlink, videoTitle, audioCategory, thumbnail }) {
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
  // Playlists this video went into while the sheet is open (the indexer takes a
  // few seconds, so the tiles show the check straight away).
  const [savedIds, setSavedIds] = useState([]);
  const fetched = usePostThumb(author, permlink, isOpen && !thumbnail);
  const post = { thumbnail: thumbnail || fetched.thumbnail, duration: fetched.duration };

  // Find the Watch Later playlist if it exists
  const watchLaterPlaylist = playlists.find(p => p.name === WATCH_LATER_NAME);
  const isInWatchLater = watchLaterPlaylist ? isVideoInPlaylist(watchLaterPlaylist, author, permlink) : false;

  const fieldId = useId();

  if (!isOpen) return null;

  const handleAddToPlaylist = async (playlist) => {
    if (isVideoInPlaylist(playlist, author, permlink) || savedIds.includes(playlist.id)) {
      toast.info(t('playlists.modal.alreadyInPlaylist'));
      return;
    }

    setIsAdding(playlist.id);
    try {
      await addToPlaylist(playlist.id, author, permlink, 0);
      toast.success(t('playlists.modal.addedTo', { name: playlist.name }));
      setSavedIds((ids) => [...ids, playlist.id]);
      // Refetch playlists after a short delay
      setTimeout(() => {
        refetch();
        queryClient.invalidateQueries(['myPlaylists', user]);
        queryClient.invalidateQueries(['userPlaylists', user]);
      }, 2000);
    } catch (error) {
      toast.error(t('playlists.modal.failedToAdd', { error: error.message }));
    } finally {
      setIsAdding(null);
    }
  };

  const handleWatchLater = async () => {
    if (isInWatchLater || savedIds.includes(WATCH_LATER_ID)) {
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

      setSavedIds((ids) => [...ids, WATCH_LATER_ID]);
      // Refetch playlists after a delay
      setTimeout(() => {
        refetch();
        queryClient.invalidateQueries(['myPlaylists', user]);
        queryClient.invalidateQueries(['userPlaylists', user]);
      }, 2000);
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

  const others = playlists.filter(p => p.name !== WATCH_LATER_NAME);
  const busy = isAddingWatchLater || isAdding !== null;
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  const has = (pl) => !!pl && (savedIds.includes(pl.id) || isVideoInPlaylist(pl, author, permlink));
  const wlAdded = isInWatchLater || savedIds.includes(WATCH_LATER_ID);
  const savedCount = (wlAdded ? 1 : 0) + others.filter(has).length;
  const ctxMeta = [author && `@${author}`, post.duration].filter(Boolean).join(' · ');
  const closeForm = () => setShowCreateForm(false);

  // One playlist as a tile (07a): a cover (its thumbnail, or the stripes with an
  // icon), the name, privacy and count; saved = cyan border, tint and a check.
  const tile = ({ key, name, access, count, cover, icon, added, loading, onClick, disabled, className }) => (
    <button
      type="button"
      key={key}
      className={cx('atp-tile', className, added && 'added is-on', loading && 'loading')}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={added}
    >
      <span className="atp-tile__cover" aria-hidden="true">
        <Icon name={icon} size={28} />
        {/* Over the icon; a cover that fails to load leaves the icon showing. */}
        {cover && <img src={cover} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      </span>
      <span className="atp-tile__icon" aria-hidden="true"><Icon name={icon} size={24} /></span>
      <span className="atp-tile__name name">{name}</span>
      <span className="atp-tile__meta meta">
        <Icon name={access === 'private' ? 'lock' : 'public'} size={14} />
        {count}
      </span>
      {added && (
        <span className="atp-tile__check added-badge">
          <Icon name="check" size={18} />
          <span className="atp-sr">{t('playlists.modal.added')}</span>
        </span>
      )}
      {loading && <Icon name="progress_activity" size={18} className="v2-spin atp-tile__spin" />}
    </button>
  );

  // Design 07a (the sheet) and 41d / 19g (its states): what you save first, then
  // Watch Later and your playlists as tiles with covers, the dashed "New
  // playlist" tile last; saving keeps the sheet open, so one video can go to
  // several playlists, and Done closes it. "New playlist" swaps the tiles for
  // the create form (name, type and kind, privacy, tags).
  // Portalled to the page's <body> (DialogShell): rendered in place it would sit
  // inside the hover-preview overlay (.card-hover-controls), a z-index:4
  // stacking context with pointer-events:none. `isolate` keeps clicks inside
  // from reaching the card that opened it.
  return (
    <DialogShell
      onClose={onClose}
      side
      tone={showCreateForm ? 'accent' : 'cyan'}
      title={showCreateForm ? t('playlists.modal.newPlaylist') : t('common.actions.save')}
      leading={showCreateForm ? (
        <IconButton icon="arrow_back" label={t('common.actions.back')} size={32} variant="ghost" round className="atp-back cancel-btn" onClick={stop(closeForm)} disabled={isCreating} />
      ) : undefined}
      width={430}
      zIndex={1100}
      doc={doc}
      isolate
      overlayClassName="add-to-playlist-overlay"
      className="add-to-playlist-modal"
      bodyClassName="atp-body"
      footer={showCreateForm ? (
        <Button variant="primary" size={48} block className="dlg-main create-btn" trailing="add" onClick={stop(handleCreateAndAdd)} disabled={isCreating || !newPlaylistName.trim()} loading={isCreating}>
          {isCreating ? t('playlists.modal.creating') : t('playlists.modal.createAndAdd')}
        </Button>
      ) : (
        <>
          {savedCount > 0 && <div className="dlg-note is-cyan atp-saved" role="status">{t('playlists.modal.savedTo', { count: savedCount })}</div>}
          <Button variant="inverse" size={48} block next className="dlg-main atp-done" onClick={stop(onClose)}>
            {t('common.actions.done')}
          </Button>
        </>
      )}
    >
      <SheetContext thumb={post.thumbnail} title={videoTitle || permlink} meta={ctxMeta} />

      {showCreateForm ? (
        <div className="atp-create create-form">
          <input
            id={`${fieldId}-name`}
            className="v2-input h48 atp-create__name"
            type="text"
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder={t('playlists.modal.namePlaceholder')}
            aria-label={t('playlists.modal.name')}
            autoFocus
          />
          <div className="atp-types" role="group" aria-label={t('playlists.type.label')}>
            {[
              { type: 'video', icon: 'smart_display', title: t('playlists.type.video'), sub: t('playlists.type.videoSub') },
              { type: 'audio', icon: 'graphic_eq', title: t('playlists.type.audio'), sub: t('playlists.type.audioSub') },
            ].map((o) => {
              const on = (newPlaylistType.type === 'audio') === (o.type === 'audio');
              return (
                <button
                  key={o.type}
                  type="button"
                  className={cx('atp-type', on && 'is-on')}
                  aria-pressed={on}
                  disabled={isCreating}
                  onClick={stop(() => setNewPlaylistType({ type: o.type, kind: o.type === 'audio' ? (newPlaylistType.kind || 'podcast') : null }))}
                >
                  <Icon name={o.icon} size={28} />
                  <b>{o.title}</b>
                  <span>{o.sub}</span>
                </button>
              );
            })}
          </div>
          {newPlaylistType.type === 'audio' && (
            <div className="v2-chips atp-kinds" role="group" aria-label={t('playlists.type.kindLabel')}>
              {AUDIO_KINDS.map((k) => (
                <Chip key={k} size={32} tone="cyan" selected={newPlaylistType.kind === k} disabled={isCreating}
                  onClick={stop(() => setNewPlaylistType({ type: 'audio', kind: k }))}>
                  {t(`playlists.type.kinds.${k}`)}
                </Chip>
              ))}
            </div>
          )}
          <div className="v2-seg is-block atp-privacy" role="group" aria-label={t('playlists.modal.privacy')}>
            {['public', 'private'].map((a) => (
              <button
                key={a}
                type="button"
                className={cx('v2-seg__opt', 'h36', 'privacy-btn', newPlaylistAccess === a && 'is-on active')}
                aria-pressed={newPlaylistAccess === a}
                onClick={stop(() => setNewPlaylistAccess(a))}
              >
                <Icon name={a === 'public' ? 'public' : 'lock'} size={16} /> {t(`playlists.${a}`)}
              </button>
            ))}
          </div>
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
              aria-label={t('playlists.modal.tags')}
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
      ) : (
        <div className="atp-grid">
          {tile({
            key: 'wl',
            className: 'watch-later-btn',
            name: t('playlists.watchLater'),
            access: 'private',
            count: watchLaterPlaylist ? t('common.units.videos', { count: watchLaterPlaylist.items?.length || 0 }) : t('playlists.private'),
            cover: watchLaterPlaylist?.thumbnail,
            icon: 'schedule',
            added: wlAdded,
            loading: isAddingWatchLater,
            onClick: stop(handleWatchLater),
            disabled: busy,
          })}
          {isLoading ? (
            <>
              <div className="atp-tile is-skeleton" aria-hidden="true"><span className="atp-tile__cover" /></div>
              <div className="atp-loading" role="status">
                <Icon name="progress_activity" size={18} className="v2-spin" />
                <span>{t('playlists.modal.loading')}</span>
              </div>
            </>
          ) : others.map((playlist) => {
            const kind = storedPlaylistType(playlist);
            return tile({
              key: playlist.id,
              className: 'playlist-item',
              name: playlist.name,
              access: playlist.access,
              count: t('common.units.videos', { count: playlist.items?.length || 0 }),
              cover: playlist.thumbnail,
              icon: kind.type === 'audio' ? (KIND_ICONS[kind.kind] || 'graphic_eq') : 'playlist_play',
              added: has(playlist),
              loading: isAdding === playlist.id,
              onClick: stop(() => handleAddToPlaylist(playlist)),
              disabled: isAdding !== null,
            });
          })}
          {!isLoading && (
            <button type="button" className="atp-new create-new-btn" onClick={stop(() => setShowCreateForm(true))}>
              <Icon name="add" size={28} />
              {others.length === 0 ? t('playlists.modal.createFirst') : t('playlists.modal.newPlaylist')}
            </button>
          )}
          {!isLoading && others.length === 0 && (
            <p className="atp-empty-note">{t('playlists.modal.noOtherPlaylists')}</p>
          )}
        </div>
      )}
    </DialogShell>
  );
}

export default AddToPlaylistModal;
