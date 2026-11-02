import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MdPlayArrow, MdLibraryMusic, MdPlaylistAdd, MdFiberNew } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { oldestFirst } from '../../lib/slices/createAudioPlayerSlice';
import { isListened, wantProgressFor } from '../../lib/podcastProgress';
import ModalHeader from '../ModalHeader/ModalHeader';
import PremiumBadge from '../PremiumBadge/PremiumBadge';
import { fallbackImg, fixVideoThumbnail } from '../../utils/fixThumbnails';
// Reuse the audio tile styles so playlists look identical to track tiles.
import '../../page/Audio.scss';

/**
 * Compact playlist card for the Audio page rails. Visually identical to
 * AudioTile: hover darkens the cover and shows a plain play arrow.
 *
 * Two ways to queue the album, oldest first: "Add all" (every track) and
 * "Add new" (only the tracks not yet listened to the end). With a mouse they
 * are two buttons on the cover on hover, and a click on the rest of the cover
 * is "Add new" (or all, when every track was heard). A tap asks in a bottom
 * sheet. While something plays the tracks line up at the end of the queue;
 * otherwise the first one starts.
 *
 * The tile loads the listener's progress for its tracks when it shows
 * (wantProgressFor), so a click decides at once and the tap still counts as
 * one for starting audio.
 * Title/author click → open the playlist view.
 */
export default function AudioPlaylistTile({ playlist, kind }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const audioQueueIfPlaying = useAppStore((s) => s.audioQueueIfPlaying);
  const user = useAppStore((s) => s.user);
  const touchRef = useRef(false);
  const [newCount, setNewCount] = useState(null);
  const [asking, setAsking] = useState(false);
  const trackIds = (playlist?.tracks || []).map((tr) => tr._id).join(',');
  useEffect(() => {
    if (trackIds) wantProgressFor(user, trackIds.split(','));
  }, [user, trackIds]);
  useEffect(() => {
    if (!asking) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAsking(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asking]);
  if (!playlist) return null;

  // Through the /img/ cache in the tile's 16:9 shape: covers are stored as the
  // full-size upload.
  const rawCover = playlist.thumbnail || playlist.tracks?.find(tr => tr.thumbnail_url)?.thumbnail_url;
  const cover = rawCover ? fixVideoThumbnail({ thumbnail: rawCover }) : fallbackImg;
  const tracks = oldestFirst(playlist.tracks);
  const freshTracks = () => tracks.filter((tr) => !isListened(useAppStore.getState().user, tr._id));
  const open = (e) => { e?.stopPropagation(); navigate(`/playlist/${playlist.id}`); };

  const queue = (list) => {
    setAsking(false);
    if (!list.length) return;
    if (audioQueueIfPlaying(list)) return;
    list.forEach((tr) => audioAddToQueue(tr));
    audioPlay(list[0], list);
  };
  const addAll = (e) => { e?.stopPropagation(); queue(tracks); };
  const addNew = (e) => { e?.stopPropagation(); queue(freshTracks()); };

  const onCover = (e) => {
    e.stopPropagation();
    const wasTouch = touchRef.current;
    touchRef.current = false;
    if (tracks.length === 0) return open();
    if (wasTouch) {
      setNewCount(freshTracks().length);
      setAsking(true);
      return;
    }
    const fresh = freshTracks();
    queue(fresh.length ? fresh : tracks);
  };

  const noneNew = newCount === 0;

  return (
    <div className="audio-tile audio-playlist-tile" onMouseEnter={() => setNewCount(freshTracks().length)}>
      <div
        className="audio-tile-cover"
        onPointerDown={(e) => { touchRef.current = e.pointerType !== 'mouse'; }}
        onClick={onCover}
      >
        <img src={cover} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        <div className="audio-tile-overlay"><MdPlayArrow size={28} /></div>
        {tracks.length > 0 && (
          <div className="audio-playlist-adds" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="audio-tile-action-btn audio-playlist-add-btn" onClick={addAll}
              title={t('audio.tile.addAll')} aria-label={t('audio.tile.addAll')}>
              <MdPlaylistAdd size={18} />
            </button>
            <button type="button" className="audio-tile-action-btn audio-playlist-add-btn" onClick={addNew} disabled={noneNew}
              title={noneNew ? t('audio.tile.addNewNone') : t('audio.tile.addNew')} aria-label={t('audio.tile.addNew')}>
              <MdFiberNew size={18} />
            </button>
          </div>
        )}
        <span className="audio-playlist-count">
          <MdLibraryMusic size={12} /> {playlist.trackCount}
        </span>
      </div>
      <div className="audio-tile-body">
        <span className="audio-tile-title" title={playlist.name} onClick={open}>{playlist.name}</span>
        <span className="audio-tile-author" onClick={open}>@{playlist.owner}<PremiumBadge username={playlist.owner} size={11} /></span>
        {playlist.album?.musicStyle && (
          <span className="audio-tile-meta">{playlist.album.musicStyle}</span>
        )}
        {kind && (
          <span className={`audio-tile-meta audio-tile-kind audio-tile-kind-${kind}`}>
            {kind === 'artist' ? t('audio.tile.artistAlbum') : t('audio.tile.listenerPlaylist')}
          </span>
        )}
      </div>
      {asking && createPortal(
        <div className="audio-playlist-ask-overlay" onClick={() => setAsking(false)}>
          <div className="audio-playlist-ask" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <ModalHeader title={playlist.name} onClose={() => setAsking(false)} />
            <button type="button" className="audio-playlist-ask-option" onClick={addAll}>
              <MdPlaylistAdd size={22} />
              <span className="audio-playlist-ask-text">
                <strong>{t('audio.tile.addAll')} <span className="audio-playlist-ask-count">{tracks.length}</span></strong>
                <small>{t('audio.tile.addAllHint')}</small>
              </span>
            </button>
            <button type="button" className="audio-playlist-ask-option" onClick={addNew} disabled={noneNew}>
              <MdFiberNew size={22} />
              <span className="audio-playlist-ask-text">
                <strong>{t('audio.tile.addNew')} <span className="audio-playlist-ask-count">{newCount ?? 0}</span></strong>
                <small>{noneNew ? t('audio.tile.addNewNone') : t('audio.tile.addNewHint')}</small>
              </span>
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
