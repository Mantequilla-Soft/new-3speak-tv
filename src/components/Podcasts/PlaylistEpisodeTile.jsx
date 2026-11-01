import { useTranslation } from 'react-i18next';
import { MdPlayArrow, MdPause, MdAdd, MdCheck, MdPlaylistPlay } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { PODCAST_PLACEHOLDER } from '../../lib/podcasts';
import { fmtDuration, useDateFormat } from '../../lib/podcastFormat';
import { squareCover } from '../../utils/fixThumbnails';
import './PodcastsTab.scss';

/**
 * One track of an all-audio playlist drawn as a podcast episode tile (the
 * outside podcasts' `.pod-tile`), so a 3Speak podcast looks like any other show.
 *
 * Props:
 *   video        — a playlist item from utils/playlistVideos.js (with `audioDoc`)
 *   item         — the embed-audio doc to play (the album cover already applied)
 *   contextItems — the playlist's tracks, for autoplay of the next one
 *   number       — the track's place in the playlist
 *   onOpen       — opens the track's own audio page
 *   onAddToPlaylist — optional; shows the Playlist button
 */
export default function PlaylistEpisodeTile({ video, item, contextItems, number, onOpen, onAddToPlaylist }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioQueue = useAppStore((s) => s.audioQueue);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const isCurrent = audioCurrent?._id === item._id;
  const playing = isCurrent && audioIsPlaying;
  const queued = audioQueue.some((i) => i._id === item._id);
  // Hive's `created` has no zone; it is UTC.
  const published = item.createdAt || (video.created_at ? `${video.created_at}Z` : null);
  const cover = item.thumbnail_url ? squareCover(item.thumbnail_url, 128) : PODCAST_PLACEHOLDER;

  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    audioPlay(item, contextItems);
  };

  return (
    <li className={`pod-tile${isCurrent ? ' pod-tile--current' : ''}`}>
      <div className="pod-tile-top">
        <button type="button" className="pod-tile-cover" onClick={play} aria-label={playing ? t('audio.podcasts.pause') : t('audio.podcasts.play')}>
          <img className="pod-art" src={cover} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = PODCAST_PLACEHOLDER; }} />
          <span className={`pod-tile-play${playing ? ' pod-tile-play--on' : ''}`}>{playing ? <MdPause size={24} /> : <MdPlayArrow size={24} />}</span>
        </button>
        <div className="pod-tile-head">
          <button type="button" className="pod-tile-title" title={video.title || item.title} onClick={onOpen}>
            {video.title || item.title || t('audio.untitled')}
          </button>
          <div className="pod-tile-meta">
            {number != null && <span className="pod-badge">#{number}</span>}
            {published && <span>{fmtDate(published)}</span>}
            {item.duration > 0 && <span className="pod-tile-dur">{item.duration >= 60 ? fmtDuration(item.duration) : '<1m'}</span>}
          </div>
        </div>
      </div>
      {video.summary && (
        <button type="button" className="pod-tile-summary" onClick={onOpen} title={t('audio.podcasts.openEpisode')}>{video.summary}</button>
      )}
      <div className="pod-tile-actions">
        <button
          type="button"
          className={`pod-icon-btn${queued ? ' pod-icon-btn--on' : ''}`}
          onClick={() => audioAddToQueue(item)}
          disabled={queued}
          title={queued ? t('audio.podcasts.inQueue') : t('audio.podcasts.addToQueue')}
          aria-label={queued ? t('audio.podcasts.inQueue') : t('audio.podcasts.addToQueue')}
        >
          {queued ? <MdCheck size={18} /> : <MdAdd size={18} />}
        </button>
        {onAddToPlaylist && (
          <button type="button" className="pod-icon-btn" onClick={onAddToPlaylist} title={t('audio.tile.playlist')} aria-label={t('audio.tile.playlist')}>
            <MdPlaylistPlay size={18} />
          </button>
        )}
      </div>
    </li>
  );
}
