import { useEffect, useState } from 'react';
import { MdPersonAdd, MdContentCopy, MdCheck } from 'react-icons/md';
import HiveAvatar from '../../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../../lib/store';
import { fetchMyInviteLinks, fetchInvitePeople } from '../../lib/referralLinks';
import { BUTRAUTH_URL } from '../../utils/config';
import './Invite.scss';

/**
 * /invite-links, the screen for people 3Speak made referrers.
 *
 * Lists the invite links 3Speak gave the signed-in account, with this month's
 * usage. Everything comes from Butter Auth through the SDK (server/index.cjs):
 * the limit is set by 3Speak, the counts are Butter Auth's own ledger, so this
 * screen and Butter Auth's dashboard always show the same numbers.
 *
 * Pausing a link or replacing one that leaked happens on Butter Auth's
 * dashboard, which is linked at the bottom.
 */

const STATE_LABEL = {
  fast_track: 'account created',
  creating: 'creating account',
  other: 'has an account',
  warmup: 'in the warm-up',
  signed_up: 'signed up',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '');

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* the link is selectable text as a fallback */ }
  };
  return (
    <button type="button" className="invite-btn small" onClick={copy}>
      {copied ? <><MdCheck /> Copied</> : <><MdContentCopy /> Copy</>}
    </button>
  );
}

function People({ linkId }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetchInvitePeople(linkId)
      .then((d) => { if (alive) setPeople(d.people || []); })
      .catch(() => { if (alive) setError('Could not load this list.'); });
    return () => { alive = false; };
  }, [linkId]);
  if (error) return <p className="invite-muted">{error}</p>;
  if (people === null) return <p className="invite-muted">Loading…</p>;
  if (!people.length) return <p className="invite-muted">Nobody has used this link yet.</p>;
  return (
    <ul className="invite-people">
      {people.map((p, i) => (
        <li key={i}>
          {p.name ? <HiveAvatar username={p.name} size="small" className="invite-people-avatar" /> : <span className="invite-people-avatar empty" />}
          <span className="invite-people-name">{p.name ? `@${p.name}` : 'no name yet'}</span>
          <span className="invite-muted">{fmtDate(p.invitedAt)}</span>
          <span className={`invite-state${p.state === 'fast_track' ? ' is-fast' : ''}`}>{STATE_LABEL[p.state] || p.state}</span>
        </li>
      ))}
    </ul>
  );
}

function statusText(link) {
  if (link.status === 'paused') return 'Paused by 3Speak';
  if (link.pausedByReferrer) return 'Paused by you';
  if (link.leftThisMonth <= 0) return 'Used up for this month';
  return null;
}

export default function InviteLinks({ openLoginModal }) {
  const user = useAppStore((s) => s.user);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    fetchMyInviteLinks()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => {
        if (!alive) return;
        setError(e.status === 401
          ? 'Your session has expired. Please sign in again.'
          : 'Could not load your invite links right now.');
      });
    return () => { alive = false; };
  }, [user]);

  const links = data?.links || [];

  return (
    <div className="invite-page wide">
      <div className="invite-header">
        <MdPersonAdd className="invite-header-icon" />
        <div>
          <h1>Invite links</h1>
          <p>People who sign up through your link get their own Hive account right away, without the warm-up.</p>
        </div>
      </div>

      {!user && (
        <div className="invite-card">
          <p className="invite-text">Sign in to see your invite links.</p>
          <div className="invite-actions">
            <button type="button" className="invite-btn primary" onClick={() => openLoginModal?.('login')}>Log in</button>
          </div>
        </div>
      )}

      {user && error && <p className="invite-muted">{error}</p>}
      {user && !error && data === null && <p className="invite-muted">Loading…</p>}
      {user && data && links.length === 0 && (
        <div className="invite-card">
          <p className="invite-text">
            You do not have any invite links yet. 3Speak gives them to partners and creators who
            bring people onto Hive. If that is you, get in touch with the 3Speak team.
          </p>
        </div>
      )}

      {links.map((l) => {
        const pct = l.limit > 0 ? Math.min(100, (l.usedThisMonth / l.limit) * 100) : 100;
        const st = statusText(l);
        return (
          <div key={l.id} className="invite-card link">
            <div className="invite-link-row">
              <input type="text" readOnly value={l.url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
              <CopyButton text={l.url} />
            </div>

            <div className="invite-stats">
              <div className="invite-stat"><strong>{l.leftThisMonth}</strong><span>left this month</span></div>
              <div className="invite-stat"><strong>{l.usedThisMonth}</strong><span>used of {l.limit}</span></div>
              <div className="invite-stat"><strong>{l.accountsCreated}</strong><span>accounts created</span></div>
              <div className="invite-stat"><strong>{l.peopleInvited}</strong><span>people invited</span></div>
            </div>
            <div className="invite-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
            <p className="invite-muted">
              {st ? `${st} · ` : ''}Resets {fmtDate(l.resetsAt)}. When the month is used up, people who follow
              your link still join through the warm-up and still count as yours.
            </p>

            <button type="button" className="invite-btn small" onClick={() => setOpen(open === l.id ? null : l.id)}>
              {open === l.id ? 'Hide people' : 'Who joined'}
            </button>
            {open === l.id && <People linkId={l.id} />}
          </div>
        );
      })}

      {user && links.length > 0 && (
        <p className="invite-muted">
          To pause a link or replace one that leaked, use your{' '}
          <a href={`${BUTRAUTH_URL}/dashboard?tab=referrals`} target="_blank" rel="noopener noreferrer">Butter Auth dashboard</a>.
          {' '}People who already joined are not affected.
        </p>
      )}
    </div>
  );
}
