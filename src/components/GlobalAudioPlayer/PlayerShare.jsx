import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { Button } from '../v2/ui';
import { episodePath } from '../../lib/podcasts';
import { toastIn } from '../../utils/toast';
import { fmt, withTimestamp, clipRange, CLIP_MIN, CLIP_MAX } from './playerMath';

const toast = toastIn('Podcasts');

/** Copy `text`, with a toast either way. */
function copyLink(text, okMsg, failMsg) {
  const fail = () => toast.error(failMsg);
  try {
    navigator.clipboard.writeText(text).then(() => toast.success(okMsg), fail);
  } catch { fail(); }
}

/** The absolute link to an outside episode's page. */
const episodeUrl = (id) => `${window.location.origin}${episodePath(id)}`;

/**
 * A share target (27b): a 56px tile over a short label. `name` is the full
 * accessible name ("Copy link at 1:42"), `label` the short one under the tile.
 * `href` makes it a link that opens in a new tab (X, Telegram, Email).
 */
export function ShareTile({ icon, label, name, tone, onClick, href, disabled, pressed, className }) {
  const cls = ['audio-share-tile', tone && `is-${tone}`, pressed && 'is-on', className].filter(Boolean).join(' ');
  const body = (
    <>
      <span className="audio-share-tile__icon"><Icon name={icon} size={24} /></span>
      <span className="audio-share-tile__label">{label}</span>
    </>
  );
  if (href) {
    return <a className={cls} href={href} target="_blank" rel="noopener noreferrer" aria-label={name || label} title={name || label} onClick={onClick}>{body}</a>;
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-label={name || label} title={name || label}>
      {body}
    </button>
  );
}

/**
 * X, Telegram and Email: their own share pages with the link filled in;
 * nothing is sent until the listener sends it there.
 */
export function AppShareTiles({ url, title }) {
  const { t } = useTranslation();
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(title || '');
  return (
    <>
      <ShareTile icon="alternate_email" label={t('audio.share.x')} href={`https://x.com/intent/post?url=${u}&text=${text}`} />
      <ShareTile icon="send" label={t('audio.share.telegram')} href={`https://t.me/share/url?url=${u}&text=${text}`} />
      <ShareTile icon="mail" label={t('audio.share.email')} href={`mailto:?subject=${text}&body=${u}`} />
    </>
  );
}

/**
 * "Make a clip" (27b CLIP well, 36b): at rest a well with where the clip
 * would sit; open, the length, "Copy link at" the start and "Copy clip link"
 * (a link that starts at `start` and stops `length` seconds later, &t=&end=,
 * for a 15 to 90 second piece).
 */
export function ClipForm({ url, start, duration, onDone }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [len, setLen] = useState(30);
  // The start is where playback was when the form opened, not a moving target.
  const [from, setFrom] = useState(start);
  const range = clipRange(open ? from : start, len, duration);
  // The clip's place in the whole track, when the length is known.
  const total = Number(duration) || 0;
  const left = total > 0 ? (range.start / total) * 100 : 0;
  const width = total > 0 ? Math.max(1, ((range.end - range.start) / total) * 100) : 0;
  const bar = total > 0 && (
    <span className="audio-np-clip-form-bar" aria-hidden="true">
      <span style={{ left: `${left}%`, width: `${width}%` }} />
    </span>
  );

  if (!open) {
    return (
      <button type="button" className="audio-np-clip-well" onClick={() => { setFrom(start); setOpen(true); }} aria-label={t('audio.player.clipMake')}>
        <span className="audio-np-clip-form-head">
          <span className="v2-eyebrow">{t('audio.player.clipMake')}</span>
          <span className="audio-np-clip-form-row num">{fmt(range.start)} → {fmt(range.end)}</span>
        </span>
        {bar}
      </button>
    );
  }
  const sec = Math.floor(range.start);
  return (
    <div className="audio-np-clip-form">
      <div className="audio-np-clip-form-head">
        <span className="v2-eyebrow">{t('audio.player.clipMake')}</span>
        <span className="audio-np-clip-form-row num">{t('audio.player.clipRange', { from: fmt(range.start), to: fmt(range.end) })}</span>
      </div>
      {bar}
      <label className="audio-np-clip-form-len">
        <span>{t('audio.player.clipLength')}</span>
        <input
          type="range"
          min={CLIP_MIN}
          max={CLIP_MAX}
          step="5"
          value={len}
          onChange={(e) => setLen(Number(e.target.value))}
          aria-valuetext={t('audio.player.clipSeconds', { seconds: len })}
        />
        <b className="audio-np-clip-form-sec num">{t('audio.player.clipSeconds', { seconds: len })}</b>
      </label>
      <div className="audio-np-clip-form-actions">
        {sec >= 1 && (
          <Button
            size={48}
            trailing="link"
            className="audio-np-clip-form-at"
            onClick={() => {
              copyLink(withTimestamp(url, sec), t('audio.player.copiedAt', { time: fmt(sec) }), t('audio.player.copyFailed'));
              onDone?.();
            }}
          >
            {t('audio.player.copyAt', { time: fmt(sec) })}
          </Button>
        )}
        <Button
          variant="primary"
          size={48}
          className="audio-np-clip-form-copy"
          trailing="content_cut"
          onClick={() => {
            copyLink(withTimestamp(url, range.start, range.end), t('audio.player.clipCopied'), t('audio.player.copyFailed'));
            onDone?.();
          }}
        >
          {t('audio.player.clipCopy')}
        </Button>
      </div>
    </div>
  );
}

/** "Copy link at 12:34" as a share tile, shown once playback is past the start. */
export function CopyAtOption({ url, at, onDone }) {
  const { t } = useTranslation();
  const sec = Math.floor(at || 0);
  if (sec < 1) return null;
  return (
    <ShareTile
      icon="schedule"
      tone="cyan"
      label={t('audio.share.atTime', { time: fmt(sec) })}
      name={t('audio.player.copyAt', { time: fmt(sec) })}
      onClick={() => {
        copyLink(withTimestamp(url, sec), t('audio.player.copiedAt', { time: fmt(sec) }), t('audio.player.copyFailed'));
        onDone?.();
      }}
    />
  );
}

/** The share menu of an outside podcast episode: its page, at a time, a clip. */
export function EpisodeShareOptions({ track, at, duration, onClose }) {
  const { t } = useTranslation();
  const url = episodeUrl(track._id);
  return (
    <div className="audio-share-dropdown is-bare">
      <ClipForm url={url} start={Math.floor(at || 0)} duration={duration} onDone={onClose} />
      <div className="audio-share-list">
        <ShareTile
          icon="link"
          tone="cyan"
          label={t('audio.share.episode')}
          name={t('audio.player.copyEpisode')}
          onClick={() => { copyLink(url, t('audio.player.copiedEpisode'), t('audio.player.copyFailed')); onClose(); }}
        />
        <CopyAtOption url={url} at={at} onDone={onClose} />
        <AppShareTiles url={url} title={track.title} />
      </div>
    </div>
  );
}
