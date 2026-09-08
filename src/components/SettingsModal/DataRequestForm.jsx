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
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { useAppStore } from '../../lib/store';
import './DataRequestForm.scss';

// Every toast from this module is headed "Settings"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Settings');

export default function DataRequestForm() {
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
    if (!username) { toast.error('Please log in first'); return; }
    if (!contact.trim()) { toast.error('Enter an email address so we can reply'); return; }
    if (isDelete && !confirmed) { toast.error('Please confirm you understand what can and cannot be deleted'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${CHECKER_URL}/gdpr-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), type, contact: contact.trim(), message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);

      setDone(data);
      toast.success(isDelete ? 'Deletion request received' : 'Data request received');
    } catch (err) {
      toast.error(err.message || 'Could not send your request');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="drf-done">
        <h5>Request received</h5>
        <p>
          Your reference is <strong>{done.ref}</strong>. We will reply to <strong>{contact}</strong> by{' '}
          <strong>{done.dueBy}</strong> at the latest.
        </p>
        <p className="drf-muted">
          Keep the reference in case you need to follow up.
        </p>
      </div>
    );
  }

  // Login-gated: a data request is always about the signed-in account, so there's
  // nothing to fill in until you're logged in.
  if (!username) {
    return (
      <div className="drf-signin">
        <p>Please log in to request or delete your data — a request applies to the account you're signed in as.</p>
      </div>
    );
  }

  return (
    <form className="drf" onSubmit={handleSubmit}>
      <div className="drf-account">
        Request for <strong>@{username}</strong>
      </div>

      <div className="drf-choice" role="radiogroup" aria-label="Request type">
        <button
          type="button"
          role="radio"
          aria-checked={!isDelete}
          className={`drf-choice-btn${!isDelete ? ' active' : ''}`}
          onClick={() => setType('export')}
        >
          Get my data
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isDelete}
          className={`drf-choice-btn${isDelete ? ' active' : ''}`}
          onClick={() => setType('delete')}
        >
          Delete my account data
        </button>
      </div>

      <p className="drf-lede">
        {isDelete
          ? 'We will delete everything 3Speak stores about you in our own database.'
          : 'We will send you everything 3Speak stores about you in our own database, as a JSON file.'}
      </p>

      {scope.length > 0 && (
        <div className="drf-scope">
          <span className="drf-scope-title">This covers:</span>
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
        <span className="drf-warning-title">What we cannot do</span>
        <p>
          3Speak is built on the <strong>Hive blockchain</strong>. Your posts, comments, votes and
          reshares were signed with your own keys and broadcast to a <strong>public, permanent
          ledger</strong> that we do not control and cannot edit.
        </p>
        <p>
          {isDelete
            ? 'We can delete our copies and stop showing your content on 3Speak. We cannot erase it from the blockchain — nobody can, including you. Anyone running a Hive node will still have it.'
            : 'Your on-chain data is already public and machine-readable via any Hive API — we will point you to it. What we send you is what we hold in addition to that.'}
        </p>
      </div>


      <label className="drf-label" htmlFor="drf-contact">Email to reply to</label>
      <input
        id="drf-contact"
        className="drf-input"
        type="email"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
      />

      <label className="drf-label" htmlFor="drf-msg">Anything to add? (optional)</label>
      <textarea
        id="drf-msg"
        className="drf-textarea"
        rows={3}
        maxLength={2000}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Optional details about your request"
      />

      {isDelete && (
        <label className="drf-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I understand my content on the Hive blockchain is permanent and cannot be deleted by
            3Speak or by anyone else.
          </span>
        </label>
      )}

      <button type="submit" className="drf-submit" disabled={submitting || (isDelete && !confirmed)}>
        {submitting ? 'Sending…' : isDelete ? 'Request deletion' : 'Request my data'}
      </button>

      <p className="drf-foot">
        We reply within one month. You can also email{' '}
        <a href="mailto:privacy@3speak.tv">privacy@3speak.tv</a> directly.
      </p>
    </form>
  );
}
