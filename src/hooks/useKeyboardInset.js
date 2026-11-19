import { useEffect, useState } from 'react';

// Phones: Android Chrome (and any fullscreen page) lays out at full height and
// lets the on-screen keyboard cover the bottom, so a full-screen overlay with
// its composer at the foot ends up typing under the keys. This is how many px
// of the screen bottom the keyboard hides while a text field has focus, else
// 0; an overlay lifts its bottom edge by it. Where the browser shrinks the
// layout for the keyboard instead, the gap is already 0.

// Under this many px the gap is browser chrome (an address bar), not a keyboard.
const MIN_KEYBOARD = 80;

const isTextField = (el) => !!el && (
  el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(el.type || ''))
  || !!el.isContentEditable
);

export function keyboardInset(win = window) {
  const vv = win.visualViewport;
  if (!vv || vv.scale > 1.01 || !isTextField(win.document.activeElement)) return 0;
  const gap = Math.round(win.innerHeight - vv.height - vv.offsetTop);
  return gap >= MIN_KEYBOARD ? gap : 0;
}

export default function useKeyboardInset(enabled = true) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) {
      setInset(0);
      return undefined;
    }
    const vv = window.visualViewport;
    const update = () => setInset(keyboardInset(window));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    // Focus moves before the keyboard animates; a blur can close it with no resize.
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [enabled]);
  return inset;
}
