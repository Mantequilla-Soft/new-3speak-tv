import { useEffect, useState } from 'react';
import { fetchGraduationStatus, canCreateAccount } from '../../lib/incubation';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import { toastIn } from '../../utils/toast';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';

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
  const { t } = useTranslation();
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
      toast.success(t('incubation.createAccount.started'));
    } catch (err) {
      console.error('Graduation start error:', err);
      toast.error(t('incubation.createAccount.openFailed'));
    } finally { setBusy(false); }
  }

  return (
    <section className="inc-ready v2-success is-accent" aria-labelledby="inc-ready-title">
      <span className="inc-ready-icon" aria-hidden="true"><Icon name="rocket_launch" size={24} /></span>
      <div className="inc-ready-text">
        <h2 id="inc-ready-title">{advertiser ? t('incubation.createAccount.readyAdvertiser') : t('incubation.createAccount.ready')}</h2>
        <p>
          {advertiser
            ? t('incubation.createAccount.approvedAdvertiser')
            : t('incubation.createAccount.approved')}
        </p>
      </div>
      <Button variant="primary" size={44} next className="inc-ready-btn" onClick={go} disabled={busy} loading={busy}>
        {advertiser ? t('incubation.createAccount.createAdvertiser') : t('incubation.createAccount.create')}
      </Button>
    </section>
  );
}
