import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { formatNotifTime } from '../../utils/notificationHelpers';
import { episodeToTrack, markPodcastNotificationsSeen, episodePath, artUrl, onArtError, PODCAST_PLACEHOLDER } from '../../lib/podcasts';
import './StoryNotifications.scss';
import './PodcastNotifications.scss';

/**
 * New episodes of outside podcasts the user follows ("External" on /audio), shown
 * above the Hive notifications like the stories. Injected by 3Speak, nothing on
 * chain: the checker lists what arrived after each follow, and what was seen is
 * remembered in this browser, marked when the list is closed (dropdown) or left
 * (page), so the unseen highlight stays while the person reads it.
 *
 * Props: episodes + user (from usePodcastNotifications), onOpen, variant.
 */
export default function PodcastNotifications({ episodes, user, onOpen, variant = 'dropdown' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const hadUnseen = useRef(false);

  useEffect(() => {
    if (episodes?.some((e) => !e.seen)) hadUnseen.current = true;
  }, [episodes]);
  useEffect(() => () => { if (hadUnseen.current) markPodcastNotificationsSeen(user); }, [user]);

  if (!episodes?.length) return null;

  const open = (ep) => {
    audioPlayQueued(episodeToTrack(ep, ep.feed));
    onOpen?.();
    navigate(episodePath(ep.id));
  };

  return (
    <ul className={`story-notifs story-notifs--${variant}`} aria-label={t('nav.notifications.podcasts.heading')}>
      {episodes.map((ep) => {
        const art = ep.art || ep.feed?.art;
        return (
          <li key={ep.id} className={`story-notif podcast-notif${ep.seen ? '' : ' story-notif--unseen'}`} onClick={() => open(ep)}>
            <img className="podcast-notif-cover" src={art ? artUrl(art, 64) : PODCAST_PLACEHOLDER} alt="" loading="lazy" onError={onArtError} />
            <div className="story-notif-body">
              <div className="story-notif-msg">{t('nav.notifications.podcasts.newEpisode', { show: ep.feed?.title || '' })}</div>
              <div className="podcast-notif-title">{ep.title}</div>
              <div className="story-notif-meta">
                <span className="story-notif-type">{t('nav.notifications.podcasts.type')}</span>
                <span>·</span>
                <span>{formatNotifTime(ep.first_seen_at)}</span>
              </div>
            </div>
            {!ep.seen && <span className="story-notif-dot" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
