import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { Dialog, Button, IconButton } from '../v2/ui';
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

  // 44b: the inviter's face, "@alice invited you to 3Speak", what signing up
  // gets you, then create the account (primary) or just look around.
  const plainTitle = t('app.invite.title', { referrer: invite.referrer }).replace(/<\/?who>/g, '');
  return (
    <Dialog open onClose={close} title={plainTitle} head={false} width={440} className="invite-pop">
      <div className="invite-pop__head">
        <HiveAvatar username={invite.referrer} size="medium" className="invite-pop__avatar" />
        <IconButton icon="close" label={t('common.actions.close')} size={32} variant="ghost" round onClick={close} />
      </div>
      <h2 className="invite-pop__title">
        <Trans i18nKey="app.invite.title" values={{ referrer: invite.referrer }} components={{ who: <span className="invite-pop__who" /> }} />
      </h2>
      <p className={incubationHandle ? 'v2-well invite-pop__note' : 'invite-pop__text'}>{text}</p>
      <div className="invite-pop__actions">
        {showSignUp && (
          <Button variant="primary" block next onClick={signUp}>
            {incubationHandle ? t('app.invite.createHiveAccount') : invite.fastTrack ? t('app.invite.createAccount') : t('common.actions.signUp')}
          </Button>
        )}
        <Button variant="secondary" block onClick={close}>{t('app.invite.lookAround')}</Button>
      </div>
    </Dialog>
  );
}
