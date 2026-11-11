import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { formatNotifTime } from '../../utils/notificationHelpers';
import { episodeToTrack, markPodcastNotificationsSeen, episodePath, artUrl, onArtError, PODCAST_PLACEHOLDER } from '../../lib/podcasts';
import { Icon } from '../v2/Icon';
import './StoryNotifications.scss';
import './PodcastNotifications.scss';

/**
 * New episodes of outside podcasts the user follows ("External" on /audio), shown
 * above the Hive notifications like the stories. Injected by 3Speak, nothing on
 * chain: the checker lists what arrived after each follow, and what was seen is
 * remembered in this browser, marked when the list is closed (dropdown) or left
 * (page), so the unseen highlight stays while the person reads it.
 *
 * Props: episodes + user (from usePodcastNotifications), onOpen, variant, markSeen
 * (default true: closing marks the unseen ones seen).
 */
export default function PodcastNotifications({ episodes, user, onOpen, variant = 'dropdown', markSeen = true }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const hadUnseen = useRef(false);

  useEffect(() => {
    if (episodes?.some((e) => !e.seen)) hadUnseen.current = true;
  }, [episodes]);
  // `markSeen` false (the bell's hover peek): showing them is not seeing them,
  // unless it was pinned open with a click at some point before closing.
  const markRef = useRef(markSeen);
  useEffect(() => { if (markSeen) markRef.current = true; }, [markSeen]);
  useEffect(() => () => { if (hadUnseen.current && markRef.current) markPodcastNotificationsSeen(user); }, [user]);

  if (!episodes?.length) return null;

  const open = (ep) => {
    audioPlayQueued(episodeToTrack(ep, ep.feed));
    onOpen?.();
    navigate(episodePath(ep.id));
  };

  return (
    <section className={`story-notifs-section podcast-notifs-section story-notifs-section--${variant}`}>
    <ul className={`story-notifs story-notifs--${variant}`} aria-label={t('nav.notifications.podcasts.heading')}>
      {episodes.map((ep) => {
        const art = ep.art || ep.feed?.art;
        return (
          <li key={ep.id} className={`podcast-notif${ep.seen ? '' : ' podcast-notif--unseen'}`} onClick={() => open(ep)}>
            <span className="podcast-notif-art">
              <img className="podcast-notif-cover" src={art ? artUrl(art, 64) : PODCAST_PLACEHOLDER} alt="" loading="lazy" onError={onArtError} />
              <span className="notif-kind is-cyan" aria-hidden="true"><Icon name="podcasts" size={13} fill /></span>
            </span>
            <div className="podcast-notif-body">
              <div className="podcast-notif-msg">
                <b>{t('nav.notifications.podcasts.newEpisode', { show: ep.feed?.title || '' })}</b>{ep.title ? `: ${ep.title}` : ''}
              </div>
              <div className="podcast-notif-age">{formatNotifTime(ep.first_seen_at)}</div>
            </div>
          </li>
        );
      })}
    </ul>
    </section>
  );
}
