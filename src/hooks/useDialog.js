import { useEffect, useEffectEvent, useId, useRef } from 'react';

// Dialogs open right now. Escape closes only the topmost one, so a confirmation
// opened from inside another window does not take that window down with it.
const open = new Set();

// Topmost = last in document order: a dialog nested inside another comes after
// it, and a portalled one is appended to <body> after those already open.
// (Not "last registered": a parent's effect runs after its child's.)
function topmost() {
  let top = null;
  for (const entry of open) {
    const el = entry.el.current;
    if (!el?.isConnected) continue;
    // A box kept mounted but hidden (display:none) never takes the key.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
    if (!top || (top.el.current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) top = entry;
  }
  return top;
}

/**
 * What turns a modal box into a dialog for keyboard and screen-reader users:
 * role="dialog" + aria-modal, its name taken from the ModalHeader title, and
 * Escape to close.
 *
 *   const dialog = useDialog(onClose);
 *   <div className="my-modal" {...dialog.props}>
 *     <ModalHeader title={...} titleId={dialog.titleId} onClose={onClose} />
 *
 * `active` false (a modal that stays mounted while hidden) leaves Escape alone.
 * `ref`: the box's own ref when it already has one (it is then also in props).
 * Without `onClose` the box is still a named dialog, but Escape does nothing
 * (a prompt that must be answered, or one busy saving).
 */
/**
 * Escape closes `onClose`'s window when it is the topmost one open. Shared by
 * useDialog and ModalHeader (which closes on Escape by itself, unless it sits
 * inside a useDialog box: that box owns the key then).
 */
export function useEscapeLayer(ref, onClose, { active = true, skipInsideDialog = false } = {}) {
  const close = useEffectEvent(() => { if (onClose) onClose(); });

  useEffect(() => {
    if (!active) return undefined;
    if (skipInsideDialog && ref.current?.closest('[data-dialog]')) return undefined;
    const me = { el: ref };
    open.add(me);
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || topmost() !== me) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      open.delete(me);
    };
  }, [active, ref, skipInsideDialog]);
}

export default function useDialog(onClose, { active = true, ref: ownRef } = {}) {
  const titleId = useId();
  const fallbackRef = useRef(null);
  const ref = ownRef || fallbackRef;
  useEscapeLayer(ref, onClose, { active });

  return {
    titleId,
    props: { ref, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-dialog': '' },
  };
}
