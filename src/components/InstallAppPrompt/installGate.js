// When the install sheet (InstallAppPrompt.jsx) may show. Pure, so the rules
// are tested on their own.

// Not in the first moments of a visit: after this long on the site, or a moment
// after the first move to another page, whichever comes first.
export const FIRST_DELAY_MS = 15000;
export const AFTER_NAV_MS = 2500;
// Something in the way (a dialog, the cookie banner, the tour, a video that just
// started): look again this much later.
export const RETRY_MS = 4000;
// No sheet in the first seconds after something started playing.
export const MEDIA_QUIET_MS = 10000;

/**
 * Which sheet this visitor may get: 'prompt' (the browser's install dialog is
 * ready), 'homeScreen' (Safari on an iPhone: the Share sheet steps) or null.
 */
export function offerKind({ phone, standalone, hasPrompt, iosSafari, state, now = Date.now() }) {
  if (!phone || standalone) return null;
  if (state?.installed) return null;
  if (Number.isFinite(state?.until) && now < state.until) return null;
  if (hasPrompt) return 'prompt';
  if (iosSafari) return 'homeScreen';
  return null;
}

// Anything that a sheet must not cover: an open dialog or sheet (the welcome
// tour's card and the cookie banner are dialogs too), or the cookie question
// not answered yet (its banner comes up a moment after the page opens).
const BLOCKERS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-v2-dialog], .cookie-consent';
export function blockedNow({ doc = typeof document !== 'undefined' ? document : null, consentDecided = true, lastMediaPlayAt = 0, now = Date.now() } = {}) {
  if (!consentDecided) return true;
  if (lastMediaPlayAt && now - lastMediaPlayAt < MEDIA_QUIET_MS) return true;
  if (!doc) return true;
  const open = [...doc.querySelectorAll(BLOCKERS)].some((el) => !el.closest('[hidden], [aria-hidden="true"]'));
  return open;
}
