// Is the listener away from the page: the screen locked, another app or tab in
// front? Then nothing may interrupt or swap the playing audio (an ad spot, a
// held opening, a new <audio> element), because a phone only lets background
// audio go on in the element that is already playing, and a pause there can
// lose the lock screen's player for good.
//
// Hidden is the main sign. On a touch device a document without the focus
// counts too: a phone can report the page visible for a moment after the screen
// went off (or while the notification shade or another app is in front), but
// the window has lost the focus by then. A desktop window in the background
// (visible, not focused) is not away: audio there carries on as usual.
export function pageAway() {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return true;
  try {
    const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
    return touch && typeof document.hasFocus === 'function' && !document.hasFocus();
  } catch {
    return false;
  }
}

// Calls `fn` whenever the listener may have gone away (or come back).
export function onPageAwayChange(fn) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  document.addEventListener('visibilitychange', fn);
  window.addEventListener('blur', fn);
  window.addEventListener('focus', fn);
  return () => {
    document.removeEventListener('visibilitychange', fn);
    window.removeEventListener('blur', fn);
    window.removeEventListener('focus', fn);
  };
}
