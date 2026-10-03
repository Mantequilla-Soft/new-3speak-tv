import { useState, useRef, useCallback, useEffect } from 'react';
import { 
  FaBold, FaItalic, FaUnderline, FaStrikethrough, 
  FaHeading, FaListUl, FaListOl, FaQuoteLeft, 
  FaCode, FaLink, FaImage, FaTable, FaEyeSlash,
  FaEye, FaEdit, FaColumns, FaSmile
} from 'react-icons/fa';
import { MdFormatClear } from 'react-icons/md';
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

const MarkdownComposer = ({ value, onChange, placeholder, show, previewContext = 'post-body' }) => {
  const { t } = useTranslation();
  const { theme } = useAppStore()
  const textareaRef = useRef(null);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'preview' | 'split'
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const { query: gifQuery, setQuery: setGifQuery, gifs, loading: gifLoading } = useGiphySearch(showGifPicker);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [renderedContent, setRenderedContent] = useState('');

  // Auto-resize textarea to fit content, capped by parent max-height
  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const composer = textarea.closest('.markdown-composer');
    const maxH = composer ? parseFloat(getComputedStyle(composer).maxHeight) : Infinity;
    const desired = textarea.scrollHeight;
    if (Number.isFinite(maxH) && desired > maxH) {
      textarea.style.height = maxH + 'px';
    } else {
      textarea.style.height = desired + 'px';
    }
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, viewMode, autoResize]);

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
    setShowEmojiPicker(false);
  };

  // GIF handler — insert as inline markdown image so the Hive renderer embeds it.
  const handleGifSelect = (g) => {
    const url = normalizeGifUrl(g);
    if (url) insertText(gifMarkdown(url));
    setShowGifPicker(false);
  };

  const toggleEmojiPicker = () => { setShowGifPicker(false); setShowEmojiPicker((v) => !v); };
  const toggleGifPicker = () => { setShowEmojiPicker(false); setShowGifPicker((v) => !v); };

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

  return (
    <div className="markdown-composer">
      {/* Toolbar */}
      <div className="composer-toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={handleBold} title={t('studio.composer.bold')}>
            <FaBold />
          </button>
          <button type="button" onClick={handleItalic} title={t('studio.composer.italic')}>
            <FaItalic />
          </button>
          <button type="button" onClick={handleUnderline} title={t('studio.composer.underline')}>
            <FaUnderline />
          </button>
          <button type="button" onClick={handleStrikethrough} title={t('studio.composer.strikethrough')}>
            <FaStrikethrough />
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <div className="dropdown-wrapper">
            <button 
              type="button" 
              onClick={() => setShowHeaderMenu(!showHeaderMenu)} 
              title={t('studio.composer.headers')}
              className={showHeaderMenu ? 'active' : ''}
            >
              <FaHeading />
            </button>
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
          <button type="button" onClick={handleBulletList} title={t('studio.composer.bulletList')}>
            <FaListUl />
          </button>
          <button type="button" onClick={handleNumberedList} title={t('studio.composer.numberedList')}>
            <FaListOl />
          </button>
          <button type="button" onClick={handleQuote} title={t('studio.composer.quote')}>
            <FaQuoteLeft />
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button type="button" onClick={handleCodeBlock} title={t('studio.composer.codeBlock')}>
            <FaCode />
          </button>
          <button type="button" onClick={handleLink} title={t('studio.composer.insertLink')}>
            <FaLink />
          </button>
          <button 
            type="button" 
            onClick={handleImageClick} 
            title={t('studio.composer.uploadImage')}
            disabled={isUploading}
          >
            <FaImage />
          </button>
          <button type="button" onClick={handleTable} title={t('studio.composer.insertTable')}>
            <FaTable />
          </button>
          <button type="button" onClick={handleSpoiler} title={t('studio.composer.spoiler')}>
            <FaEyeSlash />
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <div className="dropdown-wrapper">
            <button
              type="button"
              onClick={toggleEmojiPicker}
              title={t('studio.composer.emoji')}
              className={showEmojiPicker ? 'active' : ''}
            >
              <FaSmile />
            </button>
            {showEmojiPicker && (
              <div className="emoji-picker-container">
                <EmojiPicker
                  onEmojiClick={handleEmojiSelect}
                  theme={theme === 'light' ? 'light' : 'dark'}
                  lazyLoadEmojis
                  width={340}
                  height={380}
                  previewConfig={{ showPreview: false }}
                  searchPlaceholder={t('studio.composer.searchEmoji')}
                />
              </div>
            )}
          </div>
          <div className="dropdown-wrapper">
            <button
              type="button"
              onClick={toggleGifPicker}
              title="GIF"
              className={`gif-toggle-btn${showGifPicker ? ' active' : ''}`}
            >
              GIF
            </button>
            {showGifPicker && (
              <div className="gif-picker-container">
                <input
                  className="gif-picker-search"
                  type="text"
                  placeholder={t('studio.composer.searchGifs')}
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  autoFocus
                />
                <div className="gif-picker-grid">
                  {gifLoading && <div className="gif-picker-status">{t('common.status.loading')}</div>}
                  {!gifLoading && gifs.length === 0 && <div className="gif-picker-status">{t('studio.composer.noGifs')}</div>}
                  {!gifLoading && gifs.map((g) => (
                    <button key={g.id} type="button" className="gif-picker-item" onClick={() => handleGifSelect(g)}>
                      <img src={g.images?.fixed_height?.url || g.images?.fixed_height_small?.url} alt={g.title || 'gif'} loading="lazy" />
                    </button>
                  ))}
                </div>
                <div className="gif-picker-attribution">{t('studio.composer.poweredByGiphy')}</div>
              </div>
            )}
          </div>
        </div>

        {/* View mode toggle - right side */}
        <div className="toolbar-spacer" />
          <div className={`toolbar-group view-toggle ${show ? 'show' : ''}`}>
          <button 
            type="button" 
            onClick={() => setViewMode('editor')} 
            title={t('studio.composer.editorOnly')}
            className={viewMode === 'editor' ? 'active' : ''}
          >
            <FaEdit />
          </button>
          <button 
            type="button" 
            onClick={() => setViewMode('split')} 
            title={t('studio.composer.splitView')}
            className={`show ${viewMode === 'split' ? 'active' : ''}`}
          >
            <FaColumns />
          </button>
          <button 
            type="button" 
            onClick={() => setViewMode('preview')} 
            title={t('studio.composer.previewOnly')}
            className={viewMode === 'preview' ? 'active' : ''}
          >
            <FaEye />
          </button>
        </div>
      </div>

      {/* Editor / Preview Area */}
      <div className={`composer-content ${viewMode}`}>
        {/* Editor Panel */}
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
                <FaImage size={48} />
                <span>{t('studio.composer.dropImage')}</span>
              </div>
            )}
            {isUploading && (
              <div className="upload-overlay">
                <span>{t('studio.composer.uploadingImage')}</span>
              </div>
            )}
          </div>
        )}

        {/* Preview Panel */}
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
    </div>
  );
};

export default MarkdownComposer;
