import { useEffect, useState } from 'react';
import HiveAvatar from '../../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../../lib/store';
import { fetchMyInviteLinks, fetchInvitePeople } from '../../lib/referralLinks';
import { BUTRAUTH_URL } from '../../utils/config';
import { useTranslation, Trans } from 'react-i18next';
import { Button, Card, Icon } from '../../components/v2/ui';
import './Invite.scss';

/**
 * /invite-links, the screen for people 3Speak made referrers (42c).
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
// Account made (or being made) through the link = cyan; the rest muted.
const STATE_TONE = { fast_track: 'cyan', creating: 'cyan' };

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
    <Button variant="secondary" size={40} onClick={copy}>
      {copied ? t('common.actions.copied') : t('common.actions.copy')}
    </Button>
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
  // 42c: a square-ish face, the name, the state as a small lowercase pill.
  return (
    <ul className="invite-people">
      {people.map((p, i) => (
        <li key={i} title={fmtDate(p.invitedAt)}>
          {p.name ? <HiveAvatar username={p.name} size="small" className="invite-people-avatar" /> : <span className="invite-people-avatar empty" />}
          <span className={`invite-people-name${p.name ? '' : ' is-pending'}`}>{p.name || t('auth.invite.noNameYet')}</span>
          <span className={`invite-state is-${STATE_TONE[p.state] || 'muted'}`}>
            {STATE_LABEL_KEY[p.state] ? t(STATE_LABEL_KEY[p.state]) : p.state}
          </span>
        </li>
      ))}
    </ul>
  );
}

// A paused or used-up link: icon + what happened (42c).
function linkStatus(link, t) {
  if (link.status === 'paused') return { icon: 'block', tone: 'accent', text: t('auth.invite.status.pausedBy3speak') };
  if (link.pausedByReferrer) return { icon: 'pause_circle', tone: 'muted', text: t('auth.invite.status.pausedByYou') };
  if (link.leftThisMonth <= 0) return { icon: 'event_busy', tone: 'muted', text: t('auth.invite.status.usedUp') };
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
  const statuses = links.map((l) => ({ link: l, st: linkStatus(l, t) })).filter((x) => x.st);
  const empty = !!user && !!data && links.length === 0;
  // Paused, used-up and "no links yet" sit in a column of their own (42c).
  const hasAside = statuses.length > 0 || empty;

  return (
    <div className={`invite-page${hasAside ? ' has-aside' : ''}`}>
      <header className="invite-header">
        <h1>{t('auth.invite.title')}</h1>
        <p>{t('auth.invite.subtitle')}</p>
      </header>

      <div className="invite-main">
        {!user && (
          <Card className="invite-card">
            <p className="invite-text">{t('auth.invite.signInPrompt')}</p>
            <div className="invite-actions">
              <Button variant="primary" icon="login" onClick={() => openLoginModal?.('login')}>{t('common.actions.login')}</Button>
            </div>
          </Card>
        )}

        {user && error && (
          <div className="v2-failure invite-card" role="alert"><b>{error}</b></div>
        )}
        {user && !error && data === null && (
          <div className="v2-skeleton invite-skeleton" aria-label={t('common.status.loading')} />
        )}

        {links.map((l) => (
          <section key={l.id} className="invite-card link">
            <div className="invite-link-row">
              <input type="text" className="v2-input" readOnly value={l.url.replace(/^https?:\/\//, '')} onFocus={(e) => e.target.select()} aria-label={t('auth.invite.linkAria')} />
              <CopyButton text={l.url} />
            </div>

            <div className="invite-stats">
              <div className="invite-stat"><b>{l.leftThisMonth}</b><span>{t('auth.invite.stats.left')}</span></div>
              <div className="invite-stat"><b>{l.usedThisMonth}</b><span>{t('auth.invite.stats.usedOf', { limit: l.limit })}</span></div>
              <div className="invite-stat"><b>{l.accountsCreated}</b><span>{t('auth.invite.stats.accountsCreated')}</span></div>
              <div className="invite-stat"><b>{l.peopleInvited}</b><span>{t('auth.invite.stats.peopleInvited')}</span></div>
            </div>
            <p className="invite-muted">{t('auth.invite.resetsNote', { date: fmtDate(l.resetsAt) })}</p>

            {/* "WHO JOINED · Hide people": the eyebrow is the switch */}
            <button
              type="button"
              className="invite-who"
              aria-expanded={open === l.id}
              onClick={() => setOpen(open === l.id ? null : l.id)}
            >
              <span className="v2-eyebrow">{t('auth.invite.whoJoined')}</span>
              {open === l.id
                ? <span className="invite-who__hide">· {t('auth.invite.hidePeople')}</span>
                : <Icon name="expand_more" size={16} />}
            </button>
            {open === l.id && <People linkId={l.id} />}
          </section>
        ))}

        {user && links.length > 0 && (
          <p className="invite-muted invite-dash">
            <Trans
              i18nKey="auth.invite.dashboardNote"
              components={{ dashLink: <a href={`${BUTRAUTH_URL}/dashboard?tab=referrals`} target="_blank" rel="noopener noreferrer" /> }}
            />
          </p>
        )}
      </div>

      {hasAside && (
        <aside className="invite-aside">
          {statuses.map(({ link, st }) => (
            <div key={link.id} className={`invite-status is-${st.tone}`}>
              <Icon name={st.icon} size={20} />
              <span className="invite-status__text">
                <b>{st.text}</b>
                {links.length > 1 && <span className="invite-status__link">{link.url.replace(/^https?:\/\//, '')}</span>}
              </span>
            </div>
          ))}
          {empty && (
            <div className="invite-none">
              <b>{t('auth.invite.noLinksTitle')}</b>
              <p>{t('auth.invite.noLinksBody')}</p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
