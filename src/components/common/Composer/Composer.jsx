import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../v2/Icon';
import { Button } from '../../v2/ui';
import { cx } from '../../v2/helpers';
import { useAppStore } from '../../../lib/store';
import { toastIn } from '../../../utils/toast';
import { insertAtCursor, gifMarkdown } from '../../../utils/composerInsert';
import { getHiveRenderer, getPostBodyRenderer } from '../../../lib/hiveRenderer';
import useEmojiShortcodes from '../../../hooks/useEmojiShortcodes';
import { useCommentImageUpload, CommentImageButton, CommentDropZone } from '../../playVideo/commentTools';
import EmojiGifPicker from '../EmojiGifPicker/EmojiGifPicker';
import FocusWriterButton from '../FocusWriter/FocusWriterButton';
import PollEditor, { PollToggle } from '../../Polls/PollEditor';
import { buildPollMeta, openPollFields, POLL_MIN_OPTIONS, POLL_MAX_OPTIONS } from '../../../lib/polls';
import { wrap, prefixLine, insertAt, link, TABLE } from './format';
import '../../studio/MarkdownComposer.scss';
import './Composer.scss';

const toast = toastIn('Comment');
const plainPreview = (render, text) => render(text);

// The preview renders the way the destination does: a video description never
// embeds a 3Speak player (its page already plays one), a snap or a comment does.
const RENDERERS = { 'post-body': getPostBodyRenderer, snap: getHiveRenderer, comment: getHiveRenderer };

