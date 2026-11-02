import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const IDLE = { open: false, peek: false, fading: false, fadeAsPeek: false };

// Where typing happens: text boxes, not switches or checkboxes (they fire
// "input" too, and clicking around must not pin a peek).
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);
const isTextField = (el) => !!el && (
  el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase()))
  || el.isContentEditable
);

/**
 * A top-bar menu that a mouse can peek at: resting on its button shows it, leaving
 * hides it again, and a click pins it open until closed (the notifications bell,
 * the profile menu, Share, chat, settings).
 *
 *   const menu = useHoverPeek();
 *   <button {...menu.hoverProps} onClick={menu.toggle} />
 *   {menu.rendered && <div className={menu.leaving ? 'x--leaving' : ''} {...menu.hoverProps}>…}
 *
 * Put `hoverProps` on the button AND the menu (or on one wrapper holding both):
 * crossing between them within `leaveGrace` keeps it open. `rendered` stays true
 * for `fade` ms after it closed, with `leaving` set, so the menu can fade out; a
 * mouse coming back meanwhile keeps it. Touch has no hover: a tap toggles, as before.
 *
 * - shown: visible, by a peek or pinned; open: pinned (a click, or `hold()`)
 * - peek: it came from a hover; `asPeek` is the same but kept while it fades
 *   out, for menus that show a peek somewhere else than a click-open
 * - hold(): keeps a peek where it is, as if pinned by a click
 * - typingProps: on a menu with text boxes, typing into one pins it (a message
 *   half written must not vanish with the mouse); clicking around does not
 * - close(): fades out (items, outside clicks, Escape); nothing when not shown
 *
 * The functions and `hoverProps` are stable, so the object is safe in a context.
 */
export default function useHoverPeek({ delay = 200, leaveGrace = 150, fade = 200, enabled = true } = {}) {
  const [state, setState] = useState(IDLE);
  // The truth for the handlers: updated at once, before React re-renders.
  const stateRef = useRef(IDLE);
  const timer = useRef(null);
  const fadeTimer = useRef(null);
  // After a click closed it, the mouse is still on the button: no peek until it leaves.
  const noPeekRef = useRef(false);
  const opts = useRef({ delay, leaveGrace, fade, enabled });
  useEffect(() => { opts.current = { delay, leaveGrace, fade, enabled }; }, [delay, leaveGrace, fade, enabled]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(fadeTimer.current); }, []);

  const update = useCallback((patch) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const show = useCallback((pinned) => {
    clearTimeout(timer.current);
    clearTimeout(fadeTimer.current);
    update(pinned ? { open: true, fading: false } : { peek: true, fading: false });
  }, [update]);

  const close = useCallback(() => {
    const cur = stateRef.current;
    clearTimeout(timer.current);
    if (!cur.open && !cur.peek) return;
    clearTimeout(fadeTimer.current);
    update({ open: false, peek: false, fading: true, fadeAsPeek: cur.peek });
    fadeTimer.current = setTimeout(() => update({ fading: false }), opts.current.fade);
  }, [update]);

  const hold = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.peek || cur.open) return;
    clearTimeout(timer.current);
    update({ open: true });
  }, [update]);

  // A click pins it open (a peek stays where it is) or closes it.
  const toggle = useCallback(() => {
    if (stateRef.current.open) { noPeekRef.current = true; close(); } else show(true);
  }, [close, show]);

  const hoverProps = useMemo(() => ({
    onPointerEnter: (e) => {
      if (!opts.current.enabled || e.pointerType !== 'mouse' || noPeekRef.current) return;
      const cur = stateRef.current;
      clearTimeout(timer.current);
      if (cur.open) return;
      // Back over it while it fades out (or after a short trip off it): it stays.
      if (cur.peek || cur.fading) { show(false); return; }
      timer.current = setTimeout(() => show(false), opts.current.delay);
    },
    onPointerLeave: (e) => {
      if (!opts.current.enabled || e.pointerType !== 'mouse') return;
      noPeekRef.current = false;
      clearTimeout(timer.current);
      const cur = stateRef.current;
      // A short grace, so crossing the gap between the button and the menu keeps it.
      if (cur.peek && !cur.open) timer.current = setTimeout(close, opts.current.leaveGrace);
    },
  }), [show, close]);

  const typingProps = useMemo(() => ({
    onInputCapture: (e) => { if (isTextField(e.target)) hold(); },
  }), [hold]);

  return useMemo(() => {
    const shown = state.open || state.peek;
    return {
      open: state.open,
      peek: state.peek,
      shown,
      leaving: state.fading && !shown,
      rendered: shown || state.fading,
      asPeek: shown ? state.peek : state.fading && state.fadeAsPeek,
      show,
      close,
      hold,
      toggle,
      hoverProps,
      typingProps,
    };
  }, [state, show, close, hold, toggle, hoverProps, typingProps]);
}
