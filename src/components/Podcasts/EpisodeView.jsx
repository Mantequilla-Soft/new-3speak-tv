import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MdArrowBack, MdPlayArrow, MdPause, MdOpenInNew, MdCheck, MdPodcasts, MdPlaylistAdd, MdPlaylistAddCheck,
  MdLink, MdOndemandVideo, MdClose, MdBolt, MdFormatListBulleted, MdShare,
} from 'react-icons/md';
import { BiDollar } from 'react-icons/bi';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { notifyMediaPlay, onMediaPlay } from '../../utils/mediaCoordinator';
import { usePodcastEpisode, useEpisodeNotes, episodeToTrack, episodePath } from '../../lib/podcasts';
import { usePodcastProgress, progressOf, recordProgress, flushProgress, resumePosition } from '../../lib/podcastProgress';
import { fetchChapters } from '../../lib/podcastMedia';
import { useDownloads } from '../../lib/podcastDownloads';
import { fmtClock, episodeShareUrl, deepLinkTimes } from '../../lib/podcastLibrary';
import { canTipEpisode } from '../../lib/podcastTips';
import { fmtDuration, useDateFormat, sanitizeShowNotes } from '../../lib/podcastFormat';
import PodcastArt from './PodcastArt';
import PodcastTipModal from './PodcastTipModal';
import { EpisodeBadges, DownloadButton, PersonsRow, PrivateBadge } from './PodcastBits';

async function copyLink(url, t) {
  try {
    await navigator.clipboard.writeText(url);
    toastIn('Podcasts').success(t('audio.podcasts.share.copied'));
  } catch {
    toastIn('Podcasts').error(t('audio.podcasts.share.failed'));
  }
}

/**
 * The video version of an episode (alternateEnclosure video, or a video
 * enclosure), inline. While it plays the global audio player pauses, and the
 * other way round (utils/mediaCoordinator.js); how far you got is kept like
 * for the audio (lib/podcastProgress.js), so either one resumes from there.
 */
function EpisodeVideo({ ep, user }) {
  const ref = useRef(null);
  useEffect(() => onMediaPlay('video', () => {
    const el = ref.current;
    if (el && !el.paused) el.pause();
  }), []);
  const dur = (el) => ep.duration || (Number.isFinite(el.duration) ? el.duration : 0);
  return (
    <video
      ref={ref}
      className="pod-video"
      src={ep.video.url}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => {
        const at = resumePosition(user, ep.id);
        if (at > 0) e.currentTarget.currentTime = at;
      }}
      onPlay={() => notifyMediaPlay('video')}
      onTimeUpdate={(e) => recordProgress(user, ep.id, e.currentTarget.currentTime, dur(e.currentTarget))}
      onPause={() => flushProgress()}
      onEnded={(e) => { recordProgress(user, ep.id, dur(e.currentTarget), dur(e.currentTarget)); flushProgress(); }}
    />
  );
}

/**
 * One outside podcast episode (/audio?type=external&episode=<id>): what the tile
 * crops, in full. The show notes are read from the feed when the page opens
 * (they are not stored), sanitised, and shown under the episode; until they
 * arrive, or if the feed can't be read, the stored summary stands in.
 *
 * A shared link may carry &t= (start there) and &end= (stop there, a clip): the
 * page then offers "Play from 12:34". Never on its own: browsers block sound
 * that starts without a click.
 */
