import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { Icon } from '../v2/Icon';
import { formatNotifTime } from '../../utils/notificationHelpers';
import { respondToCollab } from '../../lib/collabs';
import { toastIn } from '../../utils/toast';
import './StoryNotifications.scss';
import './PodcastNotifications.scss';
import './CheckerNotifications.scss';

const toast = toastIn('Notifications');

// Icon chip and tone per type; a new type (premiere reminders, say) is one line
// here and one string in social.json.
const TYPES = {
  live: { icon: 'sensors', tone: 'accent' },
  collab_invite: { icon: 'group_add', tone: 'cyan' },
};

function message(n, t) {
  if (n.type === 'live') return n.live ? t('social.notifs.liveNow', { user: n.actor }) : t('social.notifs.wasLive', { user: n.actor });
  if (n.type === 'collab_invite') return t('social.notifs.collabInvite', { user: n.actor });
  return `@${n.actor}`;
}

/** Accept / Decline on a collab invite, right in the row. */
function CollabActions({ n, user }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const answer = async (e, accept) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await respondToCollab(user, n.author, n.permlink, accept);
      toast.success(accept ? t('social.collab.acceptedToast', { user: n.actor }) : t('social.collab.declinedToast'));
      qc.invalidateQueries({ queryKey: ['checker-notifications', user] });
      qc.invalidateQueries({ queryKey: ['collab-invites', user] });
    } catch {
      toast.error(t('social.collab.answerFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="checker-notif-actions">
      <button type="button" className="v2-btn v2-btn--primary h32" disabled={busy} onClick={(e) => answer(e, true)}>
        {t('social.collab.accept')}
      </button>
      <button type="button" className="v2-btn v2-btn--secondary h32" disabled={busy} onClick={(e) => answer(e, false)}>
        {t('social.collab.decline')}
      </button>
    </span>
  );
}

/**
 * The checker's own notifications (lib/notifyLevels.js useCheckerNotifications):
 * someone you follow went live, a collab invite. They ride in the stories list
 * (`_checker` items) and StoryNotifications hands them here, so the bell and
 * /notifications both show them. Seen state is one "seen until" in this browser.
 */
export default function CheckerNotifications({ items, user, onOpen, variant = 'dropdown' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!items?.length) return null;

  const open = (n) => {
    onOpen?.();
    if (n.url) navigate(n.url);
  };

  return (
    <section className={`story-notifs-section podcast-notifs-section checker-notifs-section story-notifs-section--${variant}`}>
      <ul className={`story-notifs story-notifs--${variant}`} aria-label={t('social.notifs.heading')}>
        {items.map((n) => {
          const kind = TYPES[n.type] || { icon: 'notifications', tone: 'muted' };
          return (
            <li
              key={n.id}
              className={`podcast-notif checker-notif checker-notif--${n.type}${n.seen ? '' : ' podcast-notif--unseen'}`}
              onClick={() => open(n)}
            >
              <span className="podcast-notif-art">
                <HiveAvatar username={n.actor} size={null} alt="" imgClassName="podcast-notif-cover" badgeSize={0} />
                <span className={`notif-kind is-${kind.tone}`} aria-hidden="true"><Icon name={kind.icon} size={13} fill /></span>
              </span>
              <div className="podcast-notif-body">
                <div className="podcast-notif-msg">
                  <b>{message(n, t)}</b>{n.title ? `: ${n.title}` : ''}
                </div>
                <div className="podcast-notif-age">
                  {n.type === 'live' && n.live && <span className="checker-notif-live">{t('social.live.badge')}</span>}
                  {formatNotifTime(n.at)}
                </div>
                {n.type === 'collab_invite' && <CollabActions n={n} user={user} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
