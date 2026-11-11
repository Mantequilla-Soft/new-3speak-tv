import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import { SUPPORTED_LANGUAGES } from '../../utils/translate';
import './TitleTranslate.scss';

const MENU_WIDTH = 220;

const langLabel = (code) => {
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === code);
  return l ? l.native : code.toUpperCase();
};

/**
 * Translate the title (22a): a 32px button after the title when translations
 * exist; while one is shown it says which, in cyan. The menu (a v2 menu) is
 * rendered in a portal (fixed position, anchored to the button) so it can't be
 * clipped or covered by surrounding rows.
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
        className={cx('title-translate-btn', selectedLang && 'active')}
        onClick={() => setOpen((o) => !o)}
        title={t('watch.translate.titleButton')}
        aria-label={t('watch.translate.titleButton')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="translate" size={18} />
        {selectedLang && <span className="title-translate-btn__lang">{langLabel(selectedLang)}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="v2-menu title-translate-menu"
            role="menu"
            style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!selectedLang}
              className={cx('v2-menu__row title-translate-item', !selectedLang && 'is-on')}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              <Icon name="undo" size={18} />
              <span>{t('watch.translate.original')}</span>
            </button>
            {languages.map((code) => (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={selectedLang === code}
                className={cx('v2-menu__row title-translate-item', selectedLang === code && 'is-on')}
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
