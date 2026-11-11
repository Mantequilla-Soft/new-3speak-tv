import { useEffect, useState } from 'react';
import HiveAvatar from '../../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../../lib/store';
import { fetchMyInviteLinks, fetchInvitePeople } from '../../lib/referralLinks';
import { BUTRAUTH_URL } from '../../utils/config';
import { useTranslation, Trans } from 'react-i18next';
import { Button, Card, Icon, Progress, StatusPill } from '../../components/v2/ui';
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
    <Button variant="secondary" icon={copied ? 'check' : 'content_copy'} onClick={copy}>
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
  return (
    <ul className="invite-people">
      {people.map((p, i) => (
        <li key={i}>
          {p.name ? <HiveAvatar username={p.name} size="small" className="invite-people-avatar" /> : <span className="invite-people-avatar empty" />}
          <span className="invite-people-name">{p.name ? `@${p.name}` : t('auth.invite.noNameYet')}</span>
          <span className="invite-people-date">{fmtDate(p.invitedAt)}</span>
          <StatusPill tone={STATE_TONE[p.state] || 'muted'} className="invite-state">
            {STATE_LABEL_KEY[p.state] ? t(STATE_LABEL_KEY[p.state]) : p.state}
          </StatusPill>
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

  return (
    <div className="invite-page">
      <header className="invite-header">
        <h1>{t('auth.invite.title')}</h1>
        <p>{t('auth.invite.subtitle')}</p>
      </header>

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
      {user && data && links.length === 0 && (
        <div className="v2-empty">
          <Icon name="link" size={28} />
          <p>{t('auth.invite.noLinks')}</p>
        </div>
      )}

      {links.map((l) => {
        const pct = l.limit > 0 ? Math.min(100, (l.usedThisMonth / l.limit) * 100) : 100;
        const st = linkStatus(l, t);
        return (
          <section key={l.id} className="invite-card link">
            {st && (
              <div className={`invite-status is-${st.tone}`}>
                <Icon name={st.icon} size={20} />
                <b>{st.text}</b>
              </div>
            )}
            <div className="invite-link-row">
              <input type="text" className="v2-input" readOnly value={l.url} onFocus={(e) => e.target.select()} aria-label={t('auth.invite.linkAria')} />
              <CopyButton text={l.url} />
            </div>

            <div className="invite-stats">
              <div className="v2-stat"><b className="num">{l.leftThisMonth}</b><div className="v2-stat__s">{t('auth.invite.stats.left')}</div></div>
              <div className="v2-stat"><b className="num">{l.usedThisMonth}</b><div className="v2-stat__s">{t('auth.invite.stats.usedOf', { limit: l.limit })}</div></div>
              <div className="v2-stat"><b className="num">{l.accountsCreated}</b><div className="v2-stat__s">{t('auth.invite.stats.accountsCreated')}</div></div>
              <div className="v2-stat"><b className="num">{l.peopleInvited}</b><div className="v2-stat__s">{t('auth.invite.stats.peopleInvited')}</div></div>
            </div>
            <Progress value={pct} thin label={t('auth.invite.stats.usedOf', { limit: l.limit })} />
            <p className="invite-muted">{t('auth.invite.resetsNote', { date: fmtDate(l.resetsAt) })}</p>

            <Button
              variant="ghost"
              size={32}
              className="invite-toggle"
              trailing={open === l.id ? 'expand_less' : 'expand_more'}
              aria-expanded={open === l.id}
              onClick={() => setOpen(open === l.id ? null : l.id)}
            >
              {open === l.id ? t('auth.invite.hidePeople') : t('auth.invite.whoJoined')}
            </Button>
            {open === l.id && <People linkId={l.id} />}
          </section>
        );
      })}

      {user && links.length > 0 && (
        <p className="invite-muted invite-dash">
          <Trans
            i18nKey="auth.invite.dashboardNote"
            components={{ dashLink: <a href={`${BUTRAUTH_URL}/dashboard?tab=referrals`} target="_blank" rel="noopener noreferrer" /> }}
          />
        </p>
      )}
    </div>
  );
}
