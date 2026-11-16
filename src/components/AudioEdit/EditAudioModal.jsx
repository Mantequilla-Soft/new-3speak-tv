import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { getHiveClient } from '../../utils/hiveNode';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL, CHECKER_API_KEY } from '../../utils/config';
import { commentWithAioha } from '../../hive-api/aioha';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { splitAudioBody, joinAudioBody } from '../../utils/audioPostBody';
import ModalHeader from '../ModalHeader/ModalHeader';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import '../playVideo/EditVideoModal.scss';
import './EditAudioModal.scss';
import Composer from '../common/Composer/Composer';

// Every toast from this module is headed "Audio"; see utils/toast.js.
const toast = toastIn('Audio');

const TITLE_MAX = 250;
const MAX_TAGS = 10;
// What the uploader posts with when the creator gave no tags (AudioUploadModal).
const DEFAULT_TAGS = ['audio', 'three-speak', 'mantequilla'];

const parseTags = (input) => [...new Set(
  String(input || '').toLowerCase().split(/[\s,]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean),
)];

// When the checker is asked to re-read an edited title (see save()).
const RESYNC_AFTER_MS = [6000, 30000];

/**
 * Edit an audio post on Hive: its title, show notes, tags and cover. It
 * broadcasts a `comment` with the same author and permlink. The audio file, the
 * player link and the sound credits in the body, the payout terms and every
 * other json_metadata key stay as they are.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {string} author    the post's author (the signed-in user)
 * @param {string} permlink  the Hive post's permlink
 * @param {string} [rowTitle] the audio row's title: what a snap (no Hive title) shows
 * @param {(changes: { title, body, json_metadata, cover }) => void} onSaved
 */
