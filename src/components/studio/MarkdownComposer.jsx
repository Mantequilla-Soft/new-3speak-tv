import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '../v2/Icon';
import EmojiPicker from 'emoji-picker-react';
import { uploadImageToHive } from '../Editor/uploadImageToHiv';
import { toastIn } from '../../utils/toast';
import './MarkdownComposer.scss';
import { useAppStore } from '../../lib/store';
import useGiphySearch, { normalizeGifUrl } from '../../hooks/useGiphySearch';
import { gifMarkdown } from '../../utils/composerInsert';
import { getHiveRenderer, getPostBodyRenderer } from '../../lib/hiveRenderer';
import { useTranslation } from 'react-i18next';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

// The preview has to render the way the DESTINATION renders, or it isn't a
// preview. A video description ends up on a watch page, which never embeds a
// 3Speak video (the page is already playing one) — so pasting a 3Speak link
// here has to show a link, not a player. A snap has no player of its own, so
// snap composers pass `previewContext="snap"` and keep the embeds.
const PREVIEW_RENDERERS = {
  'post-body': getPostBodyRenderer,
  snap: getHiveRenderer,
};

// One 28px toolbar button: a 16px icon, its name as the tooltip and label.
function Tool({ icon, title, onClick, ...rest }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  );
}

const MarkdownComposer = ({ value, onChange, placeholder, previewContext = 'post-body' }) => {
  const { t } = useTranslation();
  const { theme } = useAppStore()
  const textareaRef = useRef(null);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'preview' | 'split'
  // The emoji / GIF picker (44c): one panel under the editor with Emoji and
  // GIFs tabs, opened from the toolbar's mood button. null = closed.
  const [pickerTab, setPickerTab] = useState(null); // null | 'emoji' | 'gifs'
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const { query: gifQuery, setQuery: setGifQuery, gifs, loading: gifLoading } = useGiphySearch(pickerTab === 'gifs');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [renderedContent, setRenderedContent] = useState('');

  // Auto-resize textarea to fit content, capped by the composer's max-height
  // (set by the parent) minus the toolbar, the mode switch and the picker.
  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const composer = textarea.closest('.markdown-composer');
    const maxH = composer ? parseFloat(getComputedStyle(composer).maxHeight) : Infinity;
    const chrome = composer ? composer.offsetHeight - textarea.offsetHeight : 0;
    textarea.style.height = 'auto';
    const desired = textarea.scrollHeight;
    const cap = Number.isFinite(maxH) ? Math.max(110, maxH - chrome) : Infinity;
    textarea.style.height = Math.min(desired, cap) + 'px';
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, viewMode, pickerTab, autoResize]);

  // Render preview when content or viewMode changes
  useEffect(() => {
    if (viewMode === 'editor') return;
    
    if (!value) {
      setRenderedContent('');
      return;
    }

    const getRenderer = PREVIEW_RENDERERS[previewContext] || getPostBodyRenderer;
    getRenderer().then(render => {
      try {
        setRenderedContent(render(value));
      } catch (error) {
        console.error("Error rendering content:", error);
        setRenderedContent(`<p>${t('studio.composer.renderError')}</p>`);
      }
    });
  }, [value, viewMode, previewContext, t]);

  // Helper to wrap selected text or insert at cursor
  const wrapText = useCallback((before, after = before) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    const beforeText = value.substring(0, start);
    const afterText = value.substring(end);

    const newText = beforeText + before + selectedText + after + afterText;
    onChange(newText);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = selectedText 
        ? start + before.length + selectedText.length + after.length
        : start + before.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [value, onChange]);

  // Insert text at cursor
  const insertText = useCallback((text) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const beforeText = value.substring(0, start);
    const afterText = value.substring(start);

    onChange(beforeText + text + afterText);

    setTimeout(() => {
      textarea.focus();
      const newPos = start + text.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }, [value, onChange]);

  // Toolbar actions
  const handleBold = () => wrapText('**');
  const handleItalic = () => wrapText('*');
  const handleUnderline = () => wrapText('<u>', '</u>');
  const handleStrikethrough = () => wrapText('~~');
  const handleHeader = (level) => {
    const prefix = '#'.repeat(level) + ' ';
    insertAtLineStart(prefix);
    setShowHeaderMenu(false);
  };
  const handleBulletList = () => insertAtLineStart('- ');
  const handleNumberedList = () => insertAtLineStart('1. ');
  const handleQuote = () => insertAtLineStart('> ');
  const handleCodeBlock = () => wrapText('\n```\n', '\n```\n');
  const handleSpoiler = () => wrapText('\n<details>\n<summary>Click to reveal</summary>\n\n', '\n\n</details>\n');
  
  const handleLink = () => {
    const url = prompt(t('studio.composer.enterUrl'));
    if (url) {
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = value.substring(start, end) || 'link text';
      
      const beforeText = value.substring(0, start);
      const afterText = value.substring(end);
      onChange(beforeText + `[${selectedText}](${url})` + afterText);
    }
  };

  const handleTable = () => {
    const table = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`;
    insertText(table);
  };

  // Insert at beginning of current line
  const insertAtLineStart = useCallback((prefix) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lines = value.split('\n');
    let charCount = 0;
    let lineIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= start) {
        lineIndex = i;
        break;
      }
      charCount += lines[i].length + 1;
    }

    lines[lineIndex] = prefix + lines[lineIndex];
    onChange(lines.join('\n'));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  }, [value, onChange]);

  // Emoji handler
  const handleEmojiSelect = (emojiData) => {
    insertText(emojiData.emoji);
    setPickerTab(null);
  };

  // GIF handler — insert as inline markdown image so the Hive renderer embeds it.
  const handleGifSelect = (g) => {
    const url = normalizeGifUrl(g);
    if (url) insertText(gifMarkdown(url));
    setPickerTab(null);
  };

  const togglePicker = () => setPickerTab((v) => (v ? null : 'emoji'));

  // Image upload
  const handleImageUpload = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.error(t('studio.composer.selectImage'));
      return;
    }

    setIsUploading(true);
    try {
      const url = await uploadImageToHive(file);
      insertText(`\n![${file.name}](${url})\n`);
      toast.success(t('studio.composer.imageUploaded'));
    } catch (error) {
      console.error('Image upload failed:', error);
      toast.error(t('studio.composer.imageUploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageUpload(file);
    };
    input.click();
  };

  // Drag and drop
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    for (const file of imageFiles) {
      await handleImageUpload(file);
    }
  };

  // Paste image from clipboard
  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleImageUpload(file);
        break;
      }
    }
  };

  const MODES = [
    { id: 'editor', label: t('studio.composer.editorOnly') },
    { id: 'split', label: t('studio.composer.splitView') },
    { id: 'preview', label: t('studio.composer.previewOnly') },
  ];

  return (
    <div className="markdown-composer">
      <div className="composer-toolbar" role="toolbar">
        <Tool icon="format_bold" title={t('studio.composer.bold')} onClick={handleBold} />
        <Tool icon="format_italic" title={t('studio.composer.italic')} onClick={handleItalic} />
        <Tool icon="format_underlined" title={t('studio.composer.underline')} onClick={handleUnderline} />
        <Tool icon="strikethrough_s" title={t('studio.composer.strikethrough')} onClick={handleStrikethrough} />
        <div className="dropdown-wrapper">
          <Tool icon="title" title={t('studio.composer.headers')} onClick={() => setShowHeaderMenu(!showHeaderMenu)} className={showHeaderMenu ? 'active' : ''} aria-expanded={showHeaderMenu} />
          {showHeaderMenu && (
            <div className="dropdown-menu">
              {[1, 2, 3, 4, 5, 6].map(level => (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleHeader(level)}
                >
                  H{level}
                </button>
              ))}
            </div>
          )}
        </div>
        <Tool icon="format_list_bulleted" title={t('studio.composer.bulletList')} onClick={handleBulletList} />
        <Tool icon="format_list_numbered" title={t('studio.composer.numberedList')} onClick={handleNumberedList} />
        <Tool icon="format_quote" title={t('studio.composer.quote')} onClick={handleQuote} />
        <Tool icon="code" title={t('studio.composer.codeBlock')} onClick={handleCodeBlock} />
        <Tool icon="link" title={t('studio.composer.insertLink')} onClick={handleLink} />
        <Tool icon="image" title={t('studio.composer.uploadImage')} onClick={handleImageClick} disabled={isUploading} />
        <Tool icon="table" title={t('studio.composer.insertTable')} onClick={handleTable} />
        <Tool icon="visibility_off" title={t('studio.composer.spoiler')} onClick={handleSpoiler} />
        <Tool icon="mood" title={t('studio.composer.emoji')} onClick={togglePicker} className={pickerTab ? 'active' : ''} aria-expanded={!!pickerTab} />
      </div>

      {/* Editor Only | Split View | Preview Only: a 28px segmented track. */}
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

      {/* Editor / Preview: one bg well each, side by side in Split View. */}
      <div className={`composer-content ${viewMode}`}>
        {(viewMode === 'editor' || viewMode === 'split') && (
          <div
            className={`editor-panel ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onPaste={handlePaste}
              placeholder={placeholder ?? t('studio.composer.placeholder')}
              spellCheck={false}
            />
            {isDragOver && (
              <div className="drag-overlay">
                <Icon name="add_photo_alternate" size={28} />
                <span>{t('studio.composer.dropImage')}</span>
              </div>
            )}
            {isUploading && (
              <div className="upload-overlay" role="status">
                <Icon name="progress_activity" size={20} className="v2-spin" />
                <span>{t('studio.composer.uploadingImage')}</span>
              </div>
            )}
          </div>
        )}

        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className="preview-panel">
            {renderedContent ? (
              <div
                className="preview-content markdown-view"
                dangerouslySetInnerHTML={{ __html: renderedContent }}
              />
            ) : (
              <div className="preview-placeholder">
                {t('studio.composer.previewPlaceholder')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Emoji and GIFs (44c): a bg well under the editor with two tabs over a
          fixed-height body, so switching tabs never moves the form. */}
      {pickerTab && (
        <div className="composer-picker">
          <div className="composer-picker__tabs" role="tablist">
            {[
              { id: 'emoji', label: t('studio.composer.emoji') },
              { id: 'gifs', label: t('studio.composer.gifs') },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={pickerTab === tab.id}
                className={pickerTab === tab.id ? 'is-on' : ''}
                onClick={() => setPickerTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {pickerTab === 'emoji' ? (
            <div className="composer-picker__body emoji-picker-container">
              <EmojiPicker
                onEmojiClick={handleEmojiSelect}
                theme={theme === 'light' ? 'light' : 'dark'}
                lazyLoadEmojis
                width="100%"
                height={260}
                previewConfig={{ showPreview: false }}
                searchPlaceholder={t('studio.composer.searchEmoji')}
              />
            </div>
          ) : (
            <div className="composer-picker__body gif-picker-container">
              <input
                className="gif-picker-search"
                type="text"
                placeholder={t('studio.composer.searchGifs')}
                aria-label={t('studio.composer.searchGifs')}
                value={gifQuery}
                onChange={(e) => setGifQuery(e.target.value)}
                autoFocus
              />
              <div className="gif-picker-grid">
                {gifLoading && <div className="gif-picker-status">{t('common.status.loading')}</div>}
                {!gifLoading && gifs.length === 0 && <div className="gif-picker-status">{t('studio.composer.noGifs')}</div>}
                {!gifLoading && gifs.map((g) => (
                  <button key={g.id} type="button" className="gif-picker-item" onClick={() => handleGifSelect(g)}>
                    <img src={g.images?.fixed_height_small?.url || g.images?.fixed_height?.url} alt={g.title || 'gif'} loading="lazy" />
                  </button>
                ))}
              </div>
              <div className="gif-picker-attribution">{t('studio.composer.poweredByGiphy')}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarkdownComposer;
