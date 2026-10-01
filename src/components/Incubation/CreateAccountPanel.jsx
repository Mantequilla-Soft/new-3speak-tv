import { useEffect, useState } from 'react';
import { MdRocketLaunch } from 'react-icons/md';
import { fetchGraduationStatus, canCreateAccount } from '../../lib/incubation';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import { toastIn } from '../../utils/toast';

const toast = toastIn('Your account');

/**
 * "Create your Hive account" on the owner's own warm-up profile, once they may.
 *
 * The popup (GraduationPrompt) offers the same thing once a visit, and "Not yet"
 * puts it away until the next one. This is where they find it again in the
 * meantime, without having to reload and wait for the offer to come back.
 *
 * Same server check as the popup (canCreateAccount), so it appears exactly when
 * the popup would and never for someone ButrAuth would refuse. Same action too:
 * ButrAuth's account setup, in its popup.
 */
export default function CreateAccountPanel({ advertiser = false }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchGraduationStatus()
      .then((s) => { if (alive) setReady(canCreateAccount(s)); })
      .catch(() => { /* not offered when we cannot tell */ });
    return () => { alive = false; };
  }, []);

  if (!ready) return null;

  async function go() {
    if (busy) return;
    setBusy(true);
    try {
      await openButrauthPopup({ graduate: true });
      toast.success('Let’s set up your Hive account');
    } catch (err) {
      console.error('Graduation start error:', err);
      toast.error('Could not open account setup. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <section className="inc-ready" aria-labelledby="inc-ready-title">
      <MdRocketLaunch className="inc-ready-icon" aria-hidden="true" />
      <div className="inc-ready-text">
        <h2 id="inc-ready-title">{advertiser ? 'Your advertiser account is ready' : 'Your Hive account is ready'}</h2>
        <p>
          {advertiser
            ? 'The team has approved your brand. Create your Hive account, for free, to book and pay for ads.'
            : 'The team has approved you. Create your Hive account, for free: it is yours alone.'}
        </p>
      </div>
      <button type="button" className="inc-ready-btn" onClick={go} disabled={busy}>
        {advertiser ? 'Create my advertiser account' : 'Create my Hive account'}
      </button>
    </section>
  );
}
