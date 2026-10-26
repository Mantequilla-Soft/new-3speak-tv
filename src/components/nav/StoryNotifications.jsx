import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { formatNotifTime } from '../../utils/notificationHelpers';
import { markStorySeen, storyViewerPath, storyTimeLeft, useStoryClock } from '../../lib/stories';
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

  return (
    <ul className={`story-notifs story-notifs--${variant}`} aria-label={t('nav.notifications.stories.heading')}>
      {stories.map((s) => {
        const hoursLeft = Math.max(1, Math.ceil((new Date(s.expires_at).getTime() - now) / 3600000));
        return (
          <li
            key={`${s.owner}/${s.permlink}`}
            className={`story-notif${s.seen ? '' : ' story-notif--unseen'}`}
            onClick={() => open(s)}
          >
            {/* Countdown ring, as in the stories row: only the time left is drawn. */}
            <span
              className={`story-notif-ring${s.seen ? ' story-notif-ring--seen' : ''}`}
              style={{ '--story-left': storyTimeLeft(s.posted_at, s.expires_at, now) }}
            >
              <HiveAvatar username={s.owner} size={null} alt={s.owner} imgClassName="story-notif-avatar" badgeSize={10} />
            </span>
            <div className="story-notif-body">
              <div className="story-notif-msg">{t('nav.notifications.stories.posted', { user: s.owner })}</div>
              <div className="story-notif-meta">
                <span className="story-notif-type">{t('nav.notifications.stories.type')}</span>
                <span>·</span>
                <span>{formatNotifTime(s.posted_at)}</span>
                <span>·</span>
                <span>{t('nav.notifications.stories.hoursLeft', { count: hoursLeft })}</span>
              </div>
            </div>
            {s.thumbnail_url && (
              <img className="story-notif-thumb" src={s.thumbnail_url} alt="" loading="lazy" />
            )}
            {!s.seen && <span className="story-notif-dot" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
