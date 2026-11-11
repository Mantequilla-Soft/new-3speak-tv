import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../v2/ui';
import { usePortalDoc } from '../../utils/portalDocument';

/**
 * The small menus of the audio player (the Player menu, speed, sleep timer,
 * audio effects, share). Portaled to <body> so the player's overflow can't crop
 * them: on a wide screen a v2 popover card just above the button that opened
 * it, on a phone a bottom sheet with a grab handle (design 27b / 27d,
 * GlobalAudioPlayer.scss .audio-pm). Escape or a tap outside closes it, and
 * focus goes back to the button.
 *
 * @param {DOMRect} anchor  : the rect of the button that opened it
 * @param {string}  title   : the sheet's title (and its accessible name)
 * @param {'accent'|'cyan'} tone : the colour of the bar before the title
 * @param {function} onClose
 */
export default function PlayerMenu({ anchor, title, onClose, children, className = '', tone = 'accent', wide = false }) {
  const { t } = useTranslation();
  const doc = usePortalDoc();
  const view = doc.defaultView || window;
  const panelRef = useRef(null);
  const openerRef = useRef(doc.activeElement);
  // The handler changes on every render of the player; the listeners stay put.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    doc.addEventListener('keydown', onKey);
    const opener = openerRef.current;
    return () => {
      doc.removeEventListener('keydown', onKey);
      // Back to the button, unless something else took the focus meanwhile.
      if (opener && doc.contains(opener) && (!doc.activeElement || doc.activeElement === doc.body)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Right-aligned with the button, kept on screen: above it, or below it when
  // the button sits in the top half (the full player's head row).
  const below = !!anchor && anchor.top < view.innerHeight / 2;
  const style = anchor ? {
    '--pm-right': `${Math.max(8, view.innerWidth - anchor.right)}px`,
    ...(below
      ? { '--pm-top': `${Math.round(anchor.bottom + 8)}px` }
      : { '--pm-bottom': `${Math.max(8, view.innerHeight - anchor.top + 8)}px` }),
  } : undefined;

  return createPortal(
    <div className="audio-pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className={`audio-pm${wide ? ' is-wide' : ''}${below ? ' is-below' : ''} ${className}`.trim()}
        style={style}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="audio-pm-grab" aria-hidden="true" />
        <div className="audio-pm-header">
          <h2 className={`audio-pm-title is-${tone}`}>{title}</h2>
          <IconButton icon="close" label={t('common.actions.close')} size={32} variant="ghost" round onClick={onClose} />
        </div>
        <div className="audio-pm-body">{children}</div>
      </div>
    </div>,
    doc.body,
  );
}
