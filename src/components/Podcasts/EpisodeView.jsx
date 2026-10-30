import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdArrowBack, MdPlayArrow, MdPause, MdOpenInNew, MdCheck, MdPodcasts, MdPlaylistAdd, MdPlaylistAddCheck } from 'react-icons/md';
import { BiDollar } from 'react-icons/bi';
import { useAppStore } from '../../lib/store';
import { usePodcastEpisode, useEpisodeNotes, episodeToTrack } from '../../lib/podcasts';
import { usePodcastProgress, progressOf } from '../../lib/podcastProgress';
import { canTipEpisode } from '../../lib/podcastTips';
import { fmtDuration, useDateFormat, sanitizeShowNotes } from '../../lib/podcastFormat';
import PodcastArt from './PodcastArt';
import PodcastTipModal from './PodcastTipModal';

/**
 * One outside podcast episode (/audio?type=external&episode=<id>): what the tile
 * crops, in full. The show notes are read from the feed when the page opens
 * (they are not stored), sanitised, and shown under the episode; until they
 * arrive, or if the feed can't be read, the stored summary stands in.
 */
export default function EpisodeView({ episodeId, user, onOpenShow }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const { data, isLoading, error } = usePodcastEpisode(episodeId);
  const notes = useEpisodeNotes(episodeId);
  usePodcastProgress(user, { ids: [episodeId] });
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const inQueue = useAppStore((s) => s.audioQueue.some((i) => i._id === episodeId));
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const [tipping, setTipping] = useState(false);

  const ep = data?.episode;
  const feed = data?.feed;
  const track = useMemo(() => (ep ? episodeToTrack(ep, feed) : null), [ep, feed]);
  const notesHtml = useMemo(() => sanitizeShowNotes(notes.data), [notes.data]);

  if (isLoading) return <div className="pod-empty">{t('common.status.loading')}</div>;
  if (error || !ep) {
    return (
      <div className="pod-show">
        <button type="button" className="pod-back" onClick={() => onOpenShow(null)}><MdArrowBack size={18} /> {t('audio.podcasts.allPodcasts')}</button>
        <p className="pod-empty">{t('audio.podcasts.episodeMissing')}</p>
      </div>
    );
  }

  const isCurrent = audioCurrent?._id === ep.id;
  const playing = isCurrent && audioIsPlaying;
  const progress = progressOf(ep.id);
  const started = progress && !progress.done && progress.pct > 0;
  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    audioPlayQueued(track);
  };

  return (
    <div className="pod-show pod-episode">
      <button type="button" className="pod-back" onClick={() => onOpenShow(ep.feed_id)}>
        <MdArrowBack size={18} /> {feed?.title || t('audio.podcasts.allPodcasts')}
      </button>

      <header className="pod-show-head">
        <PodcastArt art={ep.art || feed?.art} fallback={feed?.art} px={512} className="pod-show-cover" />
        <div className="pod-show-info">
          <button type="button" className="pod-show-kicker pod-episode-show" onClick={() => onOpenShow(ep.feed_id)}>
            <MdPodcasts size={14} /> {feed?.title || t('audio.podcasts.kicker')}
          </button>
          <h2 className="pod-show-title">{ep.title || t('audio.untitled')}</h2>
          <div className="pod-show-meta">
            {ep.published_at && <span>{fmtDate(ep.published_at)}</span>}
            {ep.duration > 0 && <span className="pod-chip">{fmtDuration(ep.duration)}</span>}
            {progress?.done && <span className="pod-tile-listened"><MdCheck size={13} /> {t('audio.podcasts.listened')}</span>}
            {started && <span className="pod-tile-pct">{t('audio.podcasts.listenedPct', { pct: progress.pct })}</span>}
          </div>
          {(started || progress?.done) && (
            <div className="pod-episode-bar" aria-hidden="true"><span style={{ width: `${progress.pct}%` }} /></div>
          )}
          <div className="pod-show-actions">
            <button type="button" className="pod-btn pod-btn--solid" onClick={play}>
              {playing ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
              {playing ? t('audio.podcasts.pause') : started && !isCurrent ? t('audio.podcasts.resume') : t('audio.podcasts.play')}
            </button>
            <button
              type="button"
              className={`pod-btn${inQueue ? ' pod-btn--on' : ''}`}
              onClick={() => { if (!inQueue) audioAddToQueue(track); }}
              disabled={inQueue}
            >
              {inQueue ? <MdPlaylistAddCheck size={18} /> : <MdPlaylistAdd size={18} />}
              {inQueue ? t('audio.podcasts.inQueue') : t('audio.podcasts.addToQueue')}
            </button>
            {canTipEpisode(track) && (
              <button type="button" className="pod-btn" onClick={() => setTipping(true)}>
                <BiDollar size={16} /> {t('audio.podcasts.tip.button')}
              </button>
            )}
            {ep.link && (
              <a className="pod-btn" href={ep.link} target="_blank" rel="noopener noreferrer nofollow">
                <MdOpenInNew size={16} /> {t('audio.podcasts.episodePage')}
              </a>
            )}
          </div>
        </div>
      </header>

      <section className="pod-section">
        <h2 className="pod-section-title">{t('audio.podcasts.showNotes')}</h2>
        {notesHtml
          // Sanitised by sanitizeShowNotes (DOMPurify: links and formatting only).
          ? <div className="pod-notes" dangerouslySetInnerHTML={{ __html: notesHtml }} />
          : (
            <div className="pod-notes">
              {ep.summary && <p>{ep.summary}</p>}
              {notes.isLoading && <p className="pod-empty">{t('audio.podcasts.notesLoading')}</p>}
              {!notes.isLoading && !ep.summary && <p className="pod-empty">{t('audio.podcasts.noNotes')}</p>}
            </div>
          )}
      </section>

      {tipping && <PodcastTipModal track={track} onClose={() => setTipping(false)} />}
    </div>
  );
}
