import './StreamSignInButton.scss';

/**
 * Stands in for the chat box or the raise-hand button while a signed-in viewer
 * is still watching as a guest. The room login needs a wallet signature when
 * @threespeak cannot sign for this account, and that is only worth asking for
 * once they actually want to take part. Joining re-connects under their name,
 * which takes a moment, hence the busy state.
 */
export default function StreamSignInButton({ label, onSignIn, busy = false, variant = 'inline' }) {
  return (
    <button
      type="button"
      className={`stream-signin stream-signin--${variant}`}
      onClick={(e) => { e.stopPropagation(); onSignIn?.(); }}
      disabled={busy}
    >
      {busy ? 'Waiting for your wallet…' : label}
    </button>
  );
}
