import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../lib/store';
import { fetchGraduationStatus } from '../../lib/incubation';
import { toastIn } from '../../utils/toast';
import { openButrauthPopup } from '../../utils/butrauthPopup';
// Reuses the app's one modal-dialog shape rather than inventing a second.
import '../AdsPrompt/AdsPrompt.scss';

// Every toast from this module is headed "Your account"; the message becomes
// the line under it. See utils/toast.js.
const toast = toastIn('Your account');

/**
 * Notice that this person graduated somewhere else.
 *
 * Warm-up state lives in localStorage, which is per browser. Finish the signup
 * on a laptop and the phone carries on believing you have no Hive account:
 * posting off-chain, hiding chat, offering the warm-up goals, showing the
 * upgrade prompt for an account that already exists. Nothing ever asked the
 * server, so the only cure was clearing site data.
 *
 * Renders nothing. It is mounted rather than folded into an existing effect so
 * that "is this session still true?" has one owner.
 *
 * 🚨 Acts ONLY on a definite graduation: a successful read, status 'graduated',
 * and a real account name. Everything else -- a 401, a timeout, a 502, a
 * payload without a username -- is left alone, because the action here deletes
 * the warm-up handle, and deleting it for somebody who IS still incubating logs
 * them out with no route back. That mistake has been made once already.
 */
export default function IncubationSessionSync() {
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const promoteFromIncubation = useAppStore((s) => s.promoteFromIncubation);
  // The session is gone and only butrauth can hand back a new one.
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  // One promotion per page life, so a focus storm cannot re-toast.
  const promoted = useRef(false);

  const check = useCallback(async () => {
    if (!incubationHandle || promoted.current) return;
    let status;
    try {
      status = await fetchGraduationStatus();
    } catch (err) {
      // A 401 is not a hiccup: this browser is holding a warm-up identity the
      // server does not recognise. The store trusts the handle in localStorage
      // with no server check, so the UI keeps saying "signed in" while every
      // call 401s -- and nothing can promote them, because nothing can tell who
      // they are. Try to get a session back without asking them for anything.
      //
      // Deliberately NOT an automatic redirect. That was tried: butrauth does
      // not complete silently, so the user was thrown out of 3Speak and parked
      // on a login page, and coming back left the stale session exactly as it
      // was. A popup keeps the app where it is -- and it has to be opened from
      // a real click, because a popup opened on page load is blocked and falls
      // back to the very redirect this is replacing.
      if (err?.status === 401) setNeedsReconnect(true);
      return; // offline, 5xx: say nothing, change nothing
    }
    const name = typeof status?.hiveUsername === 'string' ? status.hiveUsername.trim() : '';
    if (status?.status !== 'graduated' || !name) return;

    promoted.current = true;
    promoteFromIncubation(name);
    toast.success(`You are signed in as @${name}`, {
      description: 'Your Hive account is ready, so this device has caught up with it.',
    });
  }, [incubationHandle, promoteFromIncubation]);

  useEffect(() => {
    if (!incubationHandle) {
      setNeedsReconnect(false);
      return undefined;
    }
    check();
    // Coming back to the tab is exactly the moment the other device finished:
    // you graduate on the laptop, then return to the phone.
    const onWake = () => { if (!document.hidden) check(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [incubationHandle, check]);

  if (!needsReconnect) return null;

  const reconnect = async () => {
    setBusy(true);
    try {
      // No signup/graduate hint: this is a plain re-authorization of somebody
      // who is already known. Butrauth decides what it needs from them, and if
      // it still holds their login the popup closes on its own almost at once.
      await openButrauthPopup({});
    } catch (err) {
      toast.error(err?.message || 'Could not open Butter Auth');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ads-prompt-overlay">
      <div
        className="ads-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconnect-title"
      >
        <header className="ads-prompt-head">
          <div>
            <h3 className="ads-prompt-title" id="reconnect-title">
              Reconnect your session
            </h3>
            <p className="ads-prompt-lede">
              This device lost its connection to your account, so 3Speak cannot load
              your posts, progress or notifications until it is back.
            </p>
          </div>
        </header>

        <p className="ads-prompt-text">
          Nothing has been lost. Everything you have made lives on your account, not in
          this browser. Reconnecting usually takes a second and no typing.
        </p>

        <div className="ads-prompt-actions">
          <button type="button" className="ads-prompt-primary" onClick={reconnect} disabled={busy}>
            {busy ? 'Opening…' : 'Reconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}
