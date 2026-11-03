import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MdPlayArrow, MdPause, MdHistory, MdAdd, MdClose } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { episodeToTrack } from '../../lib/podcasts';
import { fetchContinueListening, hideFromContinue, usePodcastProgress, progressOf } from '../../lib/podcastProgress';
import { toastIn } from '../../utils/toast';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import PodcastArt from './PodcastArt';

// ▶️ Continue listening, on top of the audio page's Mine: outside episodes and
// 3Speak tracks the listener left half way (newest first, across devices). A tap
// plays on from where they stopped. The corner buttons (on hover, or after a
// long press on a phone, like the audio tiles) queue it or remove it from here.

/** The list, shared with the audio page (an empty Mine opens Discover instead). */
export function useContinueListening(user) {
  return useQuery({
    queryKey: ['podcasts', 'continue', user],
    enabled: !!user,
    queryFn: () => fetchContinueListening(user),
    staleTime: 30 * 1000,
  });
}

function trackCover(track) {
  const fixed = fixVideoThumbnail({ thumbnail_url: track.thumbnail_url, thumbnail: track.thumbnail_url });
  return !fixed || fixed === fallbackImg || fixed === '/images/speak.jpg' ? `/img/u/${track.owner}/avatar/large` : fixed;
}

const LONG_PRESS_MS = 450;

function ContinueCard({ item, onRemove }) {
  const { t } = useTranslation();
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  // A long press shows the corner buttons (a phone has no hover) and swallows
  // the tap that ends it; a tap anywhere else hides them again.
  const cardRef = useRef(null);
  const pressTimer = useRef(null);
  const swallowClick = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const startPress = () => {
    clearTimeout(pressTimer.current);
    swallowClick.current = false;
    pressTimer.current = setTimeout(() => {
      swallowClick.current = true;
      setRevealed(true);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  useEffect(() => {
    if (!revealed) return undefined;
    const onOutside = (e) => { if (!cardRef.current?.contains(e.target)) setRevealed(false); };
    document.addEventListener('touchstart', onOutside, true);
    document.addEventListener('mousedown', onOutside, true);
    return () => {
      document.removeEventListener('touchstart', onOutside, true);
      document.removeEventListener('mousedown', onOutside, true);
    };
  }, [revealed]);
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const audioPlayAt = useAppStore((s) => s.audioPlayAt);
  const track = useMemo(
    () => (item.kind === 'episode' ? episodeToTrack(item.episode, item.feed) : item.track),
    [item],
  );
  const isCurrent = audioCurrent?._id === item.id;
  const playing = isCurrent && audioIsPlaying;
  // This browser may be further along than the last save.
  const local = progressOf(item.id);
  const pos = Math.max(item.pos || 0, local?.pos || 0);
  const dur = item.dur || local?.dur || track.duration || 0;
  const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
  const minutesLeft = Math.max(1, Math.ceil((dur - pos) / 60));
  const title = (item.kind === 'episode' ? item.episode.title : track.title) || t('audio.untitled');
  const from = item.kind === 'episode' ? item.feed?.title : track.owner && `@${track.owner}`;

  const play = () => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    setRevealed(false);
    if (isCurrent) { audioRequestToggle(); return; }
    // A few seconds back, so the sentence it stopped in starts again.
    audioPlayAt(track, Math.max(0, pos - 3));
  };

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      className={`pod-card pod-continue-card${isCurrent ? ' pod-continue-card--current' : ''}${revealed ? ' pod-continue-card--revealed' : ''}`}
      onClick={play}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } }}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      title={title}
    >
      <span className="pod-card-art">
        {item.kind === 'episode'
          ? <PodcastArt art={item.episode.art} fallback={item.feed?.art} px={256} />
          : <img src={trackCover(track)} alt="" loading="lazy" />}
        <span className={`pod-tile-play${playing ? ' pod-tile-play--on' : ''}`} aria-hidden="true">
          {playing ? <MdPause size={32} /> : <MdPlayArrow size={32} />}
        </span>
        <span className="pod-tile-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
        <span className="pod-continue-actions" onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
          <button type="button" className="audio-tile-action-btn" onClick={() => { setRevealed(false); audioAddToQueue(track); }} title={t('audio.tile.queue')} aria-label={t('audio.tile.queue')}>
            <MdAdd size={14} />
          </button>
          <button type="button" className="audio-tile-action-btn" onClick={() => { setRevealed(false); onRemove(item); }} title={t('audio.podcasts.continue.remove')} aria-label={t('audio.podcasts.continue.remove')}>
            <MdClose size={14} />
          </button>
        </span>
      </span>
      <span className="pod-card-title">{title}</span>
      <span className="pod-card-meta">
        {t('audio.podcasts.continue.left', { minutes: minutesLeft })}{from ? ` · ${from}` : ''}
      </span>
    </div>
  );
}

export default function ContinueListening({ user }) {
  const { t } = useTranslation();
  const { data: items = [] } = useContinueListening(user);
  const queryClient = useQueryClient();
  const key = ['podcasts', 'continue', user];

  // Gone from the list at once; Undo puts it back where it was.
  const remove = (item) => {
    const before = queryClient.getQueryData(key) || [];
    queryClient.setQueryData(key, before.filter((it) => it.id !== item.id));
    const putBack = () => {
      queryClient.setQueryData(key, (now = []) => (now.some((it) => it.id === item.id) ? now
        : before.filter((it) => it.id === item.id || now.some((n) => n.id === it.id))));
    };
    hideFromContinue(user, item.id).then(() => {
      toastIn('Audio').success(t('audio.podcasts.continue.removed'), {
        action: {
          label: t('engagement.cardMenu.undo'),
          onClick: () => { putBack(); hideFromContinue(user, item.id, false).catch(() => queryClient.invalidateQueries({ queryKey: key })); },
        },
      });
    }).catch(() => {
      putBack();
      toastIn('Audio').error(t('audio.podcasts.continue.removeFailed'));
    });
  };
  // Re-render as this browser's progress moves (a finished one drops out).
  usePodcastProgress(user);
  const shown = items.filter((it) => !progressOf(it.id)?.done);
  if (!shown.length) return null;
  return (
    <section className="pod-section pod-continue">
      <h2 className="pod-section-title"><MdHistory size={18} />{t('audio.podcasts.continue.title')}</h2>
      <div className="pod-rail">
        {shown.map((it) => <ContinueCard key={it.id} item={it} onRemove={remove} />)}
      </div>
    </section>
  );
}
