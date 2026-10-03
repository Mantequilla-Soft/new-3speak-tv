import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MdTranslate } from 'react-icons/md';
import { SUPPORTED_LANGUAGES } from '../../utils/translate';
import './TitleTranslate.scss';

const MENU_WIDTH = 180;

const langLabel = (code) => {
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === code);
  return l ? l.native : code.toUpperCase();
};

/**
 * Small translate symbol shown after a video title when title translations are
 * available. The dropdown is rendered in a portal (fixed position, anchored to
 * the button) so it can't be clipped or covered by surrounding rows.
 */
export default function TitleTranslate({ languages, selectedLang, onSelect }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const updateCoords = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Anchor below the button, clamped so the menu never runs off-screen.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8));
    setCoords({ top: r.bottom + 6, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateCoords();
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open, updateCoords]);

  if (!languages?.length) return null;

  return (
    <div className="title-translate">
      <button
        ref={btnRef}
        type="button"
        className={`title-translate-btn${selectedLang ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={t('watch.translate.titleButton')}
        aria-label={t('watch.translate.titleButton')}
      >
        <MdTranslate size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="title-translate-menu"
            style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
          >
            <button
              type="button"
              className={`title-translate-item${!selectedLang ? ' active' : ''}`}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              {t('watch.translate.original')}
            </button>
            {languages.map((code) => (
              <button
                key={code}
                type="button"
                className={`title-translate-item${selectedLang === code ? ' active' : ''}`}
                onClick={() => {
                  onSelect(code);
                  setOpen(false);
                }}
              >
                <span className="title-translate-native">{langLabel(code)}</span>
                <span className="title-translate-code">{code.toUpperCase()}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
