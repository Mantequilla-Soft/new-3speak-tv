import { useTranslation } from 'react-i18next';
import { MdDownloadDone, MdPlayArrow, MdPause, MdDeleteOutline, MdClose } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { useDownloads, cancelDownload } from '../../lib/podcastDownloads';
import { fmtBytes } from '../../lib/podcastLibrary';
import { fmtDuration } from '../../lib/podcastFormat';
import PodcastArt from './PodcastArt';
import { forgetDownload } from './downloadActions';
import useOnline from '../../hooks/useOnline';

/**
 * Mine → Downloads: the episodes saved in this browser (lib/podcastDownloads.js),
 * how much room they take, and the ones still downloading. Per browser, so it
 * shows signed out too. Offline a title plays the episode: its page needs the network.
 */
export default function DownloadsSection({ onOpenEpisode }) {
  const { t } = useTranslation();
  const { items, progress, usedBytes, estimate } = useDownloads();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const online = useOnline();
  const running = Object.keys(progress);
  if (!items.length && !running.length) return null;

  const play = (track) => {
    if (audioCurrent?._id === track._id) { audioRequestToggle(); return; }
    if (track.external) audioPlayQueued(track); else audioPlay(track);
  };

  return (
    <section className="pod-section">
      <div className="pod-section-head">
        <h2 className="pod-section-title">
          <MdDownloadDone size={18} />{t('audio.podcasts.downloads.title')}
          {items.length > 0 && <span className="audio-section-count">{items.length}</span>}
        </h2>
      </div>
      <p className="pod-dl-summary">
        {t('audio.podcasts.downloads.total', { size: fmtBytes(usedBytes) })}
        {estimate?.quota > 0 && <> · {t('audio.podcasts.downloads.storage', { used: fmtBytes(estimate.usage), quota: fmtBytes(estimate.quota) })}</>}
        <span className="pod-dl-note">{t('audio.podcasts.downloads.perBrowser')}</span>
      </p>
      <ul className="pod-dl-list">
        {running.filter((id) => !items.some((m) => m.id === id)).map((id) => (
          <li key={id} className="pod-dl-row">
            <span className="pod-dl-info">
              <span className="pod-dl-title">{t('audio.podcasts.downloads.downloading', { pct: Math.round(progress[id] * 100) })}</span>
              <span className="pod-tile-bar pod-dl-bar"><span style={{ width: `${Math.round(progress[id] * 100)}%` }} /></span>
            </span>
            <button type="button" className="pod-icon-btn" onClick={() => cancelDownload(id)} title={t('audio.podcasts.downloads.cancel')} aria-label={t('audio.podcasts.downloads.cancel')}>
              <MdClose size={18} />
            </button>
          </li>
        ))}
        {items.map(({ id, track, bytes }) => {
          const playing = audioCurrent?._id === id && audioIsPlaying;
          return (
            <li key={id} className="pod-dl-row">
              <button type="button" className="pod-tile-cover pod-dl-cover" onClick={() => play(track)} aria-label={playing ? t('audio.podcasts.pause') : t('audio.podcasts.play')}>
                <PodcastArt art={track.art} px={64} />
                <span className={`pod-tile-play${playing ? ' pod-tile-play--on' : ''}`}>{playing ? <MdPause size={20} /> : <MdPlayArrow size={20} />}</span>
              </button>
              <span className="pod-dl-info">
                {track.external
                  ? <button type="button" className="pod-tile-title pod-dl-title" title={track.title} onClick={() => (online ? onOpenEpisode?.(id) : play(track))}>{track.title || t('audio.untitled')}</button>
                  : <span className="pod-dl-title" title={track.title}>{track.title || t('audio.untitled')}</span>}
                <span className="pod-tile-meta">
                  {(track.show || track.owner) && <span>{track.show || `@${track.owner}`}</span>}
                  {track.duration > 0 && <span className="pod-tile-dur">{fmtDuration(track.duration)}</span>}
                  <span>{fmtBytes(bytes)}</span>
                </span>
              </span>
              <button type="button" className="pod-btn pod-dl-remove" onClick={() => forgetDownload(id, t)} aria-label={t('audio.podcasts.downloads.remove')} title={t('audio.podcasts.downloads.remove')}>
                <MdDeleteOutline size={16} /><span>{t('audio.podcasts.downloads.removeShort')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
