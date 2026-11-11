import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../lib/store';
import { fetchGraduationStatus } from '../../lib/incubation';
import { toastIn } from '../../utils/toast';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import { useTranslation } from 'react-i18next';
// The shared v2 dialog, with the same warm-up prompt pieces as graduation.
import { Button, Dialog, Icon } from '../v2/ui';
import './GraduationPrompt.scss';

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
  const { t } = useTranslation();
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
    toast.success(t('incubation.sessionSync.signedInAs', { name }), {
      description: t('incubation.sessionSync.caughtUp'),
    });
  }, [incubationHandle, promoteFromIncubation, t]);

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
      toast.error(err?.message || t('incubation.sessionSync.openFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    // "Reconnect your session" (design 46c). Not dismissible: nothing on the
    // page works until it is done, and reconnecting needs no typing.
    <Dialog
      open
      dismissible={false}
      title={t('incubation.sessionSync.title')}
      width={480}
      className="inc-prompt"
      footer={(
        <Button variant="inverse" next className="inc-prompt-primary" onClick={reconnect} disabled={busy} loading={busy}>
          {busy ? t('incubation.sessionSync.opening') : t('incubation.sessionSync.reconnect')}
        </Button>
      )}
    >
      <span className="inc-prompt-icon" aria-hidden="true"><Icon name="sync" size={28} /></span>
      <p className="inc-prompt-lede">
        {t('incubation.sessionSync.lede')}
      </p>

      <p className="inc-prompt-text">
        {t('incubation.sessionSync.text')}
      </p>
    </Dialog>
  );
}
