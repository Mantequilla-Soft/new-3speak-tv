/**
 * Comment tools shared by the watch page (CommentSection) and the Shorts comment
 * panel (page/Short.jsx): the viewer's sort order, creator pins first, and images
 * uploaded the way thumbnails are.
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation as useI18n } from 'react-i18next';
import { ImSpinner9 } from 'react-icons/im';
import { MdImage, MdClose } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { insertAtCursor } from '../../utils/composerInsert';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { getHiveRenderer } from '../../lib/hiveRenderer';
import MarkdownView from '../common/MarkdownView';
import './commentTools.scss';

const toast = toastIn('Comment');

// The viewer's comment order, a setting they chose (consent-exempt, see
// lib/consent.js). Replies under a comment always stay in conversation order.
const COMMENT_SORT_KEY = '3speak_comment_sort';
const COMMENT_SORTS = ['newest', 'oldest', 'popular'];
export function readCommentSort() {
  try {
    const v = localStorage.getItem(COMMENT_SORT_KEY);
    return COMMENT_SORTS.includes(v) ? v : 'newest';
  } catch {
    return 'newest';
  }
}
export function saveCommentSort(v) {
  try { localStorage.setItem(COMMENT_SORT_KEY, v); } catch { /* storage blocked */ }
}

// Comments come as `created_at` (watch page, off-chain replies) or `createdAt`
// (shorts). Hive's `created` has no zone ("2026-10-22T09:00:00") and is UTC; a comment
// posted from here carries a full ISO string. Read both as UTC, or a fresh
// comment sorts hours away from the fetched ones.
const createdMs = (c) => {
  const s = c?.created_at || c?.createdAt;
  if (!s) return 0;
  const ms = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : 0;
};
// Popular: likes, then replies (a conversation is worth more than a silent
// like), then payout, then the newer one.
const popularity = (c) => (c?.stats?.num_likes || 0) + 2 * (c?.children?.length || 0);
export function sortComments(list, sort) {
  const out = [...list];
  if (sort === 'oldest') out.sort((a, b) => createdMs(a) - createdMs(b));
  else if (sort === 'popular') {
    out.sort((a, b) => (popularity(b) - popularity(a))
      || ((b?.stats?.total_hive_reward || 0) - (a?.stats?.total_hive_reward || 0))
      || (createdMs(b) - createdMs(a)));
  } else out.sort((a, b) => createdMs(b) - createdMs(a));
  return out;
}

const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_COMMENT_IMAGES_AT_ONCE = 4;
const hasImageFile = (files) => [...(files || [])].some((f) => f?.type?.startsWith('image/'));

/**
 * Images in a comment, uploaded exactly like thumbnails (utils/uploadThumbnail)
 * and dropped into the text as markdown at the caret. From the image button,
 * a paste, or a file dropped on the box (see CommentDropZone).
 *
 * `pending` lists the images still uploading, as local object URLs, so the
 * preview strip can show them before their markdown exists.
 */
