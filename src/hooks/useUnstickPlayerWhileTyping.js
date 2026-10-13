import { useEffect } from 'react';

// Phones: the watch page's player is position:sticky under the top bar, which is
// right while watching but leaves almost no room once the keyboard opens for a
// comment: the sticky video plus the keyboard cover the field being typed into.
//
// While any text field on the page (outside the player) has focus, the body gets
// `watch-composing`, which drops the sticky (PlayVideo.scss), and once the
// keyboard has opened the field is scrolled to the middle of what is still
// visible. Leaving the field sticks the player again, a beat later so a tap on
// "Post" lands before the layout moves back.
const PHONE = '(max-width: 767px)';
const CLASS = 'watch-composing';

const isTextField = (el) => !!el && (
  el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test(el.type || ''))
  || el.isContentEditable
);

export default function useUnstickPlayerWhileTyping() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const phone = window.matchMedia(PHONE);
    let releaseTimer = null;
    let cleanupViewport = null;

    const centreField = (el) => {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browsers */ }
    };

    const onFocusIn = (e) => {
      const el = e.target;
      if (!phone.matches || !isTextField(el) || el.closest('.video-iframe-wrapper')) return;
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
      document.body.classList.add(CLASS);
      // The keyboard opens after focus; follow the visual viewport once it has
      // shrunk, with a timer as the fallback where visualViewport is missing.
      cleanupViewport?.();
      const vv = window.visualViewport;
      const onResize = () => centreField(el);
      const fallback = setTimeout(onResize, 350);
      if (vv) vv.addEventListener('resize', onResize, { once: true });
      cleanupViewport = () => {
        clearTimeout(fallback);
        if (vv) vv.removeEventListener('resize', onResize);
        cleanupViewport = null;
      };
    };

    const onFocusOut = () => {
      if (releaseTimer) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        const active = document.activeElement;
        if (isTextField(active) && !active.closest('.video-iframe-wrapper')) return; // moved to another field
        cleanupViewport?.();
        document.body.classList.remove(CLASS);
      }, 250);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (releaseTimer) clearTimeout(releaseTimer);
      cleanupViewport?.();
      document.body.classList.remove(CLASS);
    };
  }, []);
}
