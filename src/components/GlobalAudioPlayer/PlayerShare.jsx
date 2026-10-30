import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdContentCopy, MdContentCut, MdAccessTime } from 'react-icons/md';
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
        <MdContentCut size={14} /><span>{t('audio.player.clipMake')}</span>
      </button>
    );
  }
  return (
    <div className="audio-np-clip-form">
      <div className="audio-np-clip-form-row">
        <MdContentCut size={14} aria-hidden />
        <span>{t('audio.player.clipRange', { from: fmt(range.start), to: fmt(range.end) })}</span>
      </div>
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
        <span className="audio-np-clip-form-sec">{t('audio.player.clipSeconds', { seconds: len })}</span>
      </label>
      <button
        type="button"
        className="audio-np-clip-form-copy"
        onClick={() => {
          copyLink(withTimestamp(url, range.start, range.end), t('audio.player.clipCopied'), t('audio.player.copyFailed'));
          onDone?.();
        }}
      >
        <MdContentCopy size={14} /> {t('audio.player.clipCopy')}
      </button>
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
      <MdAccessTime size={14} /><span>{t('audio.player.copyAt', { time: fmt(sec) })}</span>
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
        <MdContentCopy size={14} /><span>{t('audio.player.copyEpisode')}</span>
      </button>
      <CopyAtOption url={url} at={at} onDone={onClose} />
      <ClipForm url={url} start={Math.floor(at || 0)} duration={duration} onDone={onClose} />
    </div>
  );
}
