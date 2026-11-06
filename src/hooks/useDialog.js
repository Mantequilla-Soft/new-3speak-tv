import { useEffect, useEffectEvent, useId } from 'react';

// Dialogs open right now, oldest first. Escape closes only the newest one, so a
// confirmation opened from inside another window does not take that window
// down with it.
const open = [];

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
 * Without `onClose` the box is still a named dialog, but Escape does nothing
 * (a prompt that must be answered).
 */
export default function useDialog(onClose, { active = true } = {}) {
  const titleId = useId();
  const close = useEffectEvent(() => { if (onClose) onClose(); });

  useEffect(() => {
    if (!active) return undefined;
    const me = {};
    open.push(me);
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || open[open.length - 1] !== me) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = open.indexOf(me);
      if (i !== -1) open.splice(i, 1);
    };
  }, [active]);

  return {
    titleId,
    props: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
  };
}
