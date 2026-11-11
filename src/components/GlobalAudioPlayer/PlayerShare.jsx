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
 * "Make a clip": a link that starts at `start` and stops `length` seconds
 * later (&t=&end=), for a 15 to 90 second piece of the episode.
 */
export function ClipForm({ url, start, duration, onDone }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [len, setLen] = useState(30);
  // The start is where playback was when the form opened, not a moving target.
  const [from, setFrom] = useState(start);
  const range = clipRange(from, len, duration);

  if (!open) {
    return (
      <button type="button" className="audio-share-option" onClick={() => { setFrom(start); setOpen(true); }}>
        <Icon name="content_cut" size={18} /><span>{t('audio.player.clipMake')}</span>
      </button>
    );
  }
  // The clip's place in the whole track (design 36b), when the length is known.
  const total = Number(duration) || 0;
  const left = total > 0 ? (range.start / total) * 100 : 0;
  const width = total > 0 ? Math.max(1, ((range.end - range.start) / total) * 100) : 0;
  return (
    <div className="audio-np-clip-form">
      <div className="audio-np-clip-form-head">
        <span className="v2-eyebrow">{t('audio.player.clipMake')}</span>
        <span className="audio-np-clip-form-row num">{t('audio.player.clipRange', { from: fmt(range.start), to: fmt(range.end) })}</span>
      </div>
      {total > 0 && (
        <div className="audio-np-clip-form-bar" aria-hidden="true">
          <span style={{ left: `${left}%`, width: `${width}%` }} />
        </div>
      )}
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
      <Button
        variant="primary"
        block
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
  );
}

/** "Copy link at 12:34", shown once playback is past the start. */
export function CopyAtOption({ url, at, onDone }) {
  const { t } = useTranslation();
  const sec = Math.floor(at || 0);
  if (sec < 1) return null;
  return (
    <button
      type="button"
      className="audio-share-option"
      onClick={() => {
        copyLink(withTimestamp(url, sec), t('audio.player.copiedAt', { time: fmt(sec) }), t('audio.player.copyFailed'));
        onDone?.();
      }}
    >
      <Icon name="schedule" size={18} /><span>{t('audio.player.copyAt', { time: fmt(sec) })}</span>
    </button>
  );
}

/** The share menu of an outside podcast episode: its page, at a time, a clip. */
export function EpisodeShareOptions({ track, at, duration, onClose }) {
  const { t } = useTranslation();
  const url = episodeUrl(track._id);
  return (
    <div className="audio-share-dropdown is-bare">
      <button
        type="button"
        className="audio-share-option"
        onClick={() => { copyLink(url, t('audio.player.copiedEpisode'), t('audio.player.copyFailed')); onClose(); }}
      >
        <Icon name="link" size={18} /><span>{t('audio.player.copyEpisode')}</span>
      </button>
      <CopyAtOption url={url} at={at} onDone={onClose} />
      <ClipForm url={url} start={Math.floor(at || 0)} duration={duration} onDone={onClose} />
    </div>
  );
}