// One 28px toolbar button: an icon, its name as the tooltip and label.
function Tool({ icon, title, onClick, ...rest }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/**
 * THE editor of 3Speak: every post field (descriptions, snaps, Shorts text)
 * and every comment or reply box is this one, so a tool added here reaches all
 * of them.
 *
 * Two views of the same editor:
 * - full: the formatting toolbar, Editor | Split | Preview, every tool. Posts
 *   open here (`mode="full"`).
 * - compact: the box with a row of tools (emoji / GIF, image, poll, focus
 *   mode) and Write / Preview. Comments open here; the expand button switches
 *   to full and back (`expandable`).
 *
 * Both bring `:shortcode:` emojis, images (button, paste, drop), focus mode,
 * a poll (`polls`, Hive logins only) and Ctrl/Cmd+Enter to post.
 *
 * The text is the parent's (`value` / `onChange`). With `onSubmit` the editor
 * has its own Cancel / submit buttons and calls `onSubmit({ text, meta })`,
 * `meta` holding the poll's json_metadata fields (empty without a poll);
 * return false when posting failed, so the poll stays for another try. A post
 * form posts by itself and reads the poll from `pollState` (controlled).
 *
 * Compact layouts: `stacked` (box, then tools and buttons) or `inline` (box,
 * tools and a round send button in one row, as on Shorts).
 */
export default function Composer({
  value,
  onChange,
  inputRef: outerRef,
  placeholder,
  mode = 'compact',
  expandable = mode === 'compact',
  previewContext = mode === 'full' ? 'post-body' : 'comment',
  rows = 2,
  disabled = false,
  autoFocus = false,
  layout = 'stacked',
  className = '',
  rowClassName = '',
  dropClassName = '',
  toolsClassName = '',
  textareaClassName = 'textarea-box',
  textareaProps = {},
  toHtml = plainPreview,
  previewClassName = '',
  previewMarkdownClass = '',
  onPreviewClick,
  tabsLead = null,
  tools = true,
  polls = false,
  pollState = null,
  extraTools = null,
  pickerProps = {},
  onSubmit,
  submitting = false,
  submitLabel,
  submitIcon = 'send',
  submitClassName = '',
  submitIconSize = 20,
  rowProps = {},
  canSubmit = true,
  onCancel,
  cancelLabel,
  beforeSubmit = null,
  onUploadingChange,
}) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const ownRef = useRef(null);
  const inputRef = outerRef || ownRef;
  const emoji = useEmojiShortcodes(inputRef, value, onChange);
  const images = useCommentImageUpload(inputRef, value, onChange, user || incubationHandle);
  const [full, setFull] = useState(mode === 'full');
  const getRenderer = RENDERERS[previewContext] || getHiveRenderer;

  // The poll: the parent's (`pollState`, a post form) or the editor's own.
  const [ownPollOn, setOwnPollOn] = useState(false);
  const [ownOptions, setOwnOptions] = useState(['', '']);
  const [ownDays, setOwnDays] = useState(1);
  const poll = pollState || { on: ownPollOn, setOn: setOwnPollOn, options: ownOptions, setOptions: setOwnOptions, days: ownDays, setDays: setOwnDays };
  // A poll goes on Hive: a warm-up account (no Hive login) gets none.
  const pollAllowed = polls && !!user && !disabled;
  const pollShown = pollAllowed && poll.on;

  useEffect(() => { onUploadingChange?.(images.uploading); }, [images.uploading, onUploadingChange]);

  // Switching view puts the caret back in the (new) box.
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [full, inputRef]);
  const toggleFull = () => { switched.current = true; setFull((v) => !v); };

  const submit = async () => {
    if (!onSubmit || submitting || disabled || !canSubmit || !String(value || '').trim()) return;
    let meta = {};
    if (pollShown) {
      const built = buildPollMeta(poll.options, poll.days);
      if (!built) { toast.error(t('social.polls.invalid', { min: POLL_MIN_OPTIONS, max: POLL_MAX_OPTIONS })); return; }
      meta = { poll: built, ...openPollFields(value, built) };
    }
    const ok = await onSubmit({ text: value, meta });
    if (ok !== false && pollShown && !pollState) { setOwnPollOn(false); setOwnOptions(['', '']); setOwnDays(1); }
  };

  const textarea = ({ onResize, onFormatKey, ...extra } = {}) => (
    <textarea
      ref={inputRef}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      {...textareaProps}
      {...extra}
      onChange={(e) => {
        onChange(emoji.change(e));
        onResize?.(e.target);
      }}
      onKeyDown={(e) => {
        if (emoji.keyDown(e)) return;
        if (onFormatKey?.(e)) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) { e.preventDefault(); submit(); return; }
        textareaProps.onKeyDown?.(e);
      }}
      onBlur={(e) => { emoji.blur(e); textareaProps.onBlur?.(e); }}
      onPaste={(e) => { images.onPaste(e); textareaProps.onPaste?.(e); }}
    />
  );

  const pickEmoji = (em) => insertAtCursor(inputRef.current, value, em, onChange);
  const pickGif = (url) => insertAtCursor(inputRef.current, value, gifMarkdown(url), onChange);
  const sharedTools = (
    <>
      <CommentImageButton uploading={images.uploading} onFiles={images.upload} />
      {pollAllowed && <PollToggle on={poll.on} onToggle={() => poll.setOn(!poll.on)} />}
      <FocusWriterButton value={value} setValue={onChange} inputRef={inputRef} placeholder={placeholder} />
    </>
  );

  const pollEditor = pollShown && (
    <PollEditor options={poll.options} onOptions={poll.setOptions} days={poll.days} onDays={poll.setDays} />
  );

  const blocked = disabled || submitting || !canSubmit || !String(value || '').trim();
  const actions = (onSubmit || onCancel) && (
    <div className="btn-wrap">
      {onCancel && (
        <Button variant="ghost" size={32} onClick={onCancel} disabled={submitting}>
          {cancelLabel || t('common.actions.cancel')}
        </Button>
      )}
      {onSubmit && (
        <Button variant="primary" size={32} trailing={submitIcon || undefined} loading={submitting} disabled={blocked} className={submitClassName} onClick={submit}>
          {submitLabel || t('comments.section.commentButton')}
        </Button>
      )}
    </div>
  );

  if (full) {
    return (
      <FullView
        t={t}
        value={value}
        onChange={onChange}
        inputRef={inputRef}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        textarea={textarea}
        emojiPopup={emoji.popup}
        images={images}
        getRenderer={getRenderer}
        toHtml={toHtml}
        onPreviewClick={onPreviewClick}
        tools={tools && !disabled && (
          <>
            <EmojiGifPicker portal onPickEmoji={pickEmoji} onPickGif={pickGif} />
            {sharedTools}
            {expandable && <Tool icon="close_fullscreen" title={t('comments.editor.compact')} onClick={toggleFull} />}
          </>
        )}
        pollEditor={pollEditor}
        footer={(actions || extraTools || tabsLead) && (
          <div className="comment-form-row">
            <div className="comment-compose-tools">{tabsLead}{extraTools}</div>
            {actions}
          </div>
        )}
      />
    );
  }

  const box = (
    <CommentDropZone
      className={dropClassName}
      images={images}
      value={value}
      setValue={onChange}
      disabled={disabled}
      toHtml={value || tabsLead ? toHtml : null}
      getRenderer={getRenderer}
      previewClassName={previewClassName}
      previewMarkdownClass={previewMarkdownClass}
      onPreviewClick={onPreviewClick}
      tabsLead={tabsLead}
    >
      {textarea({ rows, className: textareaClassName, onResize: (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } })}
      {emoji.popup}
    </CommentDropZone>
  );

  const toolButtons = tools && !disabled && (
    <>
      <EmojiGifPicker {...pickerProps} onPickEmoji={pickEmoji} onPickGif={pickGif} />
      {sharedTools}
      {expandable && (
        <button type="button" className="egp-btn" onClick={toggleFull} title={t('comments.editor.full')} aria-label={t('comments.editor.full')}>
          <Icon name="open_in_full" size={18} />
        </button>
      )}
      {extraTools}
    </>
  );

  if (layout === 'inline') {
    return (
      <div className={cx('composer is-compact is-inline', className)}>
        {pollEditor}
        <div className={cx('composer__row', rowClassName)} {...rowProps}>
          {box}
          {toolButtons && <span className={cx('composer__tools', toolsClassName)}>{toolButtons}</span>}
          {beforeSubmit}
          {onSubmit && (
            <button
              type="button"
              className={cx('composer__send', submitClassName)}
              onClick={submit}
              disabled={blocked}
              aria-label={submitLabel || t('comments.section.commentButton')}
            >
              {submitting ? <Icon name="progress_activity" size={submitIconSize} className="v2-spin" /> : <Icon name={submitIcon} size={submitIconSize} />}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cx('composer is-compact is-stacked', className)}>
      {box}
      {pollEditor}
      <div className="comment-form-row">
        <div className={cx('comment-compose-tools', toolsClassName)}>{toolButtons}</div>
        {actions}
      </div>
    </div>
  );
}

/**
 * The full view: toolbar, Editor | Split | Preview, the editor and preview
 * wells (styles of studio/MarkdownComposer.scss, which post forms size by
 * `.markdown-composer`).
 */
function FullView({
  t, value, onChange, inputRef, placeholder, disabled, className, textarea, emojiPopup, images,
  getRenderer, toHtml, onPreviewClick, tools, pollEditor, footer,
}) {
  const [viewMode, setViewMode] = useState('editor');
  const [headers, setHeaders] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [html, setHtml] = useState('');

  // The box grows with the text, up to the composer's max-height (set by the
  // post form) minus the toolbar and the mode switch.
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const composer = el.closest('.markdown-composer');
    const maxH = composer ? parseFloat(getComputedStyle(composer).maxHeight) : Infinity;
    const chrome = composer ? composer.offsetHeight - el.offsetHeight : 0;
    el.style.height = 'auto';
    const cap = Number.isFinite(maxH) ? Math.max(110, maxH - chrome) : Infinity;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [inputRef]);
  useLayoutEffect(() => { autoResize(); }, [value, viewMode, autoResize]);

  useEffect(() => {
    if (viewMode === 'editor' || !value) { setHtml(''); return undefined; }
    let alive = true;
    getRenderer()
      .then((render) => { if (alive) setHtml(toHtml(render, value)); })
      .catch(() => { if (alive) setHtml(`<p>${t('studio.composer.renderError')}</p>`); });
    return () => { alive = false; };
  }, [value, viewMode, getRenderer, toHtml, t]);

  // A toolbar edit: the new text, then the caret where the edit says.
  const apply = (edit) => {
    const el = inputRef.current;
    if (!el) return;
    const { text, caret } = edit(value, el.selectionStart, el.selectionEnd);
    onChange(text);
    setTimeout(() => { el.focus(); el.setSelectionRange(caret, caret); }, 0);
  };
  const wrapWith = (before, after) => apply((v, s, e) => wrap(v, s, e, before, after));
  const lineWith = (prefix) => apply((v, s) => prefixLine(v, s, prefix));
  // Ctrl/Cmd+B and +I, as the Bold and Italic buttons say.
  const onFormatKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
    const k = e.key.toLowerCase();
    if (k !== 'b' && k !== 'i') return false;
    e.preventDefault();
    wrapWith(k === 'b' ? '**' : '*');
    return true;
  };
  const addLink = () => {
    const url = window.prompt(t('studio.composer.enterUrl'));
    if (url) apply((v, s, e) => link(v, s, e, url, 'link text'));
  };

  const MODES = [
    { id: 'editor', label: t('studio.composer.editorOnly') },
    { id: 'split', label: t('studio.composer.splitView') },
    { id: 'preview', label: t('studio.composer.previewOnly') },
  ];

  const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  return (
    <div className={cx('composer is-full markdown-composer', className)}>
      {!disabled && (
        <div className="composer-toolbar" role="toolbar" aria-label={t('comments.editor.toolbar')}>
          <Tool icon="format_bold" title={t('studio.composer.bold')} onClick={() => wrapWith('**')} />
          <Tool icon="format_italic" title={t('studio.composer.italic')} onClick={() => wrapWith('*')} />
          <Tool icon="format_underlined" title={t('studio.composer.underline')} onClick={() => wrapWith('<u>', '</u>')} />
          <Tool icon="strikethrough_s" title={t('studio.composer.strikethrough')} onClick={() => wrapWith('~~')} />
          <div className="dropdown-wrapper">
            <Tool icon="title" title={t('studio.composer.headers')} onClick={() => setHeaders((v) => !v)} className={headers ? 'active' : ''} aria-expanded={headers} />
            {headers && (
              <div className="dropdown-menu">
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <button key={level} type="button" onClick={() => { setHeaders(false); lineWith(`${'#'.repeat(level)} `); }}>
                    H{level}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Tool icon="format_list_bulleted" title={t('studio.composer.bulletList')} onClick={() => lineWith('- ')} />
          <Tool icon="format_list_numbered" title={t('studio.composer.numberedList')} onClick={() => lineWith('1. ')} />
          <Tool icon="format_quote" title={t('studio.composer.quote')} onClick={() => lineWith('> ')} />
          <Tool icon="code" title={t('studio.composer.codeBlock')} onClick={() => wrapWith('\n```\n', '\n```\n')} />
          <Tool icon="link" title={t('studio.composer.insertLink')} onClick={addLink} />
          <Tool icon="table" title={t('studio.composer.insertTable')} onClick={() => apply((v, s, e) => insertAt(v, s, e, TABLE))} />
          <Tool
            icon="visibility_off"
            title={t('studio.composer.spoiler')}
            onClick={() => wrapWith(`\n<details>\n<summary>Click to reveal</summary>\n\n`, '\n\n</details>\n')}
          />
          {tools && <span className="composer-toolbar__sep" aria-hidden="true" />}
          {tools}
        </div>
      )}

      <div className="v2-seg is-block composer-modes" role="group">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`v2-seg__opt h28${viewMode === m.id ? ' is-on' : ''}`}
            aria-pressed={viewMode === m.id}
            onClick={() => setViewMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className={`composer-content ${viewMode}`}>
        {/* Kept mounted in Preview (hidden): the caret and the ref every tool
            inserts through survive. */}
        <div
          className={`editor-panel ${dragOver ? 'drag-over' : ''}`}
          hidden={viewMode === 'preview'}
          onDragOver={(e) => { if (carriesFiles(e)) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { setDragOver(false); images.onDrop(e); }}
        >
          {textarea({ spellCheck: true, placeholder: placeholder ?? t('studio.composer.placeholder'), onFormatKey })}
          {emojiPopup}
          {dragOver && (
            <div className="drag-overlay">
              <Icon name="add_photo_alternate" size={28} />
              <span>{t('studio.composer.dropImage')}</span>
            </div>
          )}
          {images.uploading && (
            <div className="upload-overlay" role="status">
              <Icon name="progress_activity" size={20} className="v2-spin" />
              <span>{t('studio.composer.uploadingImage')}</span>
            </div>
          )}
        </div>

        {viewMode !== 'editor' && (
          <div className="preview-panel">
            {html ? (
              <div className="preview-content markdown-view" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="preview-placeholder">{t('studio.composer.previewPlaceholder')}</div>
            )}
          </div>
        )}
      </div>

      {pollEditor}
      {footer}
    </div>
  );
}
