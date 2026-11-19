import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon } from '../components/v2/Icon';
import { Dialog, Progress, EmptyState, Segmented } from '../components/v2/ui';
import { useAppStore } from '../lib/store';
import {
  useDownloads, cancelDownload, removeDownload, pruneExpired, setDownloadCap, CAP_CHOICES, partBlob,
} from '../lib/podcastDownloads';
import { isVideoDownload, daysLeft } from '../lib/videoDownloads';
import { fmtBytes } from '../lib/podcastLibrary';
import { fmtDuration } from '../lib/podcastFormat';
import { artUrl, PODCAST_PLACEHOLDER } from '../lib/podcasts';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { watchPath } from '../utils/urls';
import { toastIn } from '../utils/toast';
import useOnline from '../hooks/useOnline';
import OfflineVideoPlayer from '../components/Downloads/OfflineVideoPlayer';
// The row look (pod-dl-*) is the podcast downloads', so both read alike.
import '../components/Podcasts/PodcastsTab.scss';
import './Downloads.scss';

// A saved video's cover from storage (it was saved with it), else its address.
function useCover(entry) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!entry?.thumbKey) { setUrl(null); return undefined; }
    let made = null;
    let gone = false;
    partBlob(entry.thumbKey).then((blob) => {
      if (gone || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [entry?.thumbKey]);
  if (url) return url;
  const track = entry?.track || {};
  if (isVideoDownload(entry)) return fixVideoThumbnail({ thumbnail_url: track.thumbnail_url, thumbnail: track.thumbnail_url });
  if (track.external) return track.art ? artUrl(track.art, 128) : PODCAST_PLACEHOLDER;
  return fixVideoThumbnail({ thumbnail_url: track.thumbnail_url, thumbnail: track.thumbnail_url });
}

function Row({ entry, playing, onPlay, onRemove }) {
  const { t } = useTranslation();
  const cover = useCover(entry);
  const video = isVideoDownload(entry);
  const track = entry.track || {};
  const left = video ? daysLeft(entry) : null;
  const sub = [
    video ? t('downloads.kindVideo') : track.external ? t('downloads.kindPodcast') : t('downloads.kindAudio'),
    fmtBytes(entry.bytes || 0),
    track.duration > 0 ? fmtDuration(track.duration) : null,
    left == null ? null : left === 0 ? t('downloads.expiresToday') : t('downloads.expiresIn', { count: left }),
  ].filter(Boolean).join(' · ');
  const by = video ? (track.author ? `@${track.author}` : '') : track.show || (track.owner ? `@${track.owner}` : '');
  return (
    <li className="pod-dl-row dl-row">
      <button type="button" className="dl-cover" onClick={onPlay} aria-label={playing ? t('audio.podcasts.pause') : t('downloads.play')}>
        <img src={cover || fallbackImg} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        <span className="dl-cover__play"><Icon name={playing ? 'pause' : 'play_arrow'} size={20} fill /></span>
        {video && <span className="dl-cover__kind"><Icon name="movie" size={14} /></span>}
      </button>
      <span className="pod-dl-info">
        <span className="pod-dl-title" title={track.title}>{track.title || t('audio.untitled')}</span>
        {by && <span className="dl-by">{by}</span>}
        <span className="pod-dl-sub num">{sub}</span>
      </span>
      <button type="button" className="pod-icon-btn pod-icon-btn--lg" onClick={onRemove} aria-label={t('downloads.remove')} title={t('downloads.remove')}>
        <Icon name="delete" size={20} />
      </button>
    </li>
  );
}

/**
 * /downloads: everything saved in this browser for offline, videos and audio
 * together (lib/podcastDownloads.js holds both, lib/videoDownloads.js the
 * videos), how much room it takes against the storage cap, the cap itself, and
 * the downloads still running. Per browser, so it works signed out too. A
 * saved video plays here (OfflineVideoPlayer), audio in the global player.
 */
export default function Downloads() {
  const { t } = useTranslation();
  const { items, progress, usedBytes, estimate, cap, ready } = useDownloads();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const online = useOnline();
  const [watching, setWatching] = useState(null);
  const [filter, setFilter] = useState('all');

  // Expired videos go as soon as the page opens, not only on the next visit.
  useEffect(() => { pruneExpired(); }, []);

  const running = Object.keys(progress).filter((id) => !items.some((m) => m.id === id));
  const shown = useMemo(() => items.filter((m) => {
    if (filter === 'video') return isVideoDownload(m);
    if (filter === 'audio') return !isVideoDownload(m);
    return true;
  }), [items, filter]);
  const counts = { video: items.filter(isVideoDownload).length };
  counts.audio = items.length - counts.video;

  const play = (entry) => {
    if (isVideoDownload(entry)) { setWatching(entry); return; }
    const track = entry.track;
    if (audioCurrent?._id === track._id) { audioRequestToggle(); return; }
    if (track.external) audioPlayQueued(track); else audioPlay(track);
  };
  const remove = async (entry) => {
    await removeDownload(entry.id);
    toastIn(isVideoDownload(entry) ? 'Video' : 'Podcasts').success(t('downloads.removed'));
  };

  const pct = cap > 0 ? Math.min(100, (usedBytes / cap) * 100) : 0;
  const capOptions = CAP_CHOICES.map((b) => ({ value: String(b), label: fmtBytes(b) }));

  return (
    <div className="v2-page dl-page">
      <header className="dl-head">
        <h1 className="v2-heading">{t('downloads.title')}</h1>
        <p className="v2-meta">{online ? t('downloads.intro') : t('downloads.offlineIntro')}</p>
      </header>

      <section className="dl-storage" aria-label={t('downloads.storage')}>
        <div className="dl-storage__line">
          <Icon name="sd_storage" size={20} />
          <span className="num">{t('downloads.used', { used: fmtBytes(usedBytes), cap: fmtBytes(cap) })}</span>
        </div>
        <Progress value={pct} tone={pct >= 90 ? 'accent' : 'cyan'} label={t('downloads.storage')} thin />
        <div className="dl-storage__cap">
          <span className="v2-eyebrow">{t('downloads.capLabel')}</span>
          <Segmented
            size={32}
            scroll
            label={t('downloads.capLabel')}
            options={capOptions}
            value={String(CAP_CHOICES.includes(cap) ? cap : '')}
            onChange={(v) => setDownloadCap(Number(v))}
          />
        </div>
        <p className="pod-dl-note">
          {t('downloads.perBrowser', { days: 30 })}
          {estimate?.quota > 0 && <> {t('downloads.browserStorage', { used: fmtBytes(estimate.usage), quota: fmtBytes(estimate.quota) })}</>}
        </p>
      </section>

      {items.length > 0 && (
        <Segmented
          className="dl-filter"
          size={36}
          block={false}
          label={t('downloads.title')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('downloads.filterAll'), count: items.length },
            { value: 'video', label: t('downloads.videos'), count: counts.video },
            { value: 'audio', label: t('downloads.audio'), count: counts.audio },
          ]}
        />
      )}

      {(running.length > 0 || shown.length > 0) && (
        <ul className="pod-dl-list dl-list">
          {running.map((id) => (
            <li key={id} className="pod-dl-row">
              <span className="pod-dl-cover pod-dl-cover--busy" aria-hidden="true"><Icon name="download" size={20} /></span>
              <span className="pod-dl-info">
                <span className="pod-dl-title">{t('downloads.progress', { pct: Math.round(progress[id] * 100) })}</span>
                <span className="pod-tile-bar pod-dl-bar"><span style={{ width: `${Math.round(progress[id] * 100)}%` }} /></span>
              </span>
              <button type="button" className="pod-icon-btn pod-icon-btn--lg" onClick={() => cancelDownload(id)} title={t('downloads.cancel')} aria-label={t('downloads.cancel')}>
                <Icon name="close" size={20} />
              </button>
            </li>
          ))}
          {shown.map((entry) => (
            <Row
              key={entry.id}
              entry={entry}
              playing={!isVideoDownload(entry) && audioCurrent?._id === entry.id && audioIsPlaying}
              onPlay={() => play(entry)}
              onRemove={() => remove(entry)}
            />
          ))}
        </ul>
      )}

      {ready && !items.length && !running.length && (
        <EmptyState icon="download" title={t('downloads.emptyTitle')}>
          {t('downloads.emptyText')}
        </EmptyState>
      )}

      {watching && (
        <Dialog
          open
          onClose={() => setWatching(null)}
          title={watching.track?.title || t('downloads.title')}
          sub={watching.track?.author ? `@${watching.track.author}` : undefined}
          width={880}
          closeLabel={t('common.actions.close')}
          className="dl-dialog"
        >
          <OfflineVideoPlayer entry={watching} />
          {online && watching.track?.author && (
            <Link className="dl-dialog__link" to={watchPath(watching.track.author, watching.track.permlink)} onClick={() => setWatching(null)}>
              <Icon name="open_in_new" size={16} /> {t('downloads.openPost')}
            </Link>
          )}
        </Dialog>
      )}
    </div>
  );
}
