import { useTranslation } from 'react-i18next';
import { DockTile } from '../v2/ui';
import './StreamSignInButton.scss';

/**
 * Stands in for the chat box or the raise-hand button while a signed-in viewer
 * is still watching as a guest. The room login needs a wallet signature when
 * @threespeak cannot sign for this account, and that is only worth asking for
 * once they actually want to take part. Joining re-connects under their name,
 * which takes a moment, hence the busy state.
 */
export default function StreamSignInButton({ label, onSignIn, busy = false, variant = 'inline' }) {
  const { t } = useTranslation();
  // `dock`: a tile in the stream page's dock, where the raise-hand tile goes.
  if (variant === 'dock') {
    return (
      <DockTile
        icon={busy ? 'progress_activity' : 'login'}
        label={busy ? t('live.signIn.waitingWallet') : label}
        className="stream-signin stream-signin--dock"
        onClick={(e) => { e.stopPropagation(); onSignIn?.(); }}
        disabled={busy}
        title={label}
      />
    );
  }
  return (
    <button
      type="button"
      className={`stream-signin stream-signin--${variant}`}
      onClick={(e) => { e.stopPropagation(); onSignIn?.(); }}
      disabled={busy}
    >
      <span className={`material-symbols-rounded stream-signin__icon${busy ? ' v2-spin' : ''}`} aria-hidden="true">{busy ? 'progress_activity' : 'login'}</span>
      <span>{busy ? t('live.signIn.waitingWallet') : label}</span>
    </button>
  );
}
