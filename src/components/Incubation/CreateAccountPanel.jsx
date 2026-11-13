import { useEffect, useState } from 'react';
import { fetchGraduationStatus, canCreateAccount } from '../../lib/incubation';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import mark from '../../assets/image/3S_mark.svg';
import './CreateAccountPanel.scss';

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
 * ButrAuth's account setup, in its popup, where the account is made and the
 * keys are backed up.
 *
 * The look is the sign-up screens of design 29a: the 3Speak mark, a 32/900
 * heading over a muted line, labelled rows (the handle the account is made
 * from, and what comes next in the setup) and the 56-tall primary at the foot.
 */
export default function CreateAccountPanel({ advertiser = false }) {
  const { t } = useTranslation();
  const handle = useAppStore((s) => s.incubationHandle);
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

  const rows = [
    handle && { icon: 'alternate_email', label: t('incubation.createAccount.handleLabel'), value: handle, mono: true },
    { icon: 'key', label: t('incubation.createAccount.nextLabel'), value: t('incubation.createAccount.nextKeys') },
  ].filter(Boolean);

  return (
    <section className="inc-ca" aria-labelledby="inc-ready-title">
      <img className="inc-ca__mark" src={mark} alt="" width={40} height={35} />
      <h2 id="inc-ready-title" className="inc-ca__title">
        {advertiser ? t('incubation.createAccount.readyAdvertiser') : t('incubation.createAccount.ready')}
      </h2>
      <p className="inc-ca__sub">
        {advertiser
          ? t('incubation.createAccount.approvedAdvertiser')
          : t('incubation.createAccount.approved')}
      </p>
      <ul className="inc-ca__rows">
        {rows.map((r) => (
          <li key={r.icon} className="inc-ca__row">
            <Icon name={r.icon} size={24} className="inc-ca__row-icon" />
            <div className="inc-ca__row-text">
              <span className="inc-ca__row-label">{r.label}</span>
              <span className={r.mono ? 'inc-ca__row-value is-mono' : 'inc-ca__row-value'}>{r.value}</span>
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        size={56}
        block
        next
        className="inc-ca__cta"
        onClick={go}
        disabled={busy}
        loading={busy}
      >
        {advertiser ? t('incubation.createAccount.createAdvertiser') : t('incubation.createAccount.create')}
      </Button>
    </section>
  );
}