export default function EditAudioModal({ isOpen, onClose, author, permlink, rowTitle = '', onSaved }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  // The post as it is on chain, and its body in pieces (utils/audioPostBody.js).
  const [original, setOriginal] = useState(null);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  // The post's category (its community or first tag) can't change on Hive, so
  // that tag stays, shown locked, like on the video edit.
  const [systemTags, setSystemTags] = useState([]);
  const [cover, setCover] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const coverInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !author || !permlink) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const post = await getHiveClient().call('condenser_api', 'get_content', [author, permlink]);
        if (cancelled) return;
        if (!post?.author) {
          setLoadError(t('watch.edit.errors.notFound'));
          return;
        }
        let meta = {};
        try { meta = JSON.parse(post.json_metadata || '{}') || {}; } catch { /* keep {} */ }
        const parts = splitAudioBody(post.body || '');
        const metaTags = Array.isArray(meta.tags) ? meta.tags.map((x) => String(x).toLowerCase()) : [];
        const category = String(post.category || '').toLowerCase();
        const startCover = parts.coverUrl || (Array.isArray(meta.image) ? meta.image[0] || '' : '');
        // A snap has no Hive title; its cards show the audio row's title, so
        // that is what the field starts from.
        const startTitle = String(post.title || '').trim() || String(rowTitle || '').trim();
        setOriginal({ post, meta, parts, cover: startCover, tags: metaTags, title: startTitle });
        setTitle(startTitle);
        setNotes(parts.notes);
        setSystemTags(metaTags.filter((x) => x === category));
        setTagsInput(metaTags.filter((x) => x !== category).join(' '));
        setCover(startCover);
      } catch (err) {
        console.error('Failed to load audio post for edit:', err);
        if (!cancelled) setLoadError(t('watch.edit.errors.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, author, permlink, rowTitle, t]);

  // Start clean every time it opens.
  useEffect(() => {
    if (isOpen) return;
    setOriginal(null);
    setTitle('');
    setNotes('');
    setTagsInput('');
    setSystemTags([]);
    setCover('');
    setLoadError(null);
    setSaving(false);
  }, [isOpen]);

  // A standalone post and an album track need a title. A snap (a reply under
  // the snaps container) has none on Hive: its title is optional, and written
  // to the post only when the creator changes it.
  const titleRequired = !!original && (!original.post.parent_author || !!original.post.title);
  const parsedTags = useMemo(() => parseTags(tagsInput), [tagsInput]);
  const userTagLimit = Math.max(1, MAX_TAGS - systemTags.length);
  const finalTags = useMemo(() => {
    const all = [...new Set([...systemTags, ...parsedTags])];
    return all.length ? all : DEFAULT_TAGS;
  }, [systemTags, parsedTags]);

  const titleLen = title.trim().length;
  const titleValid = titleLen <= TITLE_MAX && (!titleRequired || titleLen > 0);
  const tagsValid = parsedTags.length <= userTagLimit;
  const coverValid = !cover.trim() || /^https?:\/\//i.test(cover.trim());

  const titleDirty = !!original && title.trim() !== original.title;
  const notesDirty = !!original && notes.trim() !== original.parts.notes;
  // A post without tags in its metadata counts as having the default ones.
  const tagsDirty = !!original
    && finalTags.join(' ') !== (original.tags.length ? original.tags : DEFAULT_TAGS).join(' ');
  // An emptied field keeps the current cover: the checker has no "no cover".
  const coverDirty = !!original && !!cover.trim() && cover.trim() !== original.cover;
  const isDirty = titleDirty || notesDirty || tagsDirty || coverDirty;
  const ready = !loading && !loadError && !!original;
  const canSave = ready && isDirty && titleValid && tagsValid && coverValid && !saving && !coverUploading;

  const onPickCover = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('watch.edit.errors.notImage')); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t('watch.edit.errors.imageTooLarge')); return; }
    setCoverUploading(true);
    try {
      setCover(await uploadThumbnail(file, author));
    } catch (err) {
      console.error('Cover upload failed:', err);
      toast.error(err?.message || t('watch.edit.errors.thumbUploadFailed'));
    } finally {
      setCoverUploading(false);
    }
  };

  const save = async (e) => {
    e?.preventDefault?.();
    if (!canSave) return;
    setSaving(true);
    try {
      const { post, meta, parts } = original;
      const newCover = coverDirty ? cover.trim() : original.cover;
      const newTitle = titleDirty ? title.trim() : (post.title || '');
      const body = joinAudioBody({
        ...parts,
        notes,
        // The cover line follows the title, the way the uploader writes it.
        coverUrl: parts.hasHead ? (coverDirty ? newCover : parts.coverUrl) : '',
        coverAlt: titleDirty && newTitle ? newTitle : (parts.coverAlt || newTitle),
      });
      const newMeta = { ...meta, tags: finalTags };
      if (coverDirty) {
        newMeta.image = [newCover, ...(Array.isArray(meta.image) ? meta.image.filter((u) => u !== newCover) : [])];
      }
      const result = await commentWithAioha(
        post.parent_author || '',
        post.parent_permlink || '',
        permlink,
        newTitle,
        body,
        newMeta,
        null, // payout terms stay as they are
      );
      if (!result?.success) throw new Error(result?.error || t('watch.edit.errors.broadcastFailed'));

      // The cards read the audio row's cover: update it now, not on the next sync.
      // The checker finds the row by its linked post too.
      if (coverDirty && CHECKER_API_KEY) {
        axios.put(
          `${CHECKER_URL}/video/thumbnail`,
          { owner: author, permlink, thumbnail: newCover },
          { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
        ).catch((err) => console.warn('Audio cover update on the checker failed:', err?.message));
      }

      // Cards, search and RSS read the title the checker keeps, which it only
      // re-reads on its own for a week after upload: ask it to read this post
      // again. It reads the title from Hive, so wait for the edit to land in a
      // block; the second ask covers a slow node.
      if (titleDirty && CHECKER_API_KEY) {
        for (const ms of RESYNC_AFTER_MS) {
          setTimeout(() => {
            axios.post(
              `${CHECKER_URL}/audio/resync`,
              { author, permlink },
              { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
            ).catch((err) => console.warn('Audio title refresh on the checker failed:', err?.message));
          }, ms);
        }
      }

      toast.success(t('audio.edit.updated'));
      onSaved?.({ title: newTitle, body, json_metadata: JSON.stringify(newMeta), cover: coverDirty ? newCover : null });
      onClose();
    } catch (err) {
      console.error('Audio edit failed:', err);
      toast.error(err?.message || t('watch.edit.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="v2-dialog edit-video-modal-overlay" onClick={onClose}>
      <form
        className="v2-dialog__panel edit-video-modal-content edit-audio-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eam-title"
        noValidate
      >
        <div className="v2-dialog__grab" aria-hidden="true" />
        <ModalHeader className="evm-header" title={t('audio.edit.title')} titleId="eam-title" onClose={onClose} />
        <p className="edit-video-subtitle">@{author}/{permlink}</p>

        <div className="evm-body">
          {loading && (
            <div className="edit-video-loading" role="status">
              <Icon name="progress_activity" size={18} className="v2-spin" />
              {t('watch.edit.loading')}
            </div>
          )}
          {loadError && !loading && (
            <div className="edit-video-error v2-failure" role="alert"><b>{loadError}</b></div>
          )}

          {ready && (
            <div className="evm-panel">
              <div className="evm-details-top eam-top">
                <div className="eam-cover">
                  <div className="eam-cover__img v2-thumb r16">
                    {cover.trim() ? (
                      <img
                        src={cover.trim()}
                        alt={t('audio.edit.coverAlt')}
                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        onLoad={(e) => { e.currentTarget.style.visibility = 'visible'; }}
                      />
                    ) : (
                      <div className="edit-video-thumb-placeholder"><Icon name="music_note" size={28} /></div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size={40}
                    icon="upload"
                    loading={coverUploading}
                    onClick={() => coverInputRef.current?.click()}
                    disabled={coverUploading || saving}
                    title={t('watch.edit.uploadImage')}
                  >
                    {coverUploading ? t('watch.edit.uploading') : t('common.actions.upload')}
                  </Button>
                  <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={onPickCover} />
                </div>

                <div className="evm-details-fields">
                  <div className={cx('v2-field', 'evm-field', !titleValid && 'is-error')}>
                    <label className="v2-eyebrow" htmlFor="eam-title-input">{t('watch.edit.titleLabel')}</label>
                    <input
                      id="eam-title-input"
                      type="text"
                      className="v2-input h44"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={TITLE_MAX}
                    />
                    <span className={cx('v2-field__hint', 'edit-video-hint', !titleValid && 'error')}>{titleLen}/{TITLE_MAX}</span>
                  </div>

                  <div className={cx('v2-field', 'evm-field', !coverValid && 'is-error')}>
                    <label className="v2-eyebrow" htmlFor="eam-cover-input">{t('audio.edit.cover')}</label>
                    <input
                      id="eam-cover-input"
                      type="url"
                      className="v2-input h44"
                      value={cover}
                      onChange={(e) => setCover(e.target.value)}
                      placeholder="https://..."
                      disabled={coverUploading}
                    />
                    <span className={cx('v2-field__hint', 'edit-video-hint', !coverValid && 'error')}>{t('audio.edit.coverHint')}</span>
                  </div>

                  <div className={cx('v2-field', 'evm-field', !tagsValid && 'is-error')}>
                    <label className="v2-eyebrow" htmlFor="eam-tags-input">{t('watch.edit.tags')}</label>
                    <input
                      id="eam-tags-input"
                      type="text"
                      className="v2-input h44"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder={t('watch.edit.tagsPlaceholder')}
                    />
                    <div className="edit-video-tags-preview">
                      {systemTags.map((tag) => (
                        <span key={`sys-${tag}`} className="tag--auto" title={t('watch.edit.autoTag')}>
                          <Icon name="lock" size={12} />{tag}
                        </span>
                      ))}
                      {parsedTags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <span className={cx('v2-field__hint', 'edit-video-hint', !tagsValid && 'error')}>
                      {t('watch.edit.tagCount', { count: parsedTags.length, max: userTagLimit })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="v2-field evm-field evm-field--grow">
                <label className="v2-eyebrow" htmlFor="eam-notes-input">{t('watch.edit.description')}</label>
                {/* The one editor (common/Composer), as on every post field. */}
                <Composer
                  mode="full"
                  expandable={false}
                  value={notes}
                  onChange={setNotes}
                  placeholder={t('audio.edit.notesPlaceholder')}
                  textareaProps={{ id: 'eam-notes-input' }}
                />
                <span className="v2-field__hint edit-video-hint">{t('watch.edit.markdownHint')}</span>
                {original.parts.hasHead && (
                  <p className="evm-note">
                    <Icon name="info" size={16} />
                    <span>{t('audio.edit.keptNote')}</span>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="v2-dialog__foot evm-footer">
          <Button
            type="submit"
            variant="primary"
            size={56}
            trailing="check"
            loading={saving}
            className="edit-video-btn-primary is-next"
            disabled={!canSave}
          >
            {saving ? t('common.actions.saving') : t('watch.edit.saveChanges')}
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
