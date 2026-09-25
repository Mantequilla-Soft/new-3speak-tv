import { useEffect, useState } from 'react';

// "Install App", shared by the bottom bar (signed out) and the account menu
// (signed in).
//
// The browser fires `beforeinstallprompt` ONCE per page load, often before
// either menu has mounted, so it is caught here at import time rather than in
// a component effect that might start listening too late.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(deferredPrompt));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
}

const isStandalone = () => typeof window !== 'undefined' && (
  window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true
);

// iOS Safari has no install prompt at all; people add it from the Share sheet.
const isIOS = () => typeof navigator !== 'undefined'
  && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

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
    promptInstall: async () => {
      if (!deferredPrompt) return;
      const e = deferredPrompt;
      deferredPrompt = null;
      notify();
      e.prompt();
      await e.userChoice;
    },
  };
}
