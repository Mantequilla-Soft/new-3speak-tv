import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import ModalHeader from '../ModalHeader/ModalHeader';
import { commentWithAioha } from '../../hive-api/aioha';
import { usePortalDoc } from '../../utils/portalDocument';
import { toastIn } from '../../utils/toast';
import './AudioCommentModal.scss';

const toast = toastIn('Comment');

const fmt = (s) => {
  const v = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = String(v % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * Comment on the Hive post of the audio playing, from the expanded player.
 * Optionally tied to the moment it was opened at (`parentTimestamp`, the way the
 * watch page's comment box does it). Portals into the player's document, so it
 * also opens in the pop-out window (utils/portalDocument.js).
 *
 * @param {string}   author     the track's owner (the Hive post author)
 * @param {string}   permlink   the Hive post permlink
 * @param {string}   title      the track title, for the header
 * @param {number}   at         seconds into the track when the popup opened
 * @param {Function} onClose
 */
export default function AudioCommentModal({ author, permlink, title, at, onClose }) {
  const { t } = useTranslation();
  const doc = usePortalDoc();
  const [text, setText] = useState('');
  const [withTime, setWithTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const atSec = Math.floor(at || 0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [doc, busy, onClose]);

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

  return createPortal(
    <div className="audio-comment-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="audio-comment-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={t('comments.section.commentTab')} onClose={busy ? undefined : onClose} />
        {title && <p className="audio-comment-on">{title}</p>}
        <textarea
          ref={inputRef}
          className="audio-comment-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); }}
          placeholder={t('comments.section.commentPlaceholder')}
          rows={4}
          maxLength={10000}
          disabled={busy}
        />
        <div className="audio-comment-foot">
          {atSec > 0 ? (
            <label className="audio-comment-at">
              <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} disabled={busy} />
              <span>{t('comments.section.atTime', { time: fmt(atSec) })}</span>
            </label>
          ) : <span />}
          <button type="button" className="audio-comment-post" onClick={post} disabled={busy || !text.trim()}>
            {busy ? t('comments.section.saving') : t('comments.section.commentButton')}
          </button>
        </div>
      </div>
    </div>,
    doc.body,
  );
}
