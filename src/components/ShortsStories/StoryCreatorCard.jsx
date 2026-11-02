import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { formatNumber, formatTimeAgo } from '../../i18n';
import { profilePath } from '../../utils/urls';
import { usePortalDoc } from '../../utils/portalDocument';
import { hiveProfileQuery, profileCountsQuery, audioCountQuery, newestShortQuery } from '../../lib/creatorCard';
import './StoryCreatorCard.scss';

const CARD_WIDTH = 280;
const GAP = 10;
const EDGE = 8;

const fmt = (n) => formatNumber(Number(n) || 0, { compact: true });

/**
 * The stories row's hover card: when they last posted, then name, reputation,
 * bio and how much they publish. `anchor` is the avatar's rect; the card sits
 * under it (over it when there is no room below), kept inside the window.
 * `story` is the stories-row entry for a live story (latest_at, latest_expires_at),
 * null for a plain shorts creator.
 */
export default function StoryCreatorCard({ username, story, anchor, now, onPointerEnter, onPointerLeave }) {
  const { t } = useTranslation();
  const doc = usePortalDoc();
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const { data: profile } = useQuery(hiveProfileQuery(username));
  const { data: counts } = useQuery(profileCountsQuery(username));
  const { data: audioData } = useQuery(audioCountQuery(username));
  const { data: newestShort } = useQuery({ ...newestShortQuery(username), enabled: !story });

  // Placed after it rendered, so the height is known when it has to go above.
  useLayoutEffect(() => {
    const win = doc.defaultView || window;
    const h = ref.current?.offsetHeight || 0;
    const left = Math.min(
      Math.max(EDGE, anchor.left + anchor.width / 2 - CARD_WIDTH / 2),
      win.innerWidth - CARD_WIDTH - EDGE,
    );
    const below = anchor.bottom + GAP;
    const top = below + h > win.innerHeight - EDGE && anchor.top - GAP - h >= EDGE ? anchor.top - GAP - h : below;
    setPos({ left, top });
  }, [doc, anchor, profile, counts, audioData, newestShort]);

  const hoursLeft = story?.latest_expires_at
    ? Math.max(1, Math.ceil((new Date(story.latest_expires_at).getTime() - now) / 3600000))
    : 0;
  const lastAt = story ? story.latest_at : newestShort;

  const audio = Number(audioData?.total) || 0;
  const stats = [
    profile?.followers > 0 && { key: 'followers', count: profile.followers },
    counts?.videos > 0 && { key: 'videos', count: counts.videos },
    counts?.shorts > 0 && { key: 'shorts', count: counts.shorts },
    audio > 0 && { key: 'audio', count: audio },
  ].filter(Boolean);

  return createPortal(
    <div
      ref={ref}
      className="story-creator-card"
      style={pos ? { left: pos.left, top: pos.top, width: CARD_WIDTH } : { left: -9999, top: 0, width: CARD_WIDTH, visibility: 'hidden' }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {lastAt && (
        <div className={`story-creator-card__when${story ? ' story-creator-card__when--story' : ''}`}>
          <span>{t(story ? 'shorts.stories.card.storyPosted' : 'shorts.stories.card.lastShort', { time: formatTimeAgo(lastAt) })}</span>
          {story && hoursLeft > 0 && (
            <span className="story-creator-card__left">{t('nav.notifications.stories.hoursLeft', { count: hoursLeft })}</span>
          )}
        </div>
      )}

      <div className="story-creator-card__head">
        <div className="story-creator-card__names">
          {profile?.name && profile.name !== username && (
            <span className="story-creator-card__name">{profile.name}</span>
          )}
          <span className="story-creator-card__handle">@{username}</span>
        </div>
        {profile?.reputation != null && (
          <span className="story-creator-card__rep" title={t('shorts.stories.card.repTitle')}>
            {t('shorts.stories.card.rep', { rep: profile.reputation })}
          </span>
        )}
      </div>

      {profile?.about && <p className="story-creator-card__bio">{profile.about}</p>}

      {stats.length > 0 && (
        <div className="story-creator-card__stats">
          {stats.map((s) => (
            <span key={s.key} title={t(`profile.stats.${s.key}Title`, { count: s.count, num: formatNumber(s.count) })}>
              <Trans i18nKey={`profile.stats.${s.key}`} count={s.count} values={{ value: fmt(s.count) }} components={{ b: <strong /> }} />
            </span>
          ))}
        </div>
      )}

      <Link className="story-creator-card__link" to={profilePath(username)}>
        {t('shorts.stories.card.viewProfile')}
      </Link>
    </div>,
    doc.body,
  );
}
