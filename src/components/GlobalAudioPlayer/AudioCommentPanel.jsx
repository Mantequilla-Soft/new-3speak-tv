import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { commentWithAioha } from '../../hive-api/aioha';
import Composer from '../common/Composer/Composer';
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
 * pop-out window too. The one editor (common/Composer), its emoji / GIF picker
 * over the page so the player card can't clip it. Optionally tied to the moment it was opened at
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
  const atSec = Math.floor(at || 0);

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

  const close = () => { if (!busy) onClose(); };

  const post = async ({ meta = {} } = {}) => {
    const body = text.trim();
    if (!body || busy) return false;
    setBusy(true);
    try {
      const metadata = { app: '3speak/new-version', ...meta };
      if (withTime && atSec > 0) metadata.parentTimestamp = atSec;
      const res = await commentWithAioha(author, permlink, `re-${permlink}-${Date.now()}`, '', body, metadata);
      if (!res?.success) throw new Error(res?.error || 'comment failed');
      toast.success(t('comments.section.posted'));
      onClose();
      return true;
    } catch (err) {
      console.error('Audio comment failed:', err);
      toast.error(t('comments.section.postFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="audio-np-comment"
      aria-label={t('comments.section.commentTab')}
      // Escape only while focus is in here, so it never fights the player's menus.
      // Keys from the picker's popover bubble up here through its portal: not ours;
      // the :shortcode: list stops its own Escape.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !e.currentTarget.contains(e.target)) return;
        e.stopPropagation();
        close();
      }}
    >
      <div className="audio-np-comment-head">
        <span className="v2-eyebrow audio-np-comment-label">{t('comments.section.commentTab')}</span>
        {title && <span className="audio-np-comment-on" title={title}>{title}</span>}
        <button
          type="button"
          className="audio-np-comment-close"
          onClick={close}
          disabled={busy}
          aria-label={t('common.actions.close')}
          title={t('common.actions.close')}
        ><Icon name="close" size={18} /></button>
      </div>
      <Composer
        value={text}
        onChange={setText}
        inputRef={inputRef}
        className="audio-np-comment-editor"
        textareaClassName="audio-np-comment-input"
        textareaProps={{ maxLength: 10000 }}
        placeholder={t('comments.section.commentPlaceholder')}
        rows={5}
        disabled={busy}
        pickerProps={{ portal: true }}
        polls
        extraTools={atSec > 0 && (
          <label className={`audio-np-comment-at${withTime ? ' is-on' : ''}`}>
            <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} disabled={busy} />
            <Icon name="schedule" size={16} />
            <span>{t('comments.section.atTime', { time: fmt(atSec) })}</span>
          </label>
        )}
        onSubmit={post}
        submitting={busy}
        submitLabel={busy ? t('comments.section.saving') : t('comments.section.commentButton')}
      />
    </section>
  );
}