export default function EpisodeView({ episodeId, user, onOpenShow }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const [params] = useSearchParams();
  const deep = useMemo(() => deepLinkTimes(params), [params]);
  const { data, isLoading, error } = usePodcastEpisode(episodeId, user);
  const notes = useEpisodeNotes(episodeId);
  usePodcastProgress(user, { ids: [episodeId] });
  useDownloads();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioPlayAt = useAppStore((s) => s.audioPlayAt);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const audioRequestSeek = useAppStore((s) => s.audioRequestSeek);
  const inQueue = useAppStore((s) => s.audioQueue.some((i) => i._id === episodeId));
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const isCurrent = audioCurrent?._id === episodeId;
  // Whole seconds only, so the share button does not re-render the page at every tick.
  const currentSec = useAppStore((s) => (s.audioCurrent?._id === episodeId ? Math.floor(s.audioCurrentTime || 0) : 0));
  const [tipping, setTipping] = useState(false);
  const [video, setVideo] = useState(false);
  const [deepUsed, setDeepUsed] = useState(false);

  const ep = data?.episode;
  const feed = data?.feed;
  const track = useMemo(() => (ep ? episodeToTrack(ep, feed) : null), [ep, feed]);
  const notesHtml = useMemo(() => sanitizeShowNotes(notes.data), [notes.data]);
  const chapters = useQuery({
    queryKey: ['podcasts', 'chapters', episodeId],
    enabled: !!ep?.chapters,
    queryFn: () => fetchChapters(episodeId),
    staleTime: 30 * 60 * 1000,
  });

  if (isLoading) return <div className="pod-empty">{t('common.status.loading')}</div>;
  if (error || !ep) {
    return (
      <div className="pod-show">
        <button type="button" className="pod-back" onClick={() => onOpenShow(null)}><MdArrowBack size={18} /> {t('audio.podcasts.allPodcasts')}</button>
        <p className="pod-empty">{t('audio.podcasts.episodeMissing')}</p>
      </div>
    );
  }

  const playing = isCurrent && audioIsPlaying;
  const progress = progressOf(ep.id);
  const started = progress && !progress.done && progress.pct > 0;
  const deepOpen = deep.t != null && !deepUsed && !isCurrent;
  const playDeep = () => { setDeepUsed(true); audioPlayAt(track, deep.t, deep.end); };
  const deepLabel = deep.end != null
    ? t('audio.podcasts.deepLink.playClip', { from: fmtClock(deep.t), to: fmtClock(deep.end) })
    : t('audio.podcasts.deepLink.playFrom', { time: fmtClock(deep.t) });
  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    if (deepOpen) { playDeep(); return; }
    audioPlayQueued(track);
  };
  // A chapter or a highlight: seek when this episode is already in the player.
  const playFrom = (start, end) => {
    if (isCurrent && end == null) {
      audioRequestSeek(start);
      if (!audioIsPlaying) audioRequestToggle();
      return;
    }
    audioPlayAt(track, start, end);
  };
  const link = (from, to) => episodeShareUrl(window.location.origin, episodePath(ep.id), from, to);
  const shareAt = isCurrent && currentSec > 0 ? currentSec : 0;
  const soundbites = (ep.soundbites || []).filter((b) => b.duration > 0);
  const chapterList = chapters.data || [];

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
            <EpisodeBadges ep={ep} />
            {(ep.private || feed?.private) && <PrivateBadge withText />}
            {ep.published_at && <span>{fmtDate(ep.published_at)}</span>}
            {ep.duration > 0 && <span className="pod-chip">{fmtDuration(ep.duration)}</span>}
            {progress?.done && <span className="pod-tile-listened"><MdCheck size={13} /> {t('audio.podcasts.listened')}</span>}
            {started && <span className="pod-tile-pct">{t('audio.podcasts.listenedPct', { pct: progress.pct })}</span>}
          </div>
          {(started || progress?.done) && (
            <div className="pod-episode-bar" aria-hidden="true"><span style={{ width: `${progress.pct}%` }} /></div>
          )}
          <div className="pod-show-actions">
            <button type="button" className={`pod-btn ${deepOpen ? 'pod-btn--primary' : 'pod-btn--solid'}`} onClick={play}>
              {playing ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
              {playing
                ? t('audio.podcasts.pause')
                : deepOpen ? deepLabel
                  : started && !isCurrent ? t('audio.podcasts.resume') : t('audio.podcasts.play')}
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
            <DownloadButton track={track} variant="button" />
            {ep.video?.url && (
              <button type="button" className={`pod-btn${video ? ' pod-btn--on' : ''}`} aria-pressed={video} onClick={() => setVideo((v) => !v)}>
                {video ? <MdClose size={16} /> : <MdOndemandVideo size={16} />}
                {video ? t('audio.podcasts.video.hide') : t('audio.podcasts.video.watch')}
              </button>
            )}
            <button type="button" className="pod-btn" onClick={() => copyLink(link(shareAt), t)}>
              {shareAt ? <MdShare size={16} /> : <MdLink size={16} />}
              {shareAt ? t('audio.podcasts.share.copyAt', { time: fmtClock(shareAt) }) : t('audio.podcasts.share.copy')}
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

      {video && ep.video?.url && <EpisodeVideo ep={ep} user={user} />}

      {soundbites.length > 0 && (
        <section className="pod-section">
          <h2 className="pod-section-title"><MdBolt size={18} />{t('audio.podcasts.highlights.title')}</h2>
          <ul className="pod-marks">
            {soundbites.map((b) => (
              <li key={`${b.start}-${b.duration}`} className="pod-mark">
                <button type="button" className="pod-mark-play" onClick={() => playFrom(b.start, b.start + b.duration)} aria-label={t('audio.podcasts.highlights.play')}>
                  <MdPlayArrow size={18} />
                  <span className="pod-mark-time">{fmtClock(b.start)}</span>
                  <span className="pod-mark-title">{b.title || t('audio.podcasts.highlights.untitled', { time: fmtClock(b.start) })}</span>
                  <span className="pod-mark-len">{fmtClock(b.duration)}</span>
                </button>
                <button
                  type="button"
                  className="pod-icon-btn"
                  onClick={() => copyLink(link(b.start, b.start + b.duration), t)}
                  title={t('audio.podcasts.share.clip')}
                  aria-label={t('audio.podcasts.share.clip')}
                >
                  <MdLink size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ep.chapters && (
        <section className="pod-section">
          <h2 className="pod-section-title"><MdFormatListBulleted size={18} />{t('audio.podcasts.chapters.title')}</h2>
          {chapters.isLoading && <p className="pod-empty">{t('audio.podcasts.chapters.loading')}</p>}
          {!chapters.isLoading && chapterList.length === 0 && <p className="pod-empty">{t('audio.podcasts.chapters.none')}</p>}
          <ol className="pod-marks">
            {chapterList.map((c, i) => {
              const now = isCurrent && currentSec >= c.start && (chapterList[i + 1] ? currentSec < chapterList[i + 1].start : true);
              return (
                <li key={`${c.start}-${i}`} className={`pod-mark${now ? ' pod-mark--now' : ''}`}>
                  <button type="button" className="pod-mark-play" onClick={() => playFrom(c.start)} aria-current={now || undefined}>
                    <MdPlayArrow size={18} />
                    <span className="pod-mark-time">{fmtClock(c.start)}</span>
                    <span className="pod-mark-title">{c.title}</span>
                  </button>
                  {/^https?:\/\//i.test(c.url || '') && (
                    <a className="pod-icon-btn" href={c.url} target="_blank" rel="noopener noreferrer nofollow" title={t('audio.podcasts.chapters.link')} aria-label={t('audio.podcasts.chapters.link')}>
                      <MdOpenInNew size={16} />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <PersonsRow persons={ep.persons?.length ? ep.persons : feed?.persons} />

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
