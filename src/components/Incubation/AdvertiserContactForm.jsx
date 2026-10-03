import { useEffect, useState } from 'react';
import { FaLock } from 'react-icons/fa';
import { fetchWarmupContact, saveWarmupContact } from '../../lib/incubation';
import { toastIn } from '../../utils/toast';
import { useTranslation, Trans } from 'react-i18next';
import './AdvertiserContactForm.scss';

const toast = toastIn('Business contact');

const EMPTY_ADDRESS = { line1: '', line2: '', postalCode: '', city: '', region: '', country: '' };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/**
 * An advertiser's business contact, for the warm-up "Add your business contact" goal.
 *
 * 🚨 PRIVATE AND OFF-CHAIN. Saved through /api/warmup/contact into 3Speak's own
 * database, keyed by the signed-in account. Not part of the warm-up profile, which
 * is public and becomes the Hive profile at graduation, so none of this can ever end
 * up on chain or on screen for anyone but the team. The form says that up front,
 * because asking for a home address without saying where it goes is how people stop
 * trusting a form.
 *
 * Email is required. The address is optional, but the goal needs the address OR a
 * website on the profile; the website is edited on the profile because it is public.
 */
export default function AdvertiserContactForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchWarmupContact()
      .then((c) => {
        if (!alive) return;
        setEmail(c.email || '');
        setAddress({ ...EMPTY_ADDRESS, ...Object.fromEntries(Object.entries(c.address || {}).map(([k, v]) => [k, v || ''])) });
      })
      .catch(() => { /* empty form is a fine start */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const emailOk = EMAIL_RE.test(email.trim());
  const set = (k) => (e) => setAddress((a) => ({ ...a, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    if (!emailOk || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await saveWarmupContact({ email: email.trim(), address });
      toast.success(saved.addressComplete
        ? t('incubation.contact.savedComplete')
        : t('incubation.contact.savedIncomplete'));
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <form className="inc-contact" onSubmit={onSubmit}>
      <p className="inc-contact-private">
        <FaLock aria-hidden="true" />
        <span>
          <Trans i18nKey="incubation.contact.privateNote" components={{ b: <strong /> }} />
        </span>
      </p>

      <label className="inc-contact-field">
        <span>{t('incubation.contact.email')} <em>{t('incubation.contact.required')}</em></span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('incubation.contact.emailPlaceholder')}
          required
          disabled={!loaded}
        />
      </label>

      <fieldset className="inc-contact-address" disabled={!loaded}>
        <legend>{t('incubation.contact.address')} <em>{t('incubation.contact.addressOptional')}</em></legend>
        <input autoComplete="address-line1" placeholder={t('incubation.contact.ph.line1')} value={address.line1} onChange={set('line1')} />
        <input autoComplete="address-line2" placeholder={t('incubation.contact.ph.line2')} value={address.line2} onChange={set('line2')} />
        <div className="inc-contact-row">
          <input autoComplete="postal-code" placeholder={t('incubation.contact.ph.postalCode')} value={address.postalCode} onChange={set('postalCode')} />
          <input autoComplete="address-level2" placeholder={t('incubation.contact.ph.city')} value={address.city} onChange={set('city')} />
        </div>
        <div className="inc-contact-row">
          <input autoComplete="address-level1" placeholder={t('incubation.contact.ph.region')} value={address.region} onChange={set('region')} />
          <input autoComplete="country-name" placeholder={t('incubation.contact.ph.country')} value={address.country} onChange={set('country')} />
        </div>
        <span className="inc-contact-hint">
          {t('incubation.contact.addressHint')}
        </span>
      </fieldset>

      {error ? <p className="inc-contact-error">{error}</p> : null}
      <button type="submit" className="inc-task-cta" disabled={!emailOk || busy || !loaded}>
        {busy ? t('common.actions.saving') : t('incubation.contact.save')}
      </button>
    </form>
  );
}
