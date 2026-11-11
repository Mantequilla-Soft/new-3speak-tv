import { Icon } from '../v2/Icon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { episodeToTrack } from '../../lib/podcasts';
import PodcastTipModal from './PodcastTipModal';
import PodcastArt from './PodcastArt';
import { fmtDuration, useDateFormat } from '../../lib/podcastFormat';
import { canTipEpisode } from '../../lib/podcastTips';
import { progressOf } from '../../lib/podcastProgress';
import { EpisodeBadges, DownloadButton } from './PodcastBits';
import './PodcastsTab.scss';

/**
 * One outside episode as a tile. `contextItems` (a 3Speak playlist's tracks, this
 * one among them) makes play start that list here; without it the episode plays
 * next to whatever is queued.
 */
export function EpisodeTile({ ep, feed, showShow = true, onOpenShow, onOpenEpisode, contextItems }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const [tipping, setTipping] = useState(false);
  const track = useMemo(() => episodeToTrack(ep, feed), [ep, feed]);
  const isCurrent = audioCurrent?._id === ep.id;
  const playing = isCurrent && audioIsPlaying;
  const progress = progressOf(ep.id);
  const started = progress && (progress.done || progress.pct > 0);

  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    if (useAppStore.getState().audioQueueIfPlaying(track)) return;
    if (contextItems) audioPlay(track, contextItems);
    else audioPlayQueued(track);
  };

  return (
    <li className={`pod-tile${isCurrent ? ' pod-tile--current' : ''}${progress?.done ? ' pod-tile--done' : ''}`}>
      <div className="pod-tile-top">
        <button type="button" className="pod-tile-cover" onClick={play} aria-label={playing ? t('audio.podcasts.pause') : t('audio.podcasts.play')}>
          <PodcastArt art={ep.art || feed?.art} px={128} />
          <span className={`pod-tile-play${playing ? ' pod-tile-play--on' : ''}`}>{playing ? <Icon name="pause" size={24} fill /> : <Icon name="play_arrow" size={24} fill />}</span>
        </button>
        <div className="pod-tile-head">
          {showShow && feed && (
            <button type="button" className="pod-tile-show" onClick={() => onOpenShow?.(ep.feed_id)}>{feed.title}</button>
          )}
          <button type="button" className="pod-tile-title" title={ep.title} onClick={() => onOpenEpisode?.(ep.id)}>{ep.title || t('audio.untitled')}</button>
          <div className="pod-tile-meta">
            <EpisodeBadges ep={ep} />
            {ep.published_at && <span>{fmtDate(ep.published_at)}</span>}
            {ep.duration > 0 && <span className="pod-tile-dur">{fmtDuration(ep.duration)}</span>}
            {progress?.done && <span className="pod-tile-listened"><Icon name="check" size={14} /> {t('audio.podcasts.listened')}</span>}
            {started && !progress.done && <span className="pod-tile-pct">{t('audio.podcasts.listenedPct', { pct: progress.pct })}</span>}
          </div>
        </div>
      </div>
      {/* Cropped here; the whole show notes are on the episode page. */}
      {ep.summary && (
        <button type="button" className="pod-tile-summary" onClick={() => onOpenEpisode?.(ep.id)} title={t('audio.podcasts.openEpisode')}>{ep.summary}</button>
      )}
      <div className="pod-tile-actions">
        <DownloadButton track={track} />
        {canTipEpisode(track) && (
          <button type="button" className="pod-icon-btn pod-icon-btn--tip" onClick={() => setTipping(true)} title={t('audio.podcasts.tip.button')} aria-label={t('audio.podcasts.tip.button')}>
            <Icon name="volunteer_activism" size={18} />
          </button>
        )}
        {ep.link && (
          <a className="pod-icon-btn" href={ep.link} target="_blank" rel="noopener noreferrer nofollow" title={t('audio.podcasts.episodePage')} aria-label={t('audio.podcasts.episodePage')}>
            <Icon name="open_in_new" size={16} />
          </a>
        )}
      </div>
      {started && (
        <div
          className="pod-tile-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          aria-label={t('audio.podcasts.listenedPct', { pct: progress.pct })}
        >
          <span style={{ width: `${progress.pct}%` }} />
        </div>
      )}
      {tipping && <PodcastTipModal track={track} onClose={() => setTipping(false)} />}
    </li>
  );
}