export function useCommentImageUpload(inputRef, value, setValue, username) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState([]);
  // The text as it is when an upload finishes, not when it started: typing goes
  // on while the image uploads.
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const upload = useCallback(async (files) => {
    const images = [...(files || [])].filter((f) => f?.type?.startsWith('image/')).slice(0, MAX_COMMENT_IMAGES_AT_ONCE);
    if (!images.length) return;
    setUploading(true);
    try {
      for (const file of images) {
        if (file.size > MAX_COMMENT_IMAGE_BYTES) {
          toast.error(t('comments.section.imageTooLarge'));
          continue;
        }
        const local = { id: `${Date.now()}-${Math.random()}`, url: URL.createObjectURL(file) };
        setPending((p) => [...p, local]);
        let url;
        try {
          url = await uploadThumbnail(file, username || undefined);
        } finally {
          setPending((p) => p.filter((x) => x.id !== local.id));
          URL.revokeObjectURL(local.url);
        }
        // A one-line <input> (the shorts reply box) drops line breaks, so the
        // image goes in inline there; a textarea gets it on its own lines.
        const md = inputRef.current?.tagName === 'INPUT' ? ` ![image](${url}) ` : `\n![image](${url})\n`;
        insertAtCursor(inputRef.current, valueRef.current, md, (next) => {
          valueRef.current = next;
          setValue(next);
        });
      }
    } catch (err) {
      console.error('Comment image upload failed:', err);
      toast.error(t('comments.section.imageUploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [inputRef, setValue, username, t]);

  const onPaste = useCallback((e) => {
    if (!hasImageFile(e.clipboardData?.files)) return;
    e.preventDefault();
    upload(e.clipboardData.files);
  }, [upload]);
  const onDrop = useCallback((e) => {
    if (!hasImageFile(e.dataTransfer?.files)) return;
    e.preventDefault();
    upload(e.dataTransfer.files);
  }, [upload]);

  return { uploading, pending, upload, onPaste, onDrop };
}

export function CommentImageButton({ uploading, onFiles }) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  return (
    <>
      <button
        type="button"
        className="egp-btn"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        aria-label={t('comments.section.addImage')}
        title={t('comments.section.addImage')}
      >
        {uploading ? <ImSpinner9 className="egp-spin" size={15} /> : <MdImage size={18} />}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
      />
    </>
  );
}

// The author's pinned comments (permlinks, newest pin first) on top, then the
// rest in the order given.
export function pinnedFirst(list, pinned) {
  if (!pinned?.length) return list;
  const top = pinned.map((p) => list.find((c) => c.permlink === p)).filter(Boolean);
  return [...top, ...list.filter((c) => !pinned.includes(c.permlink))];
}

// Images in the text, as markdown: ![alt](https://...). GIFs from the picker
// count too, so every picture in the comment can be seen and taken out.
const IMAGE_MD_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

// Take one image out of the text: the occurrence at `index`, plus ONE of the
// separators around it (a line break, or a space for the inline form), so it
// leaves neither an empty line nor two words glued together.
function removeImageAt(text, index, match) {
  let start = index;
  let end = index + match.length;
  const before = text[start - 1];
  const after = text[end];
  if (after === '\n' || (after === ' ' && before === ' ')) end += 1;
  else if (before === '\n') start -= 1;
  return text.slice(0, start) + text.slice(end);
}

const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

/**
 * Wraps a comment box. While files are dragged over it, a dashed hint says the
 * image will be added; under it, a strip previews every image in the text (and
 * those still uploading), each with an x that takes it out again.
 *
 * With `toHtml(render, text)` it also gets Write / Preview tabs. The caller
 * passes the SAME transform its posted comments go through (render is the Hive
 * renderer, lib/hiveRenderer), so the preview is what the comment will look like,
 * sanitising, timestamps, mentions, images and GIFs included. `previewClassName`
 * and `previewMarkdownClass` give it the posted comment's own styling, and
 * `onPreviewClick` its click handling (timestamp seeking).
 *
 * Only drags carrying files react. A counter (enter +1, leave -1) keeps the hint
 * steady while the pointer crosses the box's children; it also clears on drop
 * and when a drag ends or drops anywhere else on the page.
 */
export function CommentDropZone({
  images, value, setValue, disabled = false, className = '', children,
  toHtml = null, previewClassName = '', previewMarkdownClass = '', onPreviewClick,
}) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const [mode, setMode] = useState('write'); // 'write' | 'preview'
  const [html, setHtml] = useState('');
  const previewing = !!toHtml && mode === 'preview' && !disabled;

  useEffect(() => {
    if (!previewing) return undefined;
    let alive = true;
    getHiveRenderer()
      .then((render) => { if (alive) setHtml(toHtml(render, value || '')); })
      .catch(() => { if (alive) setHtml(''); });
    return () => { alive = false; };
  }, [previewing, value, toHtml]);

  // Back to Write once the box is emptied by posting or Cancel, so the next
  // comment does not start in a preview of nothing.
  const prevValue = useRef(value);
  useEffect(() => {
    if (prevValue.current && !value) setMode('write');
    prevValue.current = value;
  }, [value]);
  const depth = useRef(0);
  const reset = useCallback(() => { depth.current = 0; setOver(false); }, []);

  useEffect(() => {
    if (!over) return undefined;
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, [over, reset]);

  const found = useMemo(
    () => [...(value || '').matchAll(IMAGE_MD_RE)].map((m) => ({ url: m[1], index: m.index, text: m[0] })),
    [value],
  );
  const pending = images?.pending || [];

  const dragProps = disabled ? {} : {
    onDragEnter: (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e) => { if (carriesFiles(e)) e.preventDefault(); },
    onDragLeave: (e) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDrop: (e) => { reset(); images?.onDrop(e); },
  };

  return (
    <div className={`comment-drop-zone${over ? ' is-drag-over' : ''}${className ? ` ${className}` : ''}`} {...dragProps}>
      {toHtml && !disabled && (
        <div className="comment-write-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!previewing}
            className={`comment-write-tab${!previewing ? ' active' : ''}`}
            onClick={() => setMode('write')}
          >
            {t('comments.section.write')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewing}
            className={`comment-write-tab${previewing ? ' active' : ''}`}
            onClick={() => setMode('preview')}
          >
            {t('comments.section.preview')}
          </button>
        </div>
      )}
      {/* Kept mounted while previewing: the caret, the textarea's size and the
          refs the emoji, GIF and image buttons insert through all survive. */}
      <div className="comment-write-pane" hidden={previewing}>
        {children}
      </div>
      {previewing && (
        <div className={`comment-preview${previewClassName ? ` ${previewClassName}` : ''}`} role="tabpanel">
          {(value || '').trim()
            ? <MarkdownView html={html} className={previewMarkdownClass} onClick={onPreviewClick} />
            : <p className="comment-preview-empty">{t('comments.section.nothingToPreview')}</p>}
        </div>
      )}
      {!previewing && (found.length > 0 || pending.length > 0) && (
        <div className="comment-image-previews">
          {found.map((f) => (
            <div key={`${f.index}-${f.url}`} className="comment-image-preview">
              <img src={f.url} alt="" loading="lazy" />
              {!disabled && (
                <button
                  type="button"
                  className="comment-image-remove"
                  onClick={() => setValue(removeImageAt(value || '', f.index, f.text))}
                  aria-label={t('comments.section.removeImage')}
                  title={t('comments.section.removeImage')}
                >
                  <MdClose size={12} />
                </button>
              )}
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.id} className="comment-image-preview is-uploading" title={t('comments.section.uploadingImage')}>
              <img src={p.url} alt="" />
              <ImSpinner9 className="egp-spin comment-image-spinner" size={16} aria-label={t('comments.section.uploadingImage')} />
            </div>
          ))}
        </div>
      )}
      {over && (
        <div className="comment-drop-hint" aria-hidden="true">
          <MdImage size={18} />
          <span>{t('comments.section.dropImage')}</span>
        </div>
      )}
    </div>
  );
}
