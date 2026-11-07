import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdClose } from 'react-icons/md';
import { commentWithAioha } from '../../hive-api/aioha';
import useEmojiShortcodes from '../../hooks/useEmojiShortcodes';
import EmojiGifPicker from '../common/EmojiGifPicker/EmojiGifPicker';
import { insertAtCursor, gifMarkdown } from '../../utils/composerInsert';
import { toastIn } from '../../utils/toast';
import './AudioCommentPanel.scss';

const toast = toastIn('Comment');

const fmt = (s) => {
  const v = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = String(v % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * Comment on the Hive post of the audio playing. Part of the player itself: it
 * is the top section of the player card (above the controls), with no overlay,
 * so play/pause, seek and skip stay usable while writing. Lives inside the
 * player's DOM, so it follows the player into the docked Player tab and the
 * pop-out window too. Emojis and GIFs from the shared picker (over the page, so
 * the player card can't clip it) and `:shortcode:` emojis while typing, as in the
 * watch page's comment box. Optionally tied to the moment it was opened at
 * (`parentTimestamp`, the way the watch page's comment box does it).
 *
 * @param {string}   author     the track's owner (the Hive post author)
 * @param {string}   permlink   the Hive post permlink
 * @param {string}   title      the track title, for the header
 * @param {number}   at         seconds into the track when the panel opened
 * @param {Function} onClose
 */
export default function AudioCommentPanel({ author, permlink, title, at, onClose }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [withTime, setWithTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const emoji = useEmojiShortcodes(inputRef, text, setText);
  const atSec = Math.floor(at || 0);

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

  const close = () => { if (!busy) onClose(); };

  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const metadata = { app: '3speak/new-version' };
      if (withTime && atSec > 0) metadata.parentTimestamp = atSec;
      const res = await commentWithAioha(author, permlink, `re-${permlink}-${Date.now()}`, '', body, metadata);
      if (!res?.success) throw new Error(res?.error || 'comment failed');
      toast.success(t('comments.section.posted'));
      onClose();
    } catch (err) {
      console.error('Audio comment failed:', err);
      toast.error(t('comments.section.postFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="audio-np-comment"
      aria-label={t('comments.section.commentTab')}
      // Escape only while focus is in here, so it never fights the player's menus.
      // Keys from the picker's popover bubble up here through its portal: not ours.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || emoji.open || !e.currentTarget.contains(e.target)) return;
        e.stopPropagation();
        close();
      }}
    >
      <div className="audio-np-comment-head">
        <span className="audio-np-comment-label">{t('comments.section.commentTab')}</span>
        {title && <span className="audio-np-comment-on" title={title}>{title}</span>}
        <button
          type="button"
          className="audio-np-comment-close"
          onClick={close}
          disabled={busy}
          aria-label={t('common.actions.close')}
          title={t('common.actions.close')}
        ><MdClose size={16} /></button>
      </div>
      <textarea
        ref={inputRef}
        className="audio-np-comment-input"
        value={text}
        onChange={(e) => setText(emoji.change(e))}
        onKeyDown={(e) => { if (emoji.keyDown(e)) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); }}
        onBlur={emoji.blur}
        placeholder={t('comments.section.commentPlaceholder')}
        rows={5}
        maxLength={10000}
        disabled={busy}
      />
      {emoji.popup}
      <div className="audio-np-comment-foot">
        <div className="audio-np-comment-tools">
          <EmojiGifPicker
            portal
            disabled={busy}
            onPickEmoji={(em) => insertAtCursor(inputRef.current, text, em, setText)}
            onPickGif={(url) => insertAtCursor(inputRef.current, text, gifMarkdown(url), setText)}
          />
          {atSec > 0 && (
            <label className="audio-np-comment-at">
              <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} disabled={busy} />
              <span>{t('comments.section.atTime', { time: fmt(atSec) })}</span>
            </label>
          )}
        </div>
        <button type="button" className="audio-np-comment-post" onClick={post} disabled={busy || !text.trim()}>
          {busy ? t('comments.section.saving') : t('comments.section.commentButton')}
        </button>
      </div>
    </section>
  );
}
