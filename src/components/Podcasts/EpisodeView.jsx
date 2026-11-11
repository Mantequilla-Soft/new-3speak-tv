import { Icon } from '../v2/Icon';
import { EmptyState } from '../v2/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { notifyMediaPlay, onMediaPlay } from '../../utils/mediaCoordinator';
import { usePodcastEpisode, useEpisodeNotes, episodeToTrack, episodePath, fetchPrivateChapters, threeSpeakPost } from '../../lib/podcasts';
import { usePodcastProgress, progressOf, recordProgress, flushProgress, resumePosition } from '../../lib/podcastProgress';
import { fetchChapters } from '../../lib/podcastMedia';
import { useDownloads } from '../../lib/podcastDownloads';
import { fmtClock, episodeShareUrl, deepLinkTimes } from '../../lib/podcastLibrary';
import { canTipEpisode } from '../../lib/podcastTips';
import { fmtDuration, useDateFormat, sanitizeShowNotes } from '../../lib/podcastFormat';
import PodcastArt from './PodcastArt';
import PodcastTipModal from './PodcastTipModal';
import { EpisodeBadges, DownloadButton, PersonsRow, PrivateBadge } from './PodcastBits';
import { isLoggedIn } from '../../hive-api/aioha';
import { getUersContent } from '../../utils/hiveUtils';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import BlogContent from '../playVideo/BlogContent';
import TipModal from '../tip-reward/TipModal';

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
 *
 * A 3Speak episode (a 3Speak RSS feed followed as an outside show) gets what the
 * 3Speak audio page has (components/AudioItem/AudioItemView.jsx): payout, Vote,
 * Comments, the Hive tip, and its Hive post, rendered, as the show notes.
 */
