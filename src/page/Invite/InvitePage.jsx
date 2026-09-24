import { Navigate, useParams } from 'react-router-dom';
import { queueInvitePopup } from '../../utils/referral';

/**
 * https://3speak.tv/invite/<code>, a link one of 3Speak's referrers shared.
 *
 * Not a page of its own: the visitor lands on the home page and the invite is
 * shown over it as a popup (components/InvitePopup), so "I just want to look
 * around" leaves them somewhere worth looking. The popup checks the invite and
 * keeps the code for sign-up; see utils/referral.js.
 */
export default function InvitePage() {
  const { code } = useParams();
  // Before the redirect renders, so the popup finds it on the home page.
  queueInvitePopup(code);
  return <Navigate to="/" replace />;
}
