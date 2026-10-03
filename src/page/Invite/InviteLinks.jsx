import { useEffect, useState } from 'react';
import { MdPersonAdd, MdContentCopy, MdCheck } from 'react-icons/md';
import HiveAvatar from '../../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../../lib/store';
import { fetchMyInviteLinks, fetchInvitePeople } from '../../lib/referralLinks';
import { BUTRAUTH_URL } from '../../utils/config';
import { useTranslation, Trans } from 'react-i18next';
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

const STATE_LABEL_KEY = {
  fast_track: 'auth.invite.state.fastTrack',
  creating: 'auth.invite.state.creating',
  other: 'auth.invite.state.other',
  warmup: 'auth.invite.state.warmup',
  signed_up: 'auth.invite.state.signedUp',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '');

function CopyButton({ text }) {
  const { t } = useTranslation();
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
      {copied ? <><MdCheck /> {t('common.actions.copied')}</> : <><MdContentCopy /> {t('common.actions.copy')}</>}
    </button>
  );
}

function People({ linkId }) {
  const { t } = useTranslation();
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetchInvitePeople(linkId)
      .then((d) => { if (alive) setPeople(d.people || []); })
      .catch(() => { if (alive) setError(t('auth.invite.listLoadFailed')); });
    return () => { alive = false; };
  }, [linkId, t]);
  if (error) return <p className="invite-muted">{error}</p>;
  if (people === null) return <p className="invite-muted">{t('common.status.loading')}</p>;
  if (!people.length) return <p className="invite-muted">{t('auth.invite.nobodyYet')}</p>;
  return (
    <ul className="invite-people">
      {people.map((p, i) => (
        <li key={i}>
          {p.name ? <HiveAvatar username={p.name} size="small" className="invite-people-avatar" /> : <span className="invite-people-avatar empty" />}
          <span className="invite-people-name">{p.name ? `@${p.name}` : t('auth.invite.noNameYet')}</span>
          <span className="invite-muted">{fmtDate(p.invitedAt)}</span>
          <span className={`invite-state${p.state === 'fast_track' ? ' is-fast' : ''}`}>{STATE_LABEL_KEY[p.state] ? t(STATE_LABEL_KEY[p.state]) : p.state}</span>
        </li>
      ))}
    </ul>
  );
}

function statusText(link, t) {
  if (link.status === 'paused') return t('auth.invite.status.pausedBy3speak');
  if (link.pausedByReferrer) return t('auth.invite.status.pausedByYou');
  if (link.leftThisMonth <= 0) return t('auth.invite.status.usedUp');
  return null;
}

export default function InviteLinks({ openLoginModal }) {
  const { t } = useTranslation();
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
          ? t('auth.invite.sessionExpired')
          : t('auth.invite.loadFailed'));
      });
    return () => { alive = false; };
  }, [user, t]);

  const links = data?.links || [];

  return (
    <div className="invite-page wide">
      <div className="invite-header">
        <MdPersonAdd className="invite-header-icon" />
        <div>
          <h1>{t('auth.invite.title')}</h1>
          <p>{t('auth.invite.subtitle')}</p>
        </div>
      </div>

      {!user && (
        <div className="invite-card">
          <p className="invite-text">{t('auth.invite.signInPrompt')}</p>
          <div className="invite-actions">
            <button type="button" className="invite-btn primary" onClick={() => openLoginModal?.('login')}>{t('common.actions.login')}</button>
          </div>
        </div>
      )}

      {user && error && <p className="invite-muted">{error}</p>}
      {user && !error && data === null && <p className="invite-muted">{t('common.status.loading')}</p>}
      {user && data && links.length === 0 && (
        <div className="invite-card">
          <p className="invite-text">
            {t('auth.invite.noLinks')}
          </p>
        </div>
      )}

      {links.map((l) => {
        const pct = l.limit > 0 ? Math.min(100, (l.usedThisMonth / l.limit) * 100) : 100;
        const st = statusText(l, t);
        return (
          <div key={l.id} className="invite-card link">
            <div className="invite-link-row">
              <input type="text" readOnly value={l.url} onFocus={(e) => e.target.select()} aria-label={t('auth.invite.linkAria')} />
              <CopyButton text={l.url} />
            </div>

            <div className="invite-stats">
              <div className="invite-stat"><strong>{l.leftThisMonth}</strong><span>{t('auth.invite.stats.left')}</span></div>
              <div className="invite-stat"><strong>{l.usedThisMonth}</strong><span>{t('auth.invite.stats.usedOf', { limit: l.limit })}</span></div>
              <div className="invite-stat"><strong>{l.accountsCreated}</strong><span>{t('auth.invite.stats.accountsCreated')}</span></div>
              <div className="invite-stat"><strong>{l.peopleInvited}</strong><span>{t('auth.invite.stats.peopleInvited')}</span></div>
            </div>
            <div className="invite-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
            <p className="invite-muted">
              {st ? `${st} · ` : ''}{t('auth.invite.resetsNote', { date: fmtDate(l.resetsAt) })}
            </p>

            <button type="button" className="invite-btn small" onClick={() => setOpen(open === l.id ? null : l.id)}>
              {open === l.id ? t('auth.invite.hidePeople') : t('auth.invite.whoJoined')}
            </button>
            {open === l.id && <People linkId={l.id} />}
          </div>
        );
      })}

      {user && links.length > 0 && (
        <p className="invite-muted">
          <Trans
            i18nKey="auth.invite.dashboardNote"
            components={{ dashLink: <a href={`${BUTRAUTH_URL}/dashboard?tab=referrals`} target="_blank" rel="noopener noreferrer" /> }}
          />
        </p>
      )}
    </div>
  );
}