export default function EpisodeView({ episodeId, user, onOpenShow }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fmtDate = useDateFormat();
  const [params] = useSearchParams();
  const deep = useMemo(() => deepLinkTimes(params), [params]);
  const { data, isLoading, error } = usePodcastEpisode(episodeId, user);
  const notes = useEpisodeNotes(episodeId, user);
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
  const authenticated = useAppStore((s) => s.authenticated);
  const loggedIn = authenticated && isLoggedIn();
  const [hiveTipping, setHiveTipping] = useState(false);
  const [voting, setVoting] = useState(false);
  const [votedNow, setVotedNow] = useState(false);
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState(0);
  const [accountData, setAccountData] = useState(null);

  const ep = data?.episode;
  const feed = data?.feed;
  const track = useMemo(() => (ep ? episodeToTrack(ep, feed) : null), [ep, feed]);
  const hive = useMemo(() => threeSpeakPost(ep?.link), [ep?.link]);
  // The Hive post behind a 3Speak episode: its votes, payout and comments.
  const { data: post } = useQuery({
    queryKey: ['audio-item-post', hive?.author, hive?.permlink],
    enabled: !!hive,
    queryFn: () => getUersContent(hive.author, hive.permlink),
    staleTime: 60 * 1000,
  });
  const notesHtml = useMemo(() => sanitizeShowNotes(notes.data), [notes.data]);
  const chapters = useQuery({
    queryKey: ['podcasts', 'chapters', episodeId, user || ''],
    enabled: !!ep?.chapters,
    // A private feed's chapters need the vouch; everyone else's come from the shared cache.
    queryFn: () => (track?.private ? fetchPrivateChapters(episodeId, user) : fetchChapters(episodeId)),
    staleTime: 30 * 60 * 1000,
  });

  if (isLoading) return <div className="pod-empty">{t('common.status.loading')}</div>;
  if (error || !ep) {
    return (
      <div className="pod-show">
        <button type="button" className="pod-back" onClick={() => onOpenShow(null)}><Icon name="arrow_back" size={18} /> {t('audio.podcasts.allPodcasts')}</button>
        <EmptyState className="pod-missing" icon="music_off" title={t('audio.podcasts.episodeMissing')} />
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
  const votes = post?.active_votes || [];
  const voted = votedNow || (!!user && votes.some((v) => v.voter === user));
  const voteCount = votes.length + (votedNow && !votes.some((v) => v.voter === user) ? 1 : 0);
  const payout = post
    ? (parseFloat(post.pending_payout_value || 0) > 0
      ? parseFloat(post.pending_payout_value)
      : parseFloat(post.total_payout_value || 0) + parseFloat(post.curator_payout_value || 0))
    : 0;
  // Comments live on the post's 3Speak page: the audio one, or the video one.
  const postPage = hive && (String(ep.mime || '').startsWith('video/')
    ? `/watch?v=${hive.author}/${hive.permlink}`
    : `/audio/${hive.author}/${hive.permlink}`);
  const chapterList = chapters.data || [];

  return (
    <div className="pod-show pod-episode">
      <button type="button" className="pod-back" onClick={() => onOpenShow(ep.feed_id)}>
        <Icon name="arrow_back" size={18} /> {feed?.title || t('audio.podcasts.allPodcasts')}
      </button>

      <header className="pod-show-head">
        <PodcastArt art={ep.art || feed?.art} fallback={feed?.art} px={512} className="pod-show-cover" />
        <div className="pod-show-info">
          <button type="button" className="pod-show-kicker pod-episode-show" onClick={() => onOpenShow(ep.feed_id)}>
            <Icon name="podcasts" size={14} /> {feed?.title || t('audio.podcasts.kicker')}
          </button>
          <h2 className="pod-show-title">{ep.title || t('audio.untitled')}</h2>
          <div className="pod-show-meta">
            <EpisodeBadges ep={ep} />
            {(ep.private || feed?.private) && <PrivateBadge withText />}
            {ep.published_at && <span>{fmtDate(ep.published_at)}</span>}
            {ep.duration > 0 && <span className="pod-chip">{fmtDuration(ep.duration)}</span>}
            {progress?.done && <span className="pod-tile-listened"><Icon name="check" size={14} /> {t('audio.podcasts.listened')}</span>}
            {started && <span className="pod-tile-pct">{t('audio.podcasts.listenedPct', { pct: progress.pct })}</span>}
            {post && <PayoutAmount amount={payout} size={13} />}
          </div>
          {(started || progress?.done) && (
            <div className="pod-episode-bar" aria-hidden="true"><span style={{ width: `${progress.pct}%` }} /></div>
          )}
          <div className="pod-show-actions">
            <button type="button" className={`pod-btn ${deepOpen ? 'pod-btn--primary' : 'pod-btn--solid'}`} onClick={play}>
              {playing ? <Icon name="pause" size={18} fill /> : <Icon name="play_arrow" size={18} fill />}
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
              {inQueue ? <Icon name="playlist_add_check" size={18} /> : <Icon name="playlist_add" size={18} />}
              {inQueue ? t('audio.podcasts.inQueue') : t('audio.podcasts.addToQueue')}
            </button>
            {hive && (
              <button
                type="button"
                className={`pod-btn${voted ? ' pod-btn--on' : ''}`}
                onClick={() => {
                  if (!loggedIn) { toastIn('Post').error(t('audio.post.signInToVote')); return; }
                  setVoting((v) => !v);
                }}
              >
                <Icon name="thumb_up" size={16} /> {voted ? t('audio.post.voted') : t('audio.post.vote')}
                {voteCount > 0 && <span className="pod-btn-count">{voteCount}</span>}
              </button>
            )}
            <DownloadButton track={track} variant="button" />
            {ep.video?.url && (
              <button type="button" className={`pod-btn${video ? ' pod-btn--on' : ''}`} aria-pressed={video} onClick={() => setVideo((v) => !v)}>
                {video ? <Icon name="close" size={16} /> : <Icon name="smart_display" size={16} />}
                {video ? t('audio.podcasts.video.hide') : t('audio.podcasts.video.watch')}
              </button>
            )}
            <button type="button" className="pod-btn" onClick={() => copyLink(link(shareAt), t)}>
              {shareAt ? <Icon name="ios_share" size={16} /> : <Icon name="link" size={16} />}
              {shareAt ? t('audio.podcasts.share.copyAt', { time: fmtClock(shareAt) }) : t('audio.podcasts.share.copy')}
            </button>
            {/* Signed out, the tip window opens on Lightning: no Hive account needed. */}
            {hive && user !== hive.author && (
              <button type="button" className="pod-btn" onClick={() => setHiveTipping(true)}>
                <Icon name="volunteer_activism" size={16} /> {t('audio.post.tip')}
              </button>
            )}
            {!hive && canTipEpisode(track) && (
              <button type="button" className="pod-btn" onClick={() => setTipping(true)}>
                <Icon name="volunteer_activism" size={16} /> {t('audio.podcasts.tip.button')}
              </button>
            )}
            {hive && (
              <button type="button" className="pod-btn" onClick={() => navigate(postPage)}>
                <Icon name="forum" size={16} /> {t('audio.item.comments')}
                {post?.children > 0 && <span className="pod-btn-count">{post.children}</span>}
              </button>
            )}
            {ep.link && (
              <a className="pod-btn" href={ep.link} target="_blank" rel="noopener noreferrer nofollow">
                <Icon name="open_in_new" size={16} /> {t('audio.podcasts.episodePage')}
              </a>
            )}
          </div>
        </div>
      </header>

      {video && ep.video?.url && <EpisodeVideo ep={ep} user={user} />}

      {soundbites.length > 0 && (
        <section className="pod-section">
          <h2 className="pod-section-title"><Icon name="bolt" size={18} />{t('audio.podcasts.highlights.title')}</h2>
          <ul className="pod-marks">
            {soundbites.map((b) => (
              <li key={`${b.start}-${b.duration}`} className="pod-mark">
                <button type="button" className="pod-mark-play" onClick={() => playFrom(b.start, b.start + b.duration)} aria-label={t('audio.podcasts.highlights.play')}>
                  <Icon name="play_arrow" size={18} fill />
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
                  <Icon name="link" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ep.chapters && (
        <section className="pod-section">
          <h2 className="pod-section-title"><Icon name="format_list_bulleted" size={18} />{t('audio.podcasts.chapters.title')}</h2>
          {chapters.isLoading && <p className="pod-empty">{t('audio.podcasts.chapters.loading')}</p>}
          {!chapters.isLoading && chapterList.length === 0 && <p className="pod-empty">{t('audio.podcasts.chapters.none')}</p>}
          <ol className="pod-marks">
            {chapterList.map((c, i) => {
              const now = isCurrent && currentSec >= c.start && (chapterList[i + 1] ? currentSec < chapterList[i + 1].start : true);
              return (
                <li key={`${c.start}-${i}`} className={`pod-mark${now ? ' pod-mark--now' : ''}`}>
                  <button type="button" className="pod-mark-play" onClick={() => playFrom(c.start)} aria-current={now || undefined}>
                    <Icon name="play_arrow" size={18} fill />
                    <span className="pod-mark-time">{fmtClock(c.start)}</span>
                    <span className="pod-mark-title">{c.title}</span>
                  </button>
                  {/^https?:\/\//i.test(c.url || '') && (
                    <a className="pod-icon-btn" href={c.url} target="_blank" rel="noopener noreferrer nofollow" title={t('audio.podcasts.chapters.link')} aria-label={t('audio.podcasts.chapters.link')}>
                      <Icon name="open_in_new" size={16} />
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
        {/* A 3Speak episode: the Hive post itself, rendered (the feed's copy is flattened markdown). */}
        {hive
          ? <div className="pod-notes"><BlogContent author={hive.author} permlink={hive.permlink} alwaysExpanded hideAudioPlayers /></div>
          : notesHtml
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
      {voting && hive && (
        <CommentVoteTooltip
          author={hive.author}
          permlink={hive.permlink}
          showTooltip={voting}
          setShowTooltip={setVoting}
          weight={weight} setWeight={setWeight}
          voteValue={voteValue} setVoteValue={setVoteValue}
          accountData={accountData} setAccountData={setAccountData}
          compact
          onVoteSuccess={() => { setVoting(false); setVotedNow(true); }}
        />
      )}
      {hiveTipping && hive && (
        <TipModal
          recipient={hive.author}
          permlink={hive.permlink}
          memoLink={`https://3speak.tv${postPage}`}
          isOpen
          onClose={() => setHiveTipping(false)}
        />
      )}
    </div>
  );
}
