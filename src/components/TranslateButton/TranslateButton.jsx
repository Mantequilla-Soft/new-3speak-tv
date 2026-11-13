import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { SUPPORTED_LANGUAGES, getTargetLanguage, setTargetLanguage } from '../../utils/translate';
import './TranslateButton.scss';

// `languages` narrows the menu (default: every language the app knows).
export default function TranslateButton({ onTranslate, isTranslating, compact, languages = SUPPORTED_LANGUAGES }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, flip: false });

  // Compute position when opening
  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = 264; // max-height 260 + 4 padding
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceAbove < menuHeight && spaceBelow > spaceAbove;

    setPos({
      top: flip ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      flip,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    // Close on click/touch outside
    const handleClickOutside = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };

    // Close on external scroll (ignore scroll events from the dropdown itself)
    const handleScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };

    const handleResize = () => setOpen(false);

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updatePosition]);

  const handlePick = (code) => {
    setTargetLanguage(code);
    setOpen(false);
    onTranslate?.(code);
  };

  // Prevent wheel events from propagating to the page behind the dropdown
  const handleWheel = useCallback((e) => {
    const el = menuRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop === 0 && e.deltaY < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
    // Only stop propagation when not at boundary (or always, to prevent page scroll)
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
    // Always prevent default to stop the page from scrolling
    e.preventDefault();
  }, []);

  const saved = getTargetLanguage();

  // Sort: selected language first, then the rest in original order
  const sortedLanguages = useMemo(() => {
    if (!saved) return languages;
    const selected = languages.find(l => l.code === saved);
    if (!selected) return languages;
    return [selected, ...languages.filter(l => l.code !== saved)];
  }, [saved, languages]);

  const menu = open && createPortal(
    <div
      className="v2-menu translate-lang-menu"
      role="menu"
      ref={menuRef}
      style={{
        position: 'fixed',
        top: pos.flip ? `${pos.top}px` : 'auto',
        bottom: pos.flip ? 'auto' : `${window.innerHeight - pos.top}px`,
        left: `${pos.left}px`,
      }}
      onWheel={handleWheel}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {sortedLanguages.map(l => (
        <button
          key={l.code}
          type="button"
          role="menuitemradio"
          aria-checked={l.code === saved}
          className={`v2-menu__row translate-lang-item${l.code === saved ? ' selected' : ''}`}
          onClick={() => handlePick(l.code)}
        >
          <span className="translate-lang-native">{l.native}</span>
          <span className="translate-lang-name">{l.name}</span>
        </button>
      ))}
    </div>,
    document.body
  );

  return (
    <>
      <div className="translate-btn-wrap" ref={btnRef}>
        <button
          type="button"
          className="comment-translate-btn"
          onClick={() => setOpen(o => !o)}
          disabled={isTranslating}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={compact ? t('watch.translate.translate') : undefined}
        >
          {isTranslating
            ? <Icon name="progress_activity" size={compact ? 14 : 16} className="v2-spin" />
            : <Icon name="translate" size={compact ? 14 : 16} />}
          {!compact && <span className="comment-btn-label">{isTranslating ? t('watch.translate.translating') : t('watch.translate.translate')}</span>}
        </button>
      </div>
      {menu}
    </>
  );
}
