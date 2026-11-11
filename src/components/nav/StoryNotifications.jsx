import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { formatNotifTime } from '../../utils/notificationHelpers';
import { markStorySeen, storyViewerPath, useStoryClock } from '../../lib/stories';
import './StoryNotifications.scss';

/**
 * Live 24h stories from followed accounts, shown above the Hive notifications in
 * the bell dropdown and on /notifications. They are injected by 3Speak (nothing is
 * on chain), so they keep their own seen state and leave once the story expires.
 *
 * Props: stories (from useStoryNotifications), onOpen (e.g. close the dropdown),
 * variant: 'dropdown' | 'page'.
 */
export default function StoryNotifications({ stories, onOpen, variant = 'dropdown' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useStoryClock();
  if (!stories?.length) return null;

  const open = (s) => {
    markStorySeen(s.owner, s.permlink, s.hive_permlink);
    onOpen?.();
    navigate(storyViewerPath(s.owner));
  };

  // 26a: one row of 52px rounded tiles in a cyan ring (quieter once seen),
  // the name under each and the time it has left (42b).
  return (
    <section className={`story-notifs-section story-notifs-section--${variant}`}>
    <div className="story-notifs-head" aria-hidden="true">{t('nav.notifications.stories.heading')}</div>
    <ul className={`story-notifs story-notifs--${variant}`} aria-label={t('nav.notifications.stories.heading')}>
      {stories.map((s) => {
        const hoursLeft = Math.max(1, Math.ceil((new Date(s.expires_at).getTime() - now) / 3600000));
        return (
          <li key={`${s.owner}/${s.permlink}`}>
            <button
              type="button"
              className={`story-notif${s.seen ? '' : ' story-notif--unseen'}`}
              onClick={() => open(s)}
              aria-label={t('nav.notifications.stories.posted', { user: s.owner })}
              title={`${t('nav.notifications.stories.posted', { user: s.owner })} · ${formatNotifTime(s.posted_at)}`}
            >
              <span className={`story-notif-ring${s.seen ? ' story-notif-ring--seen' : ''}`}>
                <HiveAvatar username={s.owner} size={null} alt="" imgClassName="story-notif-avatar" badgeSize={10} />
              </span>
              <span className="story-notif-name">{s.owner}</span>
              <span className="story-notif-left">{t('nav.notifications.stories.hoursLeft', { count: hoursLeft })}</span>
            </button>
          </li>
        );
      })}
    </ul>
    </section>
  );
}
