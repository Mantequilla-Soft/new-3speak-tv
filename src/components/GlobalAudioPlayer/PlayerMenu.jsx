import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ModalHeader from '../ModalHeader/ModalHeader';

/**
 * The small menus of the audio player (speed, sleep timer, audio effects,
 * share). Portaled to <body> so the player's overflow can't crop them: on a
 * wide screen a popover just above the button that opened it, on a phone a
 * bottom sheet (GlobalAudioPlayer.scss .audio-pm). Escape or a tap outside
 * closes it, and focus goes back to the button.
 *
 * @param {DOMRect} anchor  : the rect of the button that opened it
 * @param {string}  title   : heading in the shared ModalHeader
 * @param {function} onClose
 */
export default function PlayerMenu({ anchor, title, onClose, children, className = '' }) {
  const panelRef = useRef(null);
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  // The handler changes on every render of the player; the listeners stay put.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    const opener = openerRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      // Back to the button, unless something else took the focus meanwhile.
      if (opener && document.contains(opener) && (!document.activeElement || document.activeElement === document.body)) opener.focus();
    };
  }, []);

  // Right-aligned with the button, kept on screen.
  const style = anchor ? {
    '--pm-right': `${Math.max(8, window.innerWidth - anchor.right)}px`,
    '--pm-bottom': `${Math.max(8, window.innerHeight - anchor.top + 8)}px`,
  } : undefined;

  return createPortal(
    <div className="audio-pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className={`audio-pm ${className}`.trim()}
        style={style}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
      >
        <ModalHeader className="audio-pm-header" title={title} onClose={onClose} />
        <div className="audio-pm-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
