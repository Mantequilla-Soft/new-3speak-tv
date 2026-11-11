import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { Dialog } from '../v2/ui';
import { useAppStore } from '../../lib/store';
import { oldestFirst } from '../../lib/slices/createAudioPlayerSlice';
import { isListened, wantProgressFor } from '../../lib/podcastProgress';
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
  if (!playlist) return null;

  // Through the /img/ cache in the tile's 16:9 shape: covers are stored as the
  // full-size upload.
  // The cover is a 2 by 2 collage of four different track covers (28e); with
  // fewer, the playlist's own cover (or the first track's) fills the square.
  const trackCovers = [...new Set((playlist.tracks || []).map(tr => tr.thumbnail_url).filter(Boolean))]
    .slice(0, 4).map(u => fixVideoThumbnail({ thumbnail: u }));
  const own = playlist.thumbnail ? fixVideoThumbnail({ thumbnail: playlist.thumbnail }) : null;
  const collage = trackCovers.length >= 4 ? trackCovers : [own || trackCovers[0] || null];
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
        <span className={`audio-playlist-collage${collage.length === 1 ? ' is-single' : ''}`} aria-hidden="true">
          {collage.map((src, i) => (
            <span key={i} className="audio-playlist-collage__cell">
              {src && <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />}
            </span>
          ))}
        </span>
        {tracks.length > 0 && (
          <div className="audio-playlist-adds" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="audio-playlist-add-btn is-primary" onClick={addAll}
              title={t('audio.tile.addAllHint')} aria-label={t('audio.tile.addAll')}>
              <Icon name="playlist_add" size={16} /><span>{t('audio.tile.addAll')}</span>
            </button>
            <button type="button" className="audio-playlist-add-btn" onClick={addNew} disabled={noneNew}
              title={noneNew ? t('audio.tile.addNewNone') : t('audio.tile.addNewHint')} aria-label={t('audio.tile.addNew')}>
              <Icon name="fiber_new" size={16} /><span>{t('audio.tile.addNew')}</span>
            </button>
          </div>
        )}
      </div>
      <div className="audio-tile-body">
        {kind && (
          <span className={`v2-eyebrow is-cyan audio-tile-kind audio-tile-kind-${kind}`}>
            {kind === 'artist' ? t('audio.tile.artistAlbum') : t('audio.tile.listenerPlaylist')}
          </span>
        )}
        <span className="audio-tile-title" title={playlist.name} onClick={open}>{playlist.name}</span>
        <span className="audio-playlist-meta num" onClick={open}>
          {t('audio.page.tracks', { count: playlist.trackCount ?? tracks.length })}
          <span className="audio-playlist-owner">· @{playlist.owner}<PremiumBadge username={playlist.owner} size={11} /></span>
        </span>
      </div>
      <Dialog open={asking} onClose={() => setAsking(false)} title={playlist.name} sub={t('audio.page.tracks', { count: tracks.length })} closeLabel={t('common.actions.close')} className="audio-playlist-ask">
        <button type="button" className="v2-choice audio-playlist-ask-option" onClick={addAll}>
          <Icon name="playlist_add" size={20} className="v2-choice__icon" />
          <span className="v2-choice__body">
            <b>{t('audio.tile.addAll')} <span className="audio-playlist-ask-count num">{tracks.length}</span></b>
            <span>{t('audio.tile.addAllHint')}</span>
          </span>
        </button>
        <button type="button" className="v2-choice audio-playlist-ask-option" onClick={addNew} disabled={noneNew}>
          <Icon name="fiber_new" size={20} className="v2-choice__icon" />
          <span className="v2-choice__body">
            <b>{t('audio.tile.addNew')} <span className="audio-playlist-ask-count num">{newCount ?? 0}</span></b>
            <span>{noneNew ? t('audio.tile.addNewNone') : t('audio.tile.addNewHint')}</span>
          </span>
        </button>
      </Dialog>
    </div>
  );
}
