import { lazy, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import MountWhenOpened from '../common/LazyMount';
import { hasDecided } from '../../lib/consent';
import {
  usePwaInstall, isStandalone, isPhoneDevice, isIosSafariPhone,
  readInstallPromptState, snoozeInstallPrompt,
} from '../../utils/pwaInstall';
import { FIRST_DELAY_MS, AFTER_NAV_MS, RETRY_MS, offerKind, blockedNow } from './installGate';

const InstallAppSheet = lazy(() => import('./InstallAppSheet'));

// The media players announce every start on this bus (utils/mediaCoordinator).
const MEDIA_EVENT = 'mantequilla-media-play';

/**
 * "Install as app" for phones: a small bottom sheet, once, when the browser can
 * install the site (Chrome, Edge, Samsung Internet on Android fire
 * `beforeinstallprompt`; utils/pwaInstall.js keeps it) or on Safari on an
 * iPhone (Share, then Add to Home Screen). Never in the app itself, never in the
 * first seconds of a visit (FIRST_DELAY_MS, or a moment after the first move to
 * another page), never over a dialog, the cookie banner or the welcome tour, and
 * not right after something started playing (installGate.js). "Not now" hides it
 * for 30 days; once the app is installed it never comes back. The menus keep
 * their "Install App" row the whole time.
 */
export default function InstallAppPrompt() {
  const { canInstallPrompt, promptInstall } = usePwaInstall();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState(null);
  const shownRef = useRef(false);
  const firstPathRef = useRef(pathname);
  const lastPlayRef = useRef(0);

  useEffect(() => {
    const onPlay = () => { lastPlayRef.current = Date.now(); };
    window.addEventListener(MEDIA_EVENT, onPlay);
    return () => window.removeEventListener(MEDIA_EVENT, onPlay);
  }, []);

  // Armed after the first delay, or soon after the first move to another page.
  useEffect(() => {
    if (ready) return undefined;
    const moved = pathname !== firstPathRef.current;
    const id = setTimeout(() => setReady(true), moved ? AFTER_NAV_MS : FIRST_DELAY_MS);
    return () => clearTimeout(id);
  }, [pathname, ready]);

  // Once armed: offer it as soon as nothing is in the way, once per visit.
  useEffect(() => {
    if (!ready || shownRef.current) return undefined;
    const offer = () => offerKind({
      phone: isPhoneDevice(),
      standalone: isStandalone(),
      hasPrompt: canInstallPrompt,
      iosSafari: isIosSafariPhone(),
      state: readInstallPromptState(),
    });
    if (!offer()) return undefined;
    let id = null;
    const tryShow = () => {
      const k = offer();
      if (!k) return;
      if (blockedNow({ consentDecided: hasDecided(), lastMediaPlayAt: lastPlayRef.current })) {
        id = setTimeout(tryShow, RETRY_MS);
        return;
      }
      shownRef.current = true;
      setKind(k);
    };
    tryShow();
    return () => clearTimeout(id);
  }, [ready, canInstallPrompt]);

  const later = () => { snoozeInstallPrompt(); setKind(null); };
  const install = async () => {
    setKind(null);
    const outcome = await promptInstall();
    // Turned down in the browser's own dialog: the same as Not now.
    if (outcome !== 'accepted') snoozeInstallPrompt();
  };

  return (
    <MountWhenOpened when={!!kind} name="install app">
      <InstallAppSheet kind={kind} onInstall={install} onLater={later} />
    </MountWhenOpened>
  );
}
