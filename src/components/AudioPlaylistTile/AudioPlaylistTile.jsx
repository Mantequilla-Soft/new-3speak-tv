import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MdPlayArrow, MdLibraryMusic } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import PremiumBadge from '../PremiumBadge/PremiumBadge';
import { fallbackImg } from '../../utils/fixThumbnails';
// Reuse the audio tile styles so playlists look identical to track tiles.
import '../../page/Audio.scss';

/**
 * Compact playlist card for the Audio page rails. Visually identical to
 * AudioTile: hover darkens the cover and shows a plain play arrow.
 *
 * Cover click → queue the whole album and start track 1 (no navigation).
 * Title/author click → open the playlist view.
 */
export default function AudioPlaylistTile({ playlist, kind }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  if (!playlist) return null;

  const cover = playlist.thumbnail || playlist.tracks?.find(tr => tr.thumbnail_url)?.thumbnail_url || fallbackImg;
  const tracks = playlist.tracks || [];
  const open = (e) => { e?.stopPropagation(); navigate(`/playlist/${playlist.id}`); };
  const playAlbum = (e) => {
    e.stopPropagation();
    if (tracks.length === 0) return open();
    // Put every track in the queue, then start track 1.
    tracks.forEach((tr) => audioAddToQueue(tr));
    audioPlay(tracks[0], tracks);
  };

  return (
    <div className="audio-tile audio-playlist-tile">
      <div className="audio-tile-cover" onClick={playAlbum}>
        <img src={cover} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        <div className="audio-tile-overlay"><MdPlayArrow size={28} /></div>
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
    </div>
  );
}
