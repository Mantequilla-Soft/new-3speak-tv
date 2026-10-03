import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { useAppStore } from '../../lib/store';
import { fetchInvite } from '../../lib/referralLinks';
import { rememberInvite, takeQueuedInvitePopup } from '../../utils/referral';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import '../../page/Invite/Invite.scss';

/**
 * The invite popup: "@alice invited you to 3Speak".
 *
 * Opened once after someone follows https://3speak.tv/invite/<code> (the route
 * queues it and sends them to the home page). Either button closes it. The code
 * itself is kept (utils/referral.js), so whenever they sign up later in the
 * visit, from this popup or from the Sign up button in the top bar, Butter Auth
 * gets the invite and the referrer gets the credit.
 *
 * Nothing is shown to somebody already signed in with a Hive account: an invite
 * is for people who do not have one yet.
 */
export default function InvitePopup({ openLoginModal }) {
  const { t } = useTranslation();
  const location = useLocation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [invite, setInvite] = useState(null);

  // Checked on every navigation because the queue is written by a route the
  // visitor passes through on the way to the home page.
  useEffect(() => {
    const code = takeQueuedInvitePopup();
    if (!code) return undefined;
    let alive = true;
    fetchInvite(code)
      .then((d) => {
        if (!alive || !d.valid) return;
        // Kept for sign-up whether or not they sign up now.
        rememberInvite(code);
        setInvite(d);
      })
      .catch(() => { /* no popup; the site works the same without it */ });
    return () => { alive = false; };
  }, [location.pathname]);

  useEffect(() => {
    if (!invite) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setInvite(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [invite]);

  if (!invite || user) return null;

  const close = () => setInvite(null);
  const signUp = () => {
    close();
    if (incubationHandle) openButrauthPopup({ graduate: true }).catch(() => {});
    else openLoginModal?.('signup');
  };

  let text;
  if (incubationHandle) {
    text = invite.fastTrack
      ? <Trans i18nKey="app.invite.incubatingFastTrack" values={{ handle: incubationHandle }} components={{ b: <strong /> }} />
      : <Trans i18nKey="app.invite.incubatingKeepGoing" values={{ referrer: invite.referrer }} components={{ b: <strong /> }} />;
  } else {
    text = invite.fastTrack
      ? <>{t('app.invite.signUpFastTrack')}</>
      : <Trans i18nKey="app.invite.signUpFree" values={{ referrer: invite.referrer }} components={{ b: <strong /> }} />;
  }
  const showSignUp = !incubationHandle || invite.fastTrack;

  return createPortal(
    <div className="invite-popup-overlay" onClick={close}>
      <div className="invite-popup" role="dialog" aria-modal="true" aria-labelledby="invite-popup-title" onClick={(e) => e.stopPropagation()}>
        <div className="invite-from">
          <HiveAvatar username={invite.referrer} size="medium" className="invite-avatar" />
          <h1 id="invite-popup-title"><Trans i18nKey="app.invite.title" values={{ referrer: invite.referrer }} components={{ who: <span /> }} /></h1>
        </div>
        <p className="invite-text">{text}</p>
        <div className="invite-actions">
          {showSignUp && (
            <button type="button" className="invite-btn primary" onClick={signUp}>
              {incubationHandle ? t('app.invite.createHiveAccount') : invite.fastTrack ? t('app.invite.createAccount') : t('common.actions.signUp')}
            </button>
          )}
          <button type="button" className="invite-btn" onClick={close}>{t('app.invite.lookAround')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
