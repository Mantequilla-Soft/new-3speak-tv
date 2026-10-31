import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdDownload, MdDownloadDone, MdClose, MdLock, MdPlayArrow, MdPause, MdSchedule, MdSensors } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { episodeNumberLabel, liveToTrack } from '../../lib/podcasts';
import { useDownloads, cancelDownload, isDownloaded } from '../../lib/podcastDownloads';
import { startDownload, forgetDownload } from './downloadActions';
import { getLanguage } from '../../i18n';

/**
 * Small pieces the show page, the episode page and the tiles share: the
 * season / episode / trailer labels, the download button, hosts and guests,
 * the live banner and the private-feed lock.
 */

// ─── Labels ───────────────────────────────────────────────────────────────────

/** "S2 E14", Trailer, Bonus: as small chips in a tile's or the episode page's meta line. */
export function EpisodeBadges({ ep }) {
  const { t } = useTranslation();
  const num = episodeNumberLabel(ep);
  return (
    <>
      {num && <span className="pod-badge">{num}</span>}
      {ep?.episode_type === 'trailer' && <span className="pod-badge pod-badge--accent">{t('audio.podcasts.badges.trailer')}</span>}
      {ep?.episode_type === 'bonus' && <span className="pod-badge pod-badge--accent">{t('audio.podcasts.badges.bonus')}</span>}
    </>
  );
}

/** The lock of a private feed (one that needs a login). */
export function PrivateBadge({ withText = false }) {
  const { t } = useTranslation();
  return (
    <span className="pod-badge pod-badge--lock" title={t('audio.podcasts.private.badgeHint')} aria-label={t('audio.podcasts.private.badge')}>
      <MdLock size={12} />{withText && t('audio.podcasts.private.badge')}
    </span>
  );
}

// ─── Downloads ────────────────────────────────────────────────────────────────

/**
 * Download / downloading (click cancels) / saved (click removes). `variant`:
 * 'icon' for a tile, 'button' for the episode page.
 */
export function DownloadButton({ track, variant = 'icon' }) {
  const { t } = useTranslation();
  const { progress } = useDownloads();
  if (!track || track.live) return null;
  const id = track._id;
  const pct = progress[id];
  const busy = pct !== undefined;
  const saved = !busy && isDownloaded(id);
  const label = busy
    ? t('audio.podcasts.downloads.cancel')
    : saved ? t('audio.podcasts.downloads.remove') : t('audio.podcasts.downloads.download');
  const onClick = () => {
    if (busy) cancelDownload(id);
    else if (saved) forgetDownload(id, t);
    else startDownload(track, t);
  };
  const pctText = t('audio.podcasts.downloads.downloading', { pct: Math.round((pct || 0) * 100) });

  if (variant === 'button') {
    return (
      <button type="button" className={`pod-btn${saved ? ' pod-btn--on' : ''}`} onClick={onClick} title={label} aria-label={label}>
        {busy ? <MdClose size={16} /> : saved ? <MdDownloadDone size={16} /> : <MdDownload size={16} />}
        {busy ? pctText : saved ? t('audio.podcasts.downloads.saved') : t('audio.podcasts.downloads.short')}
      </button>
    );
  }
  return (
    <button type="button" className={`pod-icon-btn${saved ? ' pod-icon-btn--on' : ''}`} onClick={onClick} title={busy ? `${pctText} (${label})` : label} aria-label={label}>
      {busy
        ? <span className="pod-dl-pct" aria-hidden="true">{Math.round((pct || 0) * 100)}%</span>
        : saved ? <MdDownloadDone size={18} /> : <MdDownload size={18} />}
    </button>
  );
}

// ─── Hosts and guests ─────────────────────────────────────────────────────────

const KNOWN_ROLES = new Set(['host', 'guest', 'cohost', 'co-host', 'producer']);

/** podcast:person entries: a face (or the initial), the name and the role; the link opens in a new tab. */
export function PersonsRow({ persons }) {
  const { t } = useTranslation();
  if (!persons?.length) return null;
  return (
    <section className="pod-section">
      <h2 className="pod-section-title">{t('audio.podcasts.persons.title')}</h2>
      <ul className="pod-persons">
        {persons.map((p, i) => {
          const role = String(p.role || 'host').toLowerCase();
          const roleText = KNOWN_ROLES.has(role) ? t(`audio.podcasts.persons.roles.${role.replace('-', '')}`) : role;
          const body = (
            <>
              <PersonFace person={p} />
              <span className="pod-person-text">
                <span className="pod-person-name">{p.name}</span>
                <span className="pod-person-role">{roleText}</span>
              </span>
            </>
          );
          return (
            <li key={`${p.name}-${i}`}>
              {/^https?:\/\//i.test(p.href || '')
                ? <a className="pod-person" href={p.href} target="_blank" rel="noopener noreferrer nofollow">{body}</a>
                : <span className="pod-person">{body}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PersonFace({ person }) {
  const [broken, setBroken] = useState(false);
  if (person.img && /^https:\/\//i.test(person.img) && !broken) {
    return <img className="pod-person-img" src={person.img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="pod-person-img pod-person-img--initial" aria-hidden="true">{String(person.name || '?').trim().charAt(0).toUpperCase()}</span>;
}

// ─── Live ─────────────────────────────────────────────────────────────────────

function fmtStart(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(getLanguage() || undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toLocaleString();
  }
}

/** A show's live stream now (play it) and the ones announced (with their start, in local time). */
export function LiveBanner({ feed }) {
  const { t } = useTranslation();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const items = (feed?.live || []).filter((l) => l?.url && (l.status === 'live' || l.status === 'pending'));
  if (!items.length) return null;
  const now = items.filter((l) => l.status === 'live');
  const soon = items.filter((l) => l.status === 'pending').sort((a, b) => new Date(a.start) - new Date(b.start));

  return (
    <section className="pod-live">
      {now.map((l) => {
        const track = liveToTrack(l, feed);
        const isCurrent = audioCurrent?._id === track._id;
        const playing = isCurrent && audioIsPlaying;
        return (
          <div key={l.id} className="pod-live-row pod-live-row--on">
            <span className="pod-live-badge"><MdSensors size={14} /> {t('audio.podcasts.live.now')}</span>
            <span className="pod-live-title">{l.title || feed.title}</span>
            <button type="button" className="pod-btn pod-btn--solid" onClick={() => (isCurrent ? audioRequestToggle() : audioPlay(track))}>
              {playing ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
              {playing ? t('audio.podcasts.pause') : t('audio.podcasts.live.listen')}
            </button>
          </div>
        );
      })}
      {soon.map((l) => (
        <div key={l.id} className="pod-live-row">
          <span className="pod-live-badge pod-live-badge--soon"><MdSchedule size={14} /> {t('audio.podcasts.live.upcoming')}</span>
          <span className="pod-live-title">{l.title || feed.title}</span>
          {l.start && <span className="pod-live-when">{t('audio.podcasts.live.startsAt', { time: fmtStart(l.start) })}</span>}
        </div>
      ))}
    </section>
  );
}
