import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import HiveAvatar from '../../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../../lib/store';
import { fetchInvite } from '../../lib/referralLinks';
import { rememberInvite } from '../../utils/referral';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import './Invite.scss';

/**
 * https://3speak.tv/invite/<code>, a link one of 3Speak's referrers shared.
 *
 * The code is remembered here and handed to Butter Auth when the visitor signs
 * up (utils/referral.js, then /api/manteauth/start). Butter Auth decides what
 * it is worth: while the referrer's link has room this month, the new user
 * gets a real Hive account straight away instead of the warm-up. When it does
 * not, they still join, through the warm-up, and the referrer is still
 * credited. So this page never tells anyone they cannot join.
 */
export default function InvitePage({ openLoginModal }) {
  const { code } = useParams();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [invite, setInvite] = useState(null); // null = loading
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchInvite(code)
      .then((d) => {
        if (!alive) return;
        setInvite(d);
        // Only a real 3Speak invite is worth carrying into sign-up.
        if (d.valid) rememberInvite(code);
      })
      .catch(() => { if (alive) setError('We could not check this invite right now. Please try again in a moment.'); });
    return () => { alive = false; };
  }, [code]);

  let body;
  if (error) {
    body = <p className="invite-text">{error}</p>;
  } else if (invite === null) {
    body = <p className="invite-text">Opening your invite…</p>;
  } else if (!invite.valid) {
    body = (
      <>
        <p className="invite-text">
          This invite link is not valid anymore. It may have been replaced by a newer one, so ask
          whoever sent it for the current link. You can still join 3Speak.
        </p>
        <div className="invite-actions">
          {!user && !incubationHandle && (
            <button type="button" className="invite-btn primary" onClick={() => openLoginModal?.('signup')}>
              Sign up
            </button>
          )}
          <Link to="/" className="invite-btn">Go to 3Speak</Link>
        </div>
      </>
    );
  } else if (user) {
    body = (
      <>
        <p className="invite-text">
          You are already on 3Speak as <strong>@{user}</strong>, so there is nothing to set up.
          Invites are for people who do not have a Hive account yet.
        </p>
        <div className="invite-actions">
          <Link to="/" className="invite-btn primary">Go to 3Speak</Link>
        </div>
      </>
    );
  } else if (incubationHandle) {
    // Already in the warm-up under a handle. The invite can turn that into a
    // real account now: Butter Auth's graduate flow picks the invite up from
    // the authorize URL.
    body = (
      <>
        <p className="invite-text">
          {invite.fastTrack
            ? <>You can turn <strong>@{incubationHandle}</strong> into your own Hive account right now, without finishing the warm-up.</>
            : <>This invite cannot create accounts right now, so keep going with your warm-up. <strong>@{invite.referrer}</strong> is still credited.</>}
        </p>
        <div className="invite-actions">
          {invite.fastTrack && (
            <button type="button" className="invite-btn primary" onClick={() => openButrauthPopup({ graduate: true }).catch(() => {})}>
              Create my Hive account
            </button>
          )}
          <Link to="/" className="invite-btn">Go to 3Speak</Link>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="invite-text">
          {invite.fastTrack
            ? <>Sign up and you get your own Hive account right away: one login for 3Speak and every other Hive app, with keys only you hold. It takes about a minute.</>
            : <>Sign up and start with a free profile on 3Speak. Your invite is saved, so <strong>@{invite.referrer}</strong> gets the credit.</>}
        </p>
        <div className="invite-actions">
          <button type="button" className="invite-btn primary" onClick={() => openLoginModal?.('signup')}>
            {invite.fastTrack ? 'Create my account' : 'Sign up'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="invite-page">
      <div className="invite-card">
        {invite?.valid ? (
          <div className="invite-from">
            <HiveAvatar username={invite.referrer} size="medium" className="invite-avatar" />
            <h1><span>@{invite.referrer}</span> invited you to 3Speak</h1>
          </div>
        ) : (
          <h1>Invite</h1>
        )}
        {body}
      </div>
    </div>
  );
}
