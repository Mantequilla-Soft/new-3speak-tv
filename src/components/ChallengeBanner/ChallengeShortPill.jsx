import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/ui';
import { challengeText, challengeWeekOfTags, useShortsChallenge } from '../../lib/shortsChallenge';
import '../AudiogramEpisodeLink/AudiogramEpisodeLink.scss';

/**
 * On a Short in the player: "Weekly challenge · <theme>" when the Short carries a
 * challenge week's tag (challenge2026w48) and that week exists on the checker,
 * linking to that week's /challenge page. Same pill as the "Full video" link
 * (SourceLink), in the same stack over the Short. Nothing for any other Short,
 * nor for a tag of a week the team never planned.
 */
export default function ChallengeShortPill({ tags, className = '' }) {
  const { t } = useTranslation();
  const week = challengeWeekOfTags(tags);
  const { data: challenge } = useShortsChallenge(week, { enabled: !!week });
  if (!week || !challenge) return null;
  const title = challengeText(challenge, 'title');
  const label = t('challenges.menuEntry');
  return (
    <Link
      to={`/challenge/${week}`}
      className={`audiogramEpisodeLink challengeShortPill ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label}: ${title}`}
      data-testid="challenge-short-pill"
    >
      <span className="audiogramEpisodeLink__cover" aria-hidden="true">
        <Icon name="emoji_events" size={16} />
      </span>
      <span className="audiogramEpisodeLink__text">
        <small>{label}</small>
        <span aria-hidden="true"> · </span>
        <strong>{title}</strong>
      </span>
    </Link>
  );
}
