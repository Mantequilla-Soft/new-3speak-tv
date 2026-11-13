import { Icon } from '../v2/Icon';
import { useTranslation } from 'react-i18next';
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
    <section className="pod-section pod-downloads">
      <div className="pod-app-head pod-downloads-head">
        <h2 className="pod-app-title is-eyebrow">{t('audio.podcasts.filters.downloaded')}</h2>
        {usedBytes > 0 && <span className="pod-downloads-size num">{fmtBytes(usedBytes)}</span>}
      </div>
      <ul className="pod-dl-list">
        {running.filter((id) => !items.some((m) => m.id === id)).map((id) => (
          <li key={id} className="pod-dl-row">
            <span className="pod-dl-cover pod-dl-cover--busy" aria-hidden="true"><Icon name="download" size={20} /></span>
            <span className="pod-dl-info">
              <span className="pod-dl-title">{t('audio.podcasts.downloads.downloading', { pct: Math.round(progress[id] * 100) })}</span>
              <span className="pod-tile-bar pod-dl-bar"><span style={{ width: `${Math.round(progress[id] * 100)}%` }} /></span>
            </span>
            <button type="button" className="pod-icon-btn pod-icon-btn--lg" onClick={() => cancelDownload(id)} title={t('audio.podcasts.downloads.cancel')} aria-label={t('audio.podcasts.downloads.cancel')}>
              <Icon name="close" size={20} />
            </button>
          </li>
        ))}
        {items.map(({ id, track, bytes }) => {
          const playing = audioCurrent?._id === id && audioIsPlaying;
          const sub = [fmtBytes(bytes), track.duration > 0 ? fmtDuration(track.duration) : null].filter(Boolean).join(' · ');
          return (
            <li key={id} className="pod-dl-row">
              <button type="button" className="pod-tile-cover pod-dl-cover" onClick={() => play(track)} aria-label={playing ? t('audio.podcasts.pause') : t('audio.podcasts.play')}>
                <PodcastArt art={track.art} px={128} />
                <span className={`pod-tile-play${playing ? ' pod-tile-play--on' : ''}`}>{playing ? <Icon name="pause" size={20} fill /> : <Icon name="play_arrow" size={20} fill />}</span>
              </button>
              <span className="pod-dl-info">
                {track.external
                  ? <button type="button" className="pod-tile-title pod-dl-title" title={track.title} onClick={() => (online ? onOpenEpisode?.(id) : play(track))}>{track.title || t('audio.untitled')}</button>
                  : <span className="pod-dl-title" title={track.title}>{track.title || t('audio.untitled')}</span>}
                <span className="pod-dl-sub num" title={track.show || (track.owner ? `@${track.owner}` : undefined)}>{sub}</span>
              </span>
              <button type="button" className="pod-icon-btn pod-icon-btn--lg" onClick={() => forgetDownload(id, t)} aria-label={t('audio.podcasts.downloads.remove')} title={t('audio.podcasts.downloads.remove')}>
                <Icon name="delete" size={20} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="pod-dl-summary">
        <Icon name="sd_storage" size={20} />
        <span>
          {t('audio.podcasts.downloads.total', { size: fmtBytes(usedBytes) })}
          {estimate?.quota > 0 && <> · {t('audio.podcasts.downloads.storage', { used: fmtBytes(estimate.usage), quota: fmtBytes(estimate.quota) })}</>}
          <span className="pod-dl-note">{t('audio.podcasts.downloads.perBrowser')}</span>
        </span>
      </p>
    </section>
  );
}
