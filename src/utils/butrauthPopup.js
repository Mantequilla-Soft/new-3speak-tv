/**
 * Open a Butter Auth flow in a popup.
 *
 * Lifted out of LoginModal so the graduation prompt does not carry a second
 * copy of the geometry and the popup-blocked fallback. LoginModal still has the
 * original inline (it does more around it); this is deliberately the smaller,
 * general version, and the two should be merged the next time that file is
 * open for other reasons.
 *
 * @param {{signup?: boolean, graduate?: boolean, changeHandle?: boolean}} opts
 *        which screen butrauth should open on. `graduate` is for an incubating
 *        user turning their handle into a real account; `changeHandle` is for
 *        one whose chosen name has since been registered on Hive by somebody
 *        else — see the server's /api/manteauth/start.
 * @returns {Promise<boolean>} false only if the flow could not be started at
 *          all. A blocked popup is NOT a failure: it falls back to a full-page
 *          redirect, which never returns.
 */
export async function openButrauthPopup({ signup = false, graduate = false, changeHandle = false } = {}) {
  const res = await fetch('/api/manteauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      redirect_uri: `${window.location.origin}/callback`,
      // 'popup' → ManteAuthCallback signals the opener back through a
      // localStorage event rather than trying to talk across origins.
      state: 'popup',
      signup,
      graduate,
      changeHandle,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Butter Auth');

  // Sized to the screen rather than fixed: these flows are tall (explainer,
  // provider buttons, captcha, key backup) and scrolled inside a small popup.
  const w = Math.min(640, Math.max(420, Math.round(window.screen.availWidth * 0.42)));
  const h = Math.min(980, Math.max(660, Math.round(window.screen.availHeight * 0.92)));
  const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);

  const popup = window.open(data.url, 'butrauth-login', `width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) {
    // Blocked. A full-page redirect is the same flow without the window.
    window.location.href = data.url;
    return true;
  }
  // The opener closes it when the flow reports back — more reliable than the
  // popup closing itself after a cross-origin hop.
  window.__butrauthLoginPopup = popup;
  return true;
}
