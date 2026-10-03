/**
 * GDPR data-subject request form — "send me my data" (Art. 15) and "delete my
 * account data" (Art. 17), living in Settings → About / Contact.
 *
 * The explainer is the point of this component, not the form. It has to be honest
 * about the one thing a blockchain front-end cannot do: your posts, comments,
 * votes and reshares live on Hive, signed and broadcast by YOUR keys to a public,
 * immutable ledger. We can delete our copy. Nobody can delete the chain. Promising
 * otherwise with a delete button that quietly does nothing would be worse than
 * having no button at all.
 */
import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { useAppStore } from '../../lib/store';
import './DataRequestForm.scss';

// Every toast from this module is headed "Settings"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Settings');

export default function DataRequestForm() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);

  const [type, setType] = useState('export');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [scope, setScope] = useState([]);

  // The request is always for the logged-in account — no free-text username field.
  // A request is tied to who you're signed in as, which stops anyone filing a
  // deletion/export against an account that isn't theirs.
  const username = user || '';

  // The scope list is served by the same module that fulfils the requests, so what
  // the user is promised here cannot drift from what the script actually touches.
  useEffect(() => {
    let alive = true;
    fetch(`${CHECKER_URL}/gdpr-request/scope`)
      .then((r) => r.json())
      .then((d) => { if (alive && d?.success) setScope(d.scope || []); })
      .catch(() => { /* explainer below covers it; the list is a nicety */ });
    return () => { alive = false; };
  }, []);

  const isDelete = type === 'delete';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username) { toast.error(t('common.status.loginRequired')); return; }
    if (!contact.trim()) { toast.error(t('settings.dataRequest.emailRequired')); return; }
    if (isDelete && !confirmed) { toast.error(t('settings.dataRequest.confirmRequired')); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${CHECKER_URL}/gdpr-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), type, contact: contact.trim(), message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || t('settings.dataRequest.requestFailed', { status: res.status }));

      setDone(data);
      toast.success(isDelete ? t('settings.dataRequest.deletionReceived') : t('settings.dataRequest.dataReceived'));
    } catch (err) {
      toast.error(err.message || t('settings.dataRequest.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="drf-done">
        <h5>{t('settings.dataRequest.doneTitle')}</h5>
        <p>
          <Trans i18nKey="settings.dataRequest.doneBody" values={{ ref: done.ref, contact, dueBy: done.dueBy }} components={{ b: <strong /> }} />
        </p>
        <p className="drf-muted">
          {t('settings.dataRequest.keepRef')}
        </p>
      </div>
    );
  }

  // Login-gated: a data request is always about the signed-in account, so there's
  // nothing to fill in until you're logged in.
  if (!username) {
    return (
      <div className="drf-signin">
        <p>{t('settings.dataRequest.signIn')}</p>
      </div>
    );
  }

  return (
    <form className="drf" onSubmit={handleSubmit}>
      <div className="drf-account">
        <Trans i18nKey="settings.dataRequest.requestFor" values={{ username }} components={{ b: <strong /> }} />
      </div>

      <div className="drf-choice" role="radiogroup" aria-label={t('settings.dataRequest.typeAria')}>
        <button
          type="button"
          role="radio"
          aria-checked={!isDelete}
          className={`drf-choice-btn${!isDelete ? ' active' : ''}`}
          onClick={() => setType('export')}
        >
          {t('settings.dataRequest.getData')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isDelete}
          className={`drf-choice-btn${isDelete ? ' active' : ''}`}
          onClick={() => setType('delete')}
        >
          {t('settings.dataRequest.deleteData')}
        </button>
      </div>

      <p className="drf-lede">
        {isDelete
          ? t('settings.dataRequest.ledeDelete')
          : t('settings.dataRequest.ledeExport')}
      </p>

      {scope.length > 0 && (
        <div className="drf-scope">
          <span className="drf-scope-title">{t('settings.dataRequest.covers')}</span>
          <ul>
            {scope.map((s) => (
              <li key={s.key}>
                <strong>{s.label}</strong> — {s.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The honest part. A front-end to a public ledger cannot unpublish from it,
          and users are entitled to know that BEFORE they ask us to try. */}
      <div className="drf-warning">
        <span className="drf-warning-title">{t('settings.dataRequest.cannotTitle')}</span>
        <p>
          <Trans i18nKey="settings.dataRequest.cannotBody" components={{ b: <strong /> }} />
        </p>
        <p>
          {isDelete
            ? t('settings.dataRequest.cannotDelete')
            : t('settings.dataRequest.cannotExport')}
        </p>
      </div>


      <label className="drf-label" htmlFor="drf-contact">{t('settings.dataRequest.emailLabel')}</label>
      <input
        id="drf-contact"
        className="drf-input"
        type="email"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder={t('settings.dataRequest.emailPlaceholder')}
        autoComplete="email"
      />

      <label className="drf-label" htmlFor="drf-msg">{t('settings.dataRequest.messageLabel')}</label>
      <textarea
        id="drf-msg"
        className="drf-textarea"
        rows={3}
        maxLength={2000}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('settings.dataRequest.messagePlaceholder')}
      />

      {isDelete && (
        <label className="drf-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            {t('settings.dataRequest.confirmLabel')}
          </span>
        </label>
      )}

      <button type="submit" className="drf-submit" disabled={submitting || (isDelete && !confirmed)}>
        {submitting ? t('settings.dataRequest.sending') : isDelete ? t('settings.dataRequest.requestDeletion') : t('settings.dataRequest.requestData')}
      </button>

      <p className="drf-foot">
        <Trans i18nKey="settings.dataRequest.foot" components={{ mail: <a href="mailto:privacy@3speak.tv" /> }} />
      </p>
    </form>
  );
}
