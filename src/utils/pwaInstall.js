import { useEffect, useState } from 'react';

// "Install App", shared by the bottom bar (signed out), the account menu
// (signed in) and the install sheet that phones get once
// (components/InstallAppPrompt).
//
// The browser fires `beforeinstallprompt` ONCE per page load, often before
// either menu has mounted, so it is caught here at import time rather than in
// a component effect that might start listening too late.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(deferredPrompt));

// What the install sheet remembers: { until } after "Not now" (no sheet before
// that time), { installed: true } once the app was installed (never again).
// A choice made in the UI, consent-exempt like the other settings.
export const INSTALL_PROMPT_KEY = '3speak_install_prompt';
export const INSTALL_SNOOZE_DAYS = 30;

export function readInstallPromptState() {
  try {
    const v = JSON.parse(localStorage.getItem(INSTALL_PROMPT_KEY) || 'null');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function writeInstallPromptState(v) {
  try { localStorage.setItem(INSTALL_PROMPT_KEY, JSON.stringify(v)); } catch { /* storage off: the sheet may come back */ }
}
export function snoozeInstallPrompt(now = Date.now()) {
  writeInstallPromptState({ ...readInstallPromptState(), until: now + INSTALL_SNOOZE_DAYS * 24 * 3600 * 1000 });
}
export function markAppInstalled() {
  writeInstallPromptState({ installed: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markAppInstalled();
    notify();
  });
}

export const isStandalone = () => typeof window !== 'undefined' && (
  !!window.matchMedia?.('(display-mode: standalone)')?.matches
  || window.navigator.standalone === true
);

// iOS Safari has no install prompt at all; people add it from the Share sheet.
const isIOS = () => typeof navigator !== 'undefined'
  && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// A phone (not a tablet, not a desktop). Same signs as utils/videoThumbnails.js
// isMobileDevice, narrowed to phones: Android phones say "Mobile", tablets
// don't; iPads say "Mobile/" too, so they are left out by name.
export function isPhoneDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  const ua = nav.userAgent || '';
  if (/iPad/.test(ua)) return false;
  if (nav.userAgentData?.mobile === true) return true;
  if (/iPhone|iPod/.test(ua)) return true;
  return /Android/.test(ua) && /Mobile/.test(ua);
}

// Safari itself on an iPhone: the only place "Add to Home Screen" makes an app
// of the page. Other browsers on iOS and the in-app browsers (Instagram,
// Facebook, X, Google app ...) don't, or send it to Safari first.
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave|FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|LinkedInApp|Pinterest|TikTok|musical_ly|MicroMessenger|WhatsApp|Discord|Telegram/i;
export function isIosSafariPhone(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const ua = nav?.userAgent || '';
  return /iPhone|iPod/.test(ua) && /Version\/\d/.test(ua) && /Safari\//.test(ua) && !IOS_OTHER.test(ua);
}

export function usePwaInstall() {
  const [prompt, setPrompt] = useState(deferredPrompt);
  useEffect(() => {
    listeners.add(setPrompt);
    return () => { listeners.delete(setPrompt); };
  }, []);

  const ios = isIOS();
  return {
    canInstallPrompt: !!prompt,
    isIOS: ios,
    showInstall: !isStandalone() && (!!prompt || ios),
    // Shows the browser's own install dialog. The event is single-use.
    // Resolves to the listener's answer: 'accepted', 'dismissed' or null.
    promptInstall: async () => {
      if (!deferredPrompt) return null;
      const e = deferredPrompt;
      deferredPrompt = null;
      notify();
      e.prompt();
      const choice = await e.userChoice;
      if (choice?.outcome === 'accepted') markAppInstalled();
      return choice?.outcome || null;
    },
  };
}
