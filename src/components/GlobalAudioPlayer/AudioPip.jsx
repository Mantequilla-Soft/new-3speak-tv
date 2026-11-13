import { useEffect } from 'react';

// The player popped out into its own small window: one that stays on top of
// everything where the browser has Document Picture-in-Picture (Chrome, Edge
// and the like on desktop), else a popup opened the way the Butter Auth sign-in
// is (Firefox, Safari). The whole player moves in there (GlobalAudioPlayer draws its controls into the window, as it does into
// the phone's Player tab); the <audio> element stays in the page, so playback
// never stops when the window opens or closes.

const W = 320;
const H = 440;

// The window starts with an empty document: the page's styles are copied in
// (rules where they can be read, a link to the sheet where they can't).
function copyStyles(win) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = win.document.createElement('style');
      style.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
      win.document.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = win.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      win.document.head.appendChild(link);
    }
  }
}

// Opens the window: { win, root } with root the element the player is drawn
// into, or null when the browser blocked it. Has to run inside a click: the
// popup is opened before anything is awaited, so the click still counts.
export async function openAudioPip() {
  const w = Math.min(W, window.screen.availWidth);
  const h = Math.min(H, Math.round(window.screen.availHeight * 0.85));
  let win;
  if ('documentPictureInPicture' in window) {
    try { win = await window.documentPictureInPicture.requestWindow({ width: w, height: h }); } catch { win = null; }
  } else {
    // Bottom right of the browser window, where the player sits in the page.
    const left = window.screenX + Math.max(0, window.outerWidth - w - 24);
    const top = window.screenY + Math.max(0, window.outerHeight - h - 24);
    win = window.open('', '3speak-audio-player', `popup,width=${w},height=${h},left=${left},top=${top}`);
    if (win) {
      // Already open from before: a fresh document all the same.
      win.document.head.innerHTML = '';
      win.document.body.innerHTML = '';
    }
  }
  if (!win) return null;
  const meta = win.document.createElement('meta');
  meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1';
  win.document.head.appendChild(meta);
  copyStyles(win);
  win.document.body.className = 'audio-pip-body';
  const root = win.document.createElement('div');
  root.className = 'audio-pip-root';
  win.document.body.appendChild(root);
  win.focus();
  return { win, root };
}

// Calls onClosed once the window is gone, whichever way it went.
export function watchAudioPip(win, onClosed) {
  let done = false;
  const closed = () => { if (!done) { done = true; onClosed(); } };
  win.addEventListener('pagehide', closed);
  // A popup closed by its own window button doesn't always say so.
  const poll = setInterval(() => { if (win.closed) closed(); }, 1000);
  // A popup outlives the page that opened it; the player's window shouldn't.
  const closeWithPage = () => { try { win.close(); } catch { /* gone */ } };
  window.addEventListener('pagehide', closeWithPage);
  return () => {
    done = true;
    clearInterval(poll);
    window.removeEventListener('pagehide', closeWithPage);
    try { win.removeEventListener('pagehide', closed); } catch { /* gone */ }
  };
}

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName));

// Keeps the window in step with the page: light or dark as the page is, the
// track as its title, and Space / arrows for play and skip as in the page.
export function useAudioPipWindow(win, { title, onToggle, onSkip, canSkip, back, forward }) {
  useEffect(() => {
    if (!win) return undefined;
    const src = document.documentElement;
    const dst = win.document.documentElement;
    const sync = () => {
      const theme = src.getAttribute('data-theme');
      if (theme) dst.setAttribute('data-theme', theme); else dst.removeAttribute('data-theme');
      dst.className = src.className;
      dst.lang = src.lang;
      dst.dir = src.dir;
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(src, { attributes: true, attributeFilter: ['data-theme', 'class', 'lang', 'dir'] });
    return () => mo.disconnect();
  }, [win]);

  useEffect(() => { if (win) win.document.title = title; }, [win, title]);

  useEffect(() => {
    if (!win) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); onToggle(); }
      else if (e.key === 'ArrowLeft' && canSkip) { e.preventDefault(); onSkip(-back); }
      else if (e.key === 'ArrowRight' && canSkip) { e.preventDefault(); onSkip(forward); }
    };
    win.document.addEventListener('keydown', onKey);
    return () => win.document.removeEventListener('keydown', onKey);
  }, [win, onToggle, onSkip, canSkip, back, forward]);
}
